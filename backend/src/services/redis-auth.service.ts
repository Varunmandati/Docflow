import crypto from 'crypto';
import { redisConnection } from '../queue/connection.js';
import { env } from '../config/env.js';

interface OtpRecordData {
    otpHash: string;
    name?: string;
    mode: 'login' | 'signup';
    attempts: number;
    lastSentAt: number;
}

interface UserProfileData {
    name: string;
    email: string;
    avatarUrl?: string;
}

interface TokenPayload {
    email: string;
    iat: number;
    exp: number;
    sub: string;
}

const OTP_PREFIX = 'otp:';
const USER_PREFIX = 'user:';
const TOKEN_BLACKLIST_PREFIX = 'token_blacklist:';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const hashOtp = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export const inferNameFromEmail = (email: string) => {
    const local = email.split('@')[0] || 'user';
    return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
};

/**
 * Store OTP in Redis with TTL
 */
export async function storeOtpRecord(
    email: string,
    record: OtpRecordData,
    ttlSeconds: number
): Promise<void> {
    const key = OTP_PREFIX + email;
    await redisConnection.setex(key, ttlSeconds, JSON.stringify(record));
}

/**
 * Retrieve OTP from Redis
 */
export async function getOtpRecord(email: string): Promise<OtpRecordData | null> {
    const key = OTP_PREFIX + email;
    const data = await redisConnection.get(key);
    return data ? JSON.parse(data) : null;
}

/**
 * Delete OTP from Redis
 */
export async function deleteOtpRecord(email: string): Promise<void> {
    const key = OTP_PREFIX + email;
    await redisConnection.del(key);
}

/**
 * Check and increment OTP rate limit (max 3 per 10 minutes)
 */
export async function checkOtpRateLimit(email: string, maxAttempts: number = 3, windowSeconds: number = 600): Promise<boolean> {
    const key = `otp_rate_limit:${email}`;
    const current = await redisConnection.incr(key);
    
    if (current === 1) {
        // First request in window, set expiry
        await redisConnection.expire(key, windowSeconds);
    }
    
    return current <= maxAttempts;
}

/**
 * Get remaining OTP rate limit requests
 */
export async function getOtpRateLimitRemaining(email: string, maxAttempts: number = 3): Promise<number> {
    const key = `otp_rate_limit:${email}`;
    const current = await redisConnection.get(key);
    const count = current ? parseInt(current) : 0;
    return Math.max(0, maxAttempts - count);
}

/**
 * Store user profile in Redis
 */
export async function storeUserProfile(email: string, user: UserProfileData): Promise<void> {
    const key = USER_PREFIX + email;
    await redisConnection.set(key, JSON.stringify(user));
}

/**
 * Retrieve user profile from Redis
 */
export async function getUserProfile(email: string): Promise<UserProfileData | null> {
    const key = USER_PREFIX + email;
    const data = await redisConnection.get(key);
    return data ? JSON.parse(data) : null;
}

/**
 * Build JWT token with expiry
 */
export function buildAuthToken(email: string, expiryMinutes: number = 1440): TokenPayload & { token: string } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiryMinutes * 60;
    const sub = crypto.randomUUID();

    const payload: TokenPayload = {
        email,
        iat: now,
        exp,
        sub,
    };

    const signature = crypto
        .createHmac('sha256', env.AUTH_TOKEN_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');

    const token = Buffer.from(
        JSON.stringify({ ...payload, signature })
    ).toString('base64url');

    return {
        ...payload,
        token,
    };
}

/**
 * Verify JWT token and check expiry
 */
export function verifyAuthToken(tokenStr: string): TokenPayload | null {
    try {
        const decoded = JSON.parse(Buffer.from(tokenStr, 'base64url').toString('utf-8'));
        const { signature, ...payload } = decoded;

        const expectedSignature = crypto
            .createHmac('sha256', env.AUTH_TOKEN_SECRET)
            .update(JSON.stringify(payload))
            .digest('hex');

        if (signature !== expectedSignature) {
            return null;
        }

        // Check expiry
        const now = Math.floor(Date.now() / 1000);
        if (now > payload.exp) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

/**
 * Blacklist token on logout (store in Redis with TTL)
 */
export async function blacklistToken(token: string, expirySeconds: number): Promise<void> {
    const key = TOKEN_BLACKLIST_PREFIX + token;
    await redisConnection.setex(key, expirySeconds, '1');
}

/**
 * Check if token is blacklisted
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
    const key = TOKEN_BLACKLIST_PREFIX + token;
    const exists = await redisConnection.exists(key);
    return exists === 1;
}

/**
 * Build refresh token (longer expiry)
 */
export function buildRefreshToken(email: string, expiryDays: number = 7): TokenPayload & { token: string } {
    return buildAuthToken(email, expiryDays * 24 * 60);
}
