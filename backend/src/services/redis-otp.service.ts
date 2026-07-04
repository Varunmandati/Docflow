import crypto from 'crypto';
import { redisConnection } from '../queue/connection.js';
import { env } from '../config/env.js';
import { sendMailWithTimeout } from './email.service.js';

type AuthMode = 'login' | 'signup';

interface OtpRecord {
    otpHash: string;
    name?: string;
    mode: AuthMode;
    attempts: number;
    createdAt: number;
}

interface UserProfile {
    name: string;
    email: string;
    avatarUrl?: string;
}

const hashOtp = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();

const inferNameFromEmail = (email: string) => {
    const local = email.split('@')[0] || 'user';
    return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
};

const buildToken = (email: string, expiresIn: number = 3600) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = `${email}|${now}|${crypto.randomUUID()}`;
    const signature = crypto
        .createHmac('sha256', env.AUTH_TOKEN_SECRET)
        .update(payload)
        .digest('hex');
    const token = Buffer.from(`${payload}|${signature}|${now + expiresIn}`).toString('base64url');
    return token;
};

const buildOtpEmailHtml = (otp: string, mode: AuthMode) => {
    const action = mode === 'signup' ? 'sign up' : 'log in';
    return `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
            <h2 style="margin: 0 0 12px;">Your DocFlow verification code</h2>
            <p style="margin: 0 0 12px;">Use this OTP to ${action} to your account:</p>
            <div style="display: inline-block; font-size: 28px; letter-spacing: 6px; font-weight: 700; padding: 10px 14px; border-radius: 8px; background: #f3f4f6; color: #111827;">
                ${otp}
            </div>
            <p style="margin: 16px 0 0;">This code expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes.</p>
            <p style="margin: 8px 0 0; color: #6b7280;">If you did not request this, you can ignore this email.</p>
        </div>
    `;
};

// Redis key builders
const otpKey = (email: string) => `otp:${normalizeEmail(email)}`;
const userKey = (email: string) => `user:${normalizeEmail(email)}`;
const tokenBlacklistKey = (token: string) => `blacklist:${token}`;
const rateLimitKey = (email: string) => `ratelimit:otp:${normalizeEmail(email)}`;

export async function requestOtpEmail(input: { email: string; name?: string; mode: AuthMode }) {
    const email = normalizeEmail(input.email);
    
    // Rate limiting: max 3 OTPs per email per 10 minutes
    const rateLimitCount = await redisConnection.incr(rateLimitKey(email));
    if (rateLimitCount === 1) {
        await redisConnection.expire(rateLimitKey(email), 600); // 10 minutes
    }
    
    if (rateLimitCount > 3) {
        throw new Error('Too many OTP requests. Please try again in 10 minutes.');
    }

    const otp = `${crypto.randomInt(100000, 1000000)}`;
    const now = Date.now();

    const record: OtpRecord = {
        otpHash: hashOtp(otp),
        name: input.name?.trim() || undefined,
        mode: input.mode,
        attempts: 0,
        createdAt: now,
    };

    // Store OTP in Redis with TTL
    await redisConnection.setex(
        otpKey(email),
        env.OTP_TTL_SECONDS,
        JSON.stringify(record)
    );

    const subject = input.mode === 'signup' ? 'DocFlow Sign Up OTP' : 'DocFlow Login OTP';

    try {
        await sendMailWithTimeout({
            from: env.SMTP_FROM,
            to: email,
            subject,
            text: `Your DocFlow OTP is ${otp}. It expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes.`,
            html: buildOtpEmailHtml(otp, input.mode),
        });
    } catch (error) {
        // Clean up Redis entry if email fails
        await redisConnection.del(otpKey(email));
        throw error;
    }

    return {
        success: true,
        message: `OTP sent to ${email}.`,
        expiresInSeconds: env.OTP_TTL_SECONDS,
    };
}

export async function verifyOtpCode(input: { email: string; otp: string; name?: string; mode: AuthMode }) {
    const email = normalizeEmail(input.email);
    const otp = input.otp.trim();

    const recordJson = await redisConnection.get(otpKey(email));
    if (!recordJson) {
        throw new Error('OTP not found. Please request a new one.');
    }

    const record: OtpRecord = JSON.parse(recordJson);

    if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
        await redisConnection.del(otpKey(email));
        throw new Error('Too many invalid attempts. Please request a new OTP.');
    }

    const expected = Buffer.from(record.otpHash, 'hex');
    const provided = Buffer.from(hashOtp(otp), 'hex');

    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        record.attempts += 1;
        await redisConnection.setex(
            otpKey(email),
            env.OTP_TTL_SECONDS,
            JSON.stringify(record)
        );
        throw new Error('Invalid OTP. Please try again.');
    }

    await redisConnection.del(otpKey(email));

    // Get existing user or create new one
    const existingUserJson = await redisConnection.get(userKey(email));
    let existingUser: UserProfile | null = null;
    if (existingUserJson) {
        existingUser = JSON.parse(existingUserJson);
    }

    const finalName =
        input.mode === 'signup'
            ? input.name?.trim() || record.name || inferNameFromEmail(email)
            : existingUser?.name || inferNameFromEmail(email);

    const user: UserProfile = {
        name: finalName,
        email,
        avatarUrl: existingUser?.avatarUrl,
    };

    // Store user in Redis (no expiry for user profile)
    await redisConnection.set(userKey(email), JSON.stringify(user));

    const token = buildToken(email, 3600); // 1 hour token validity
    
    return {
        success: true,
        message: input.mode === 'signup' ? 'Account created successfully.' : 'Login successful.',
        token,
        user,
        expiresIn: 3600,
    };
}

export async function refreshToken(token: string): Promise<{ token: string; expiresIn: number }> {
    // Validate and extract email from old token
    const email = extractEmailFromToken(token);
    if (!email) {
        throw new Error('Invalid token format.');
    }

    // Check if token is blacklisted
    const isBlacklisted = await redisConnection.exists(tokenBlacklistKey(token));
    if (isBlacklisted) {
        throw new Error('Token has been revoked.');
    }

    // Verify user exists
    const userJson = await redisConnection.get(userKey(email));
    if (!userJson) {
        throw new Error('User not found.');
    }

    // Issue new token
    const newToken = buildToken(email, 3600);
    return { token: newToken, expiresIn: 3600 };
}

export async function revokeToken(token: string): Promise<void> {
    // Extract expiry from token
    const parts = token.split('|');
    if (parts.length < 4) {
        throw new Error('Invalid token format.');
    }

    const expiresAt = parseInt(parts[3], 10);
    const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));

    // Add to blacklist with TTL
    await redisConnection.setex(tokenBlacklistKey(token), ttl, '1');
}

export async function validateToken(token: string): Promise<{ email: string; isValid: boolean }> {
    const email = extractEmailFromToken(token);
    
    if (!email) {
        return { email: '', isValid: false };
    }

    // Check if blacklisted
    const isBlacklisted = await redisConnection.exists(tokenBlacklistKey(token));
    if (isBlacklisted) {
        return { email, isValid: false };
    }

    // Check if expired
    const parts = token.split('|');
    if (parts.length < 4) {
        return { email, isValid: false };
    }

    const expiresAt = parseInt(parts[3], 10);
    const now = Math.floor(Date.now() / 1000);

    if (now > expiresAt) {
        return { email, isValid: false };
    }

    // Verify HMAC signature
    const payload = parts.slice(0, 3).join('|');
    const signature = parts[3];
    const expectedSignature = crypto
        .createHmac('sha256', env.AUTH_TOKEN_SECRET)
        .update(payload)
        .digest('hex');

    const isSignatureValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );

    return { email, isValid: isSignatureValid };
}

export function extractEmailFromToken(token: string): string | null {
    try {
        const decoded = Buffer.from(token, 'base64url').toString('utf-8');
        const parts = decoded.split('|');
        if (parts.length < 4) return null;
        return parts[0];
    } catch {
        return null;
    }
}

export async function getUserProfile(email: string): Promise<UserProfile | null> {
    const userJson = await redisConnection.get(userKey(normalizeEmail(email)));
    if (!userJson) return null;
    return JSON.parse(userJson);
}
