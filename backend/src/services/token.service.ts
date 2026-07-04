import { createHash, randomBytes } from 'crypto';
import { withApiClient } from '../db/client.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// NEVER store plaintext tokens — always hash before DB storage
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Parse user agent to a safe hint (no full UA stored)
function parseDeviceHint(userAgent?: string): string {
  if (!userAgent) return 'Unknown device';
  if (userAgent.includes('Chrome')) return 'Chrome browser';
  if (userAgent.includes('Firefox')) return 'Firefox browser';
  if (userAgent.includes('Safari')) return 'Safari browser';
  return 'Browser';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenPayload {
  sub: string;       // user ID
  email: string;
  iat: number;
  exp: number;
}

export class TokenService {
  
  generateAccessToken(userId: string, email: string): string {
    return jwt.sign(
      { sub: userId, email },
      env.AUTH_TOKEN_SECRET,
      { expiresIn: '24h', algorithm: 'HS256' }
    );
  }

  async generateRefreshToken(
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<string> {
    const token = randomBytes(64).toString('hex'); // 128 chars of hex
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await withApiClient(async (client) => {
      await client.query(`
        INSERT INTO refresh_tokens (user_id, token_hash, device_hint, ip_address, expires_at)
        VALUES ($1, $2, $3, $4::inet, $5)
      `, [userId, tokenHash, parseDeviceHint(userAgent), ipAddress || null, expiresAt]);
    });

    return token; // Return plaintext — only shown once
  }

  async verifyAndRotateRefreshToken(
    token: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ userId: string; newRefreshToken: string; accessToken: string } | null> {
    const tokenHash = hashToken(token);

    const oldToken = await withApiClient(async (client) => {
      // Find active token
      const result = await client.query(`
        SELECT rt.*, u.email 
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
          AND rt.revoked_at IS NULL
          AND rt.expires_at > NOW()
          AND u.is_active = TRUE
      `, [tokenHash]);

      if (!result.rows[0]) return null;

      const { user_id: userId, email, id: tokenId } = result.rows[0];

      // Revoke old token (rotation — one-time use)
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
        [tokenId]
      );
      
      return { userId, email };
    });

    if (!oldToken) return null;

    const { userId, email } = oldToken;

    // Issue new pair (avoiding nested connection deadlock)
    const newRefreshToken = await this.generateRefreshToken(userId, ipAddress, userAgent);
    const accessToken = this.generateAccessToken(userId, email);

    return { userId, newRefreshToken, accessToken };
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await withApiClient(async (client) => {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId]
      );
    });
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    await withApiClient(async (client) => {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
        [tokenHash]
      );
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      return jwt.verify(token, env.AUTH_TOKEN_SECRET) as AccessTokenPayload;
    } catch {
      return null;
    }
  }
}

export const tokenService = new TokenService();
