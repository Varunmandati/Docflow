import crypto from 'crypto';
import { env } from '../config/env.js';
import { userService } from './user.service.js';
import { withApiClient } from '../db/client.js';
import { sendMailWithTimeout } from './email.service.js';
import { buildOtpEmail } from './email-templates.js';
import { redis } from '../queue/connection.js';
import { logger } from '../config/logger.js';
import { getFirebaseAdmin } from '../config/firebase.js';
import { getAuth } from 'firebase-admin/auth';
import { auditService } from './audit.service.js';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashOtp = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

function isOtpExpired(expiresAt: string | Date): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

/**
 * Request a login OTP for an email. Generates, stores (hashed) and emails a
 * 6-digit code tied to the `login` purpose in the otps table.
 */
export async function requestLoginOtp(
  email: string,
  ipAddress: string | null,
  ttlSeconds: number = env.OTP_TTL_SECONDS
): Promise<{ success: boolean; message: string }> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail.includes('@') || !normalizedEmail.includes('.')) {
    throw new Error('Please enter a valid email address.');
  }

  // Per-email rate limit
  const emailRateKey = `otp-login:rl:${normalizedEmail}`;
  const emailCurrent = await redis.incr(emailRateKey);
  if (emailCurrent === 1) await redis.expire(emailRateKey, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
  if (emailCurrent > RATE_LIMIT_MAX) {
    throw new Error('Too many OTP requests for this email. Please try again in 10 minutes.');
  }

  // Per-IP rate limit
  if (ipAddress) {
    const ipRateKey = `otp-login:ip-rl:${ipAddress}`;
    const ipCurrent = await redis.incr(ipRateKey);
    if (ipCurrent === 1) await redis.expire(ipRateKey, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    if (ipCurrent > RATE_LIMIT_MAX * 3) {
      throw new Error('Too many OTP requests from this device. Please try again in 10 minutes.');
    }
  }

  const otp = `${crypto.randomInt(100000, 1000000)}`;
  const hashedOtp = hashOtp(otp);

  // Invalidate any previous unverified login OTP for this email
  await withApiClient(async (client) => {
    await client.query(
      `UPDATE otps SET verified_at = NOW()
       WHERE email = $1 AND purpose = 'login' AND verified_at IS NULL`,
      [normalizedEmail]
    );

    await client.query(`
      INSERT INTO otps (user_id, email, purpose, hashed_otp, expires_at, ip_address)
      VALUES (NULL, $1, 'login', $2, NOW() + ($3 * INTERVAL '1 second'), $4)
    `, [normalizedEmail, hashedOtp, ttlSeconds, ipAddress]);
  });

  try {
    const { subject, html, text } = buildOtpEmail({
      otp,
      purpose: 'login',
      expiryMinutes: Math.floor(env.OTP_TTL_SECONDS / 60),
    });
    await sendMailWithTimeout({
      from: env.SMTP_FROM,
      to: normalizedEmail,
      subject,
      text,
      html,
    });
  } catch (emailError) {
    // Roll back the OTP row if the email could not be delivered
    await withApiClient(async (client) => {
      await client.query(
        `DELETE FROM otps WHERE email = $1 AND purpose = 'login' AND verified_at IS NULL`,
        [normalizedEmail]
      );
    });
    const msg = emailError instanceof Error ? emailError.message : 'Email sending failed';
    throw new Error(`Failed to send OTP email: ${msg}`);
  }

  auditService.log({
    eventType: 'auth.otp_requested',
    severity: 'info',
    ipAddress: ipAddress ?? undefined,
    resourceId: normalizedEmail,
    metadata: { purpose: 'login' },
  });

  return {
    success: true,
    message: `Verification code sent to ${normalizedEmail}.`,
  };
}

/**
 * Verify a login OTP. On success, ensures the Firebase user + local user row
 * exist and mints a Firebase custom token the client exchanges for an ID token.
 */
export async function verifyLoginOtp(
  email: string,
  otp: string,
  name: string | undefined,
  ipAddress: string | null
): Promise<{
  success: boolean;
  message: string;
  token?: string;
  user?: { name: string; email: string; avatarUrl?: string };
}> {
  const normalizedEmail = normalizeEmail(email);
  const trimmedOtp = otp.trim();

  const entry = await withApiClient(async (client) => {
    const res = await client.query(`
      SELECT id, email, hashed_otp, attempt_count, expires_at, verified_at
      FROM otps
      WHERE email = $1 AND purpose = 'login' AND verified_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [normalizedEmail]);
    return res.rows[0] ?? null;
  });

  if (!entry) {
    throw new Error('OTP expired or not found. Please request a new one.');
  }

  if (isOtpExpired(entry.expires_at)) {
    await withApiClient(async (client) => {
      await client.query('DELETE FROM otps WHERE id = $1', [entry.id]);
    });
    throw new Error('OTP has expired. Please request a new one.');
  }

  if (Number(entry.attempt_count) >= env.OTP_MAX_ATTEMPTS) {
    await withApiClient(async (client) => {
      await client.query('DELETE FROM otps WHERE id = $1', [entry.id]);
    });
    throw new Error('Too many failed attempts. Please request a new OTP.');
  }

  const computedHash = hashOtp(trimmedOtp);
  if (computedHash !== entry.hashed_otp) {
    const remaining = env.OTP_MAX_ATTEMPTS - Number(entry.attempt_count) - 1;
    await withApiClient(async (client) => {
      await client.query(
        'UPDATE otps SET attempt_count = attempt_count + 1 WHERE id = $1',
        [entry.id]
      );
    });
    auditService.log({
      eventType: 'auth.otp_failed',
      severity: 'warn',
      ipAddress: ipAddress ?? undefined,
      resourceId: normalizedEmail,
      metadata: { purpose: 'login' },
    });
    throw new Error(`Invalid OTP. ${Math.max(remaining, 0)} attempt(s) remaining.`);
  }

  // Mark OTP verified
  await withApiClient(async (client) => {
    await client.query(
      'UPDATE otps SET verified_at = NOW() WHERE id = $1',
      [entry.id]
    );
  });

  auditService.log({
    eventType: 'auth.otp_verified',
    severity: 'info',
    ipAddress: ipAddress ?? undefined,
    resourceId: normalizedEmail,
    metadata: { purpose: 'login' },
  });

  // Ensure the Firebase user exists so we can mint a custom token.
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    throw new Error('Authentication service is not configured on the server.');
  }
  const firebaseAuth = getAuth(adminApp);

  let uid: string;
  try {
    const existing = await firebaseAuth.getUserByEmail(normalizedEmail);
    uid = existing.uid;
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      const created = await firebaseAuth.createUser({
        email: normalizedEmail,
        displayName: name || normalizedEmail.split('@')[0],
        emailVerified: true,
      });
      uid = created.uid;
    } else {
      throw new Error('Unable to resolve account. Please try again.');
    }
  }

  // Ensure the local user row exists (id = Firebase uid).
  const user = await userService.findOrCreateFirebaseUser({
    id: uid,
    email: normalizedEmail,
    displayName: name,
    authProvider: 'email',
  });

  // Mint a custom token; the client exchanges it (signInWithCustomToken) for a
  // Firebase ID token, which is what verifyFirebaseToken accepts.
  const customToken = await firebaseAuth.createCustomToken(uid);

  return {
    success: true,
    message: 'Login successful.',
    token: customToken,
    user: {
      name: user.display_name || name || normalizedEmail.split('@')[0],
      email: user.email,
      avatarUrl: user.avatar_url || undefined,
    },
  };
}