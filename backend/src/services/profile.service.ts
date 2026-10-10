import crypto from 'crypto';
import { env } from '../config/env.js';
import { userService } from './user.service.js';
import { withUserContext, withApiClient } from '../db/client.js';
import { sendMailWithTimeout } from './email.service.js';
import { safeRedisDel, safeRedisExpire, safeRedisGet, safeRedisIncr, safeRedisSetex } from '../queue/connection.js';
import { logger } from '../config/logger.js';
import { auditService } from './audit.service.js';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashOtp = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

function isOtpExpired(expiresAt: string | Date): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

const buildEmailChangeOtpEmailHtml = (otp: string) => {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <h2 style="margin: 0 0 12px;">Email Change Verification</h2>
      <p style="margin: 0 0 12px;">You requested to change your DocFlow email address. Use this verification code:</p>
      <div style="display: inline-block; font-size: 28px; letter-spacing: 6px; font-weight: 700; padding: 10px 14px; border-radius: 8px; background: #f3f4f6; color: #111827;">
        ${otp}
      </div>
      <p style="margin: 16px 0 0;">This code expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes.</p>
      <p style="margin: 8px 0 0; color: #6b7280;">If you did not request this change, you can ignore this email and your email will remain unchanged.</p>
    </div>
  `;
};

/**
 * Ensure a user row exists for the authenticated Firebase user.
 * Called on every authenticated route so FKs / RLS / job history work.
 */
export async function ensureUserExists(input: {
  uid: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  provider?: 'email' | 'google';
}): Promise<{ id: string; email: string; display_name: string | null } | null> {
  if (!input.uid) return null;
  try {
    const user = await userService.findOrCreateFirebaseUser({
      id: input.uid,
      email: input.email ?? 'user@localhost.invalid',
      displayName: input.name,
      avatarUrl: input.avatarUrl,
      authProvider: input.provider,
    });
    // The user row may have been created or reconciled just now; drop any
    // stale cached profile so callers never see an outdated email/name.
    await safeRedisDel(`user-profile:${input.uid}`);
    return { id: user.id, email: user.email, display_name: user.display_name };
  } catch (err) {
    logger.error({ err }, 'Failed to ensure user exists');
    return null;
  }
}

/**
 * Generate and store a hashed OTP for email change verification.
 */
export async function generateEmailChangeOtp(
  userId: string,
  oldEmail: string,
  newEmail: string,
  ttlSeconds: number = env.OTP_TTL_SECONDS
): Promise<{ success: boolean; message: string }> {
  const normalizedOldEmail = normalizeEmail(oldEmail);
  const normalizedNewEmail = normalizeEmail(newEmail);

  if (normalizedOldEmail === normalizedNewEmail) {
    throw new Error('New email must be different from current email');
  }

  // The caller-supplied oldEmail must match the email currently on the account.
  // Prevents an attacker who has only guessed a user id from mailing arbitrary
  // addresses / triggering OTP emails to third parties.
  const profile = await getUserProfile(userId);
  if (!profile || normalizeEmail(profile.email) !== normalizedOldEmail) {
    throw new Error(
      `Current email does not match the email on this account. ` +
      `Please refresh your profile and try again.`
    );
  }

  // Redis-backed rate limiting: max 5 requests per new email per 10 minutes.
  // Fail-open: a Redis outage must not block legitimate email changes (these
  // are authenticated, low-risk writes; the OTP itself is still required).
  const rateKey = `email-change:rl:${normalizedNewEmail}`;
  const current = await safeRedisIncr(rateKey);
  if (current !== null) {
    if (current === 1) await safeRedisExpire(rateKey, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    if (current > RATE_LIMIT_MAX) {
      throw new Error('Too many email change requests. Please try again in 10 minutes.');
    }
  }

  // Per-user rate limit so one account cannot spam OTP emails to many targets.
  const userRateKey = `email-change:user-rl:${userId}`;
  const userCurrent = await safeRedisIncr(userRateKey);
  if (userCurrent !== null) {
    if (userCurrent === 1) await safeRedisExpire(userRateKey, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    if (userCurrent > RATE_LIMIT_MAX) {
      throw new Error('Too many email change requests from this account. Please try again in 10 minutes.');
    }
  }

  // Ensure target email is not already in use
  const existing = await userService.findByEmail(normalizedNewEmail);
  if (existing) {
    throw new Error('This email is already in use by another account.');
  }

  const otp = `${crypto.randomInt(100000, 1000000)}`;
  const hashedOtp = hashOtp(otp);

  // Invalidate any previous unverified OTP for this email
  await withApiClient(async (client) => {
    await client.query(
      `UPDATE otps SET verified_at = NOW()
       WHERE email = $1 AND purpose = 'email_change' AND verified_at IS NULL`,
      [normalizedNewEmail]
    );

    await client.query(`
      INSERT INTO otps (user_id, email, purpose, hashed_otp, expires_at, ip_address)
      VALUES ($1, $2, 'email_change', $3, NOW() + ($4 * INTERVAL '1 second'), $5)
    `, [userId, normalizedNewEmail, hashedOtp, ttlSeconds, null]);
  });

  auditService.log({
    userId,
    eventType: 'auth.otp_requested',
    severity: 'info',
    resourceId: normalizedNewEmail,
    metadata: { purpose: 'email_change' },
  });

  // Send email with OTP
  try {
    await sendMailWithTimeout({
      from: env.SMTP_FROM,
      to: normalizedNewEmail,
      subject: 'DocFlow Email Change Verification',
      text: `Your email change verification code is ${otp}. It expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes.`,
      html: buildEmailChangeOtpEmailHtml(otp),
    });
  } catch (emailError) {
    // Roll back the OTP row if the email could not be delivered
    await withApiClient(async (client) => {
      await client.query(
        `DELETE FROM otps WHERE email = $1 AND purpose = 'email_change' AND verified_at IS NULL`,
        [normalizedNewEmail]
      );
    });
    const msg = emailError instanceof Error ? emailError.message : 'Email sending failed';
    throw new Error(`Failed to send OTP email: ${msg}`);
  }

  return {
    success: true,
    message: `Verification code sent to ${normalizedNewEmail}.`,
  };
}

/**
 * Verify the email-change OTP and persist the new email.
 */
export async function verifyEmailChangeOtp(
  userId: string,
  oldEmail: string,
  newEmail: string,
  otp: string
): Promise<{ success: boolean; message: string }> {
  const normalizedOldEmail = normalizeEmail(oldEmail);
  const normalizedNewEmail = normalizeEmail(newEmail);
  const trimmedOtp = otp.trim();

  // Re-validate the old email at verify time — the account may have changed
  // since the OTP was requested, or the caller may be trying a stale flow.
  const profile = await getUserProfile(userId);
  if (!profile || normalizeEmail(profile.email) !== normalizedOldEmail) {
    throw new Error('Current email does not match the email on this account.');
  }

  const entry = await withApiClient(async (client) => {
    const res = await client.query(`
      SELECT id, user_id, email, hashed_otp, attempt_count, expires_at, verified_at
      FROM otps
      WHERE email = $1 AND purpose = 'email_change' AND verified_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [normalizedNewEmail]);
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

  if (entry.user_id !== userId) {
    throw new Error('Email verification failed. Please try again.');
  }

  if (Number(entry.attempt_count) >= env.OTP_MAX_ATTEMPTS) {
    await withApiClient(async (client) => {
      await client.query('DELETE FROM otps WHERE id = $1', [entry.id]);
    });
    throw new Error('Too many failed attempts. Please request a new OTP.');
  }

  if (entry.email !== normalizedNewEmail) {
    throw new Error('Email verification failed. Please try again.');
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
    throw new Error(`Invalid OTP. ${Math.max(remaining, 0)} attempt(s) remaining.`);
  }

  // Mark OTP verified
  await withApiClient(async (client) => {
    await client.query(
      'UPDATE otps SET verified_at = NOW() WHERE id = $1',
      [entry.id]
    );
  });

  // Persist the new email within the user's RLS context
  await withUserContext(userId, async (client) => {
    await client.query(
      'UPDATE users SET email = $1 WHERE id = $2',
      [normalizedNewEmail, userId]
    );
  });

  // Invalidate profile cache
  await safeRedisDel(`user-profile:${userId}`);

  auditService.log({
    userId,
    eventType: 'auth.email_changed',
    severity: 'info',
    resourceId: normalizedNewEmail,
    metadata: { purpose: 'email_change' },
  });

  return { success: true, message: 'Email changed successfully.' };
}

/**
 * Store temporary profile picture data (Redis, 1 hour TTL)
 */
export async function storeProfilePicture(
  userId: string,
  pictureDataUrl: string,
  ttlSeconds: number = 3600
): Promise<{ pictureId: string }> {
  const pictureId = crypto.randomUUID();
  const key = `profile-pic:${userId}:${pictureId}`;
  // Upstash (serverless Redis) rejects values above ~1MB, and the free tier
  // request cap is lower still. Pointless setex attempts only add error noise,
  // so skip the cache for oversized payloads on Upstash — local Redis keeps
  // caching them as before.
  if (pictureDataUrl.length > 512 * 1024 && /upstash/i.test(env.REDIS_URL)) {
    logger.warn({ userId, bytes: pictureDataUrl.length }, 'Profile picture too large for Upstash cache — skipped');
    return { pictureId };
  }
  await safeRedisSetex(key, ttlSeconds, pictureDataUrl);
  return { pictureId };
}

export async function getProfilePicture(userId: string, pictureId: string): Promise<string | null> {
  const key = `profile-pic:${userId}:${pictureId}`;
  return safeRedisGet(key);
}

export async function deleteProfilePicture(userId: string, pictureId: string): Promise<void> {
  const key = `profile-pic:${userId}:${pictureId}`;
  await safeRedisDel(key);
}

/**
 * Update user profile data (name / avatar / storage counter) by Firebase UID.
 */
export async function updateUserProfile(
  userId: string,
  profile: { name?: string; avatarUrl?: string; downloadedBytes?: number }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (profile.name !== undefined) {
    const sanitized = profile.name.replace(/<[^>]*>/g, '').trim().slice(0, 128);
    params.push(sanitized);
    sets.push(`display_name = $${params.length}`);
  }
  if (profile.avatarUrl !== undefined) {
    params.push(profile.avatarUrl.slice(0, 512));
    sets.push(`avatar_url = $${params.length}`);
  }
  if (profile.downloadedBytes !== undefined) {
    params.push(profile.downloadedBytes);
    sets.push(`storage_used_bytes = $${params.length}`);
  }

  if (sets.length === 0) return;

  params.push(userId);
  await withUserContext(userId, async (client) => {
    await client.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  });

  await safeRedisDel(`user-profile:${userId}`);
}

/**
 * Get user profile by Firebase UID (with 10-minute Redis cache).
 */
export async function getUserProfile(userId: string): Promise<{
  name?: string;
  email: string;
  avatarUrl?: string;
  downloadedBytes?: number;
} | null> {
  const cacheKey = `user-profile:${userId}`;
  const cached = await safeRedisGet(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch { /* ignore corrupt cache */ }
  }

  const dbProfile = await userService.getProfile(userId);
  if (!dbProfile) return null;

  const profile = {
    name: dbProfile.display_name || undefined,
    email: dbProfile.email,
    avatarUrl: dbProfile.avatar_url || undefined,
    downloadedBytes: Number(dbProfile.storage_used_bytes),
  };

  await safeRedisSetex(cacheKey, 600, JSON.stringify(profile));
  return profile;
}
