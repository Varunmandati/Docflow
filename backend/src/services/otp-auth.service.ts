import crypto from 'crypto';
import { env } from '../config/env.js';
import {
    normalizeEmail,
    hashOtp,
    inferNameFromEmail,
    storeOtpRecord,
    getOtpRecord,
    deleteOtpRecord,
    checkOtpRateLimit,
    getOtpRateLimitRemaining,
} from './redis-auth.service.js';
import { userService } from './user.service.js';
import { tokenService } from './token.service.js';
import { auditService } from './audit.service.js';
import { sendMailWithTimeout } from './email.service.js';

type AuthMode = 'login' | 'signup';

interface OtpRecordData {
    otpHash: string;
    name?: string;
    mode: AuthMode;
    attempts: number;
    lastSentAt: number;
}

interface UserProfile {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
}

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

export async function requestOtpEmail(input: { email: string; name?: string; mode: AuthMode }) {
    const email = normalizeEmail(input.email);
    
    // Check rate limit: max 3 OTPs per 10 minutes
    const withinLimit = await checkOtpRateLimit(email, 3, 600);
    if (!withinLimit) {
        const remaining = await getOtpRateLimitRemaining(email, 3);
        auditService.log({
            eventType: 'security.rate_limit_hit',
            severity: 'warn',
            metadata: { email, reason: 'OTP request limit exceeded' }
        });
        throw new Error(`Too many OTP requests. Please try again in 10 minutes. (${remaining} requests remaining)`);
    }

    const otp = `${crypto.randomInt(100000, 1000000)}`;
    const now = Date.now();

    const record: OtpRecordData = {
        otpHash: hashOtp(otp),
        name: input.name?.trim() || undefined,
        mode: input.mode,
        attempts: 0,
        lastSentAt: now,
    };

    // Store in Redis with TTL
    await storeOtpRecord(email, record, env.OTP_TTL_SECONDS);

    const subject = input.mode === 'signup' ? 'DocFlow Sign Up OTP' : 'DocFlow Login OTP';

    await sendMailWithTimeout({
        from: env.SMTP_FROM,
        to: email,
        subject,
        text: `Your DocFlow OTP is ${otp}. It expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes.`,
        html: buildOtpEmailHtml(otp, input.mode),
    });

    auditService.log({
        eventType: 'auth.otp_requested',
        severity: 'info',
        metadata: { email, mode: input.mode }
    });

    return {
        success: true,
        message: `OTP sent to ${email}.`,
        expiresInSeconds: env.OTP_TTL_SECONDS,
    };
}

export async function verifyOtpCode(input: { 
    email: string; 
    otp: string; 
    name?: string; 
    mode: AuthMode;
    ipAddress?: string;
    userAgent?: string;
}) {
    const email = normalizeEmail(input.email);
    const otp = input.otp.trim();
    
    const record = await getOtpRecord(email);

    if (!record) {
        auditService.log({
            eventType: 'auth.otp_failed',
            severity: 'warn',
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: { email, reason: 'OTP expired or not found' }
        });
        throw new Error('OTP not found. Please request a new one.');
    }

    if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
        await deleteOtpRecord(email);
        auditService.log({
            eventType: 'auth.otp_failed',
            severity: 'warn',
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: { email, reason: 'Max attempts exceeded' }
        });
        throw new Error('Too many invalid attempts. Please request a new OTP.');
    }

    const expected = Buffer.from(record.otpHash, 'hex');
    const provided = Buffer.from(hashOtp(otp), 'hex');

    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        record.attempts += 1;
        await storeOtpRecord(email, record, env.OTP_TTL_SECONDS);
        const remaining = env.OTP_MAX_ATTEMPTS - record.attempts;
        auditService.log({
            eventType: 'auth.otp_failed',
            severity: 'warn',
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: { email, reason: 'Invalid OTP code', attempts: record.attempts }
        });
        throw new Error(`Invalid OTP. ${remaining} attempt(s) remaining.`);
    }

    await deleteOtpRecord(email);

    // Look up or create user in PostgreSQL
    let dbUser = await userService.findByEmail(email);
    const finalName =
        input.mode === 'signup'
            ? input.name?.trim() || record.name || inferNameFromEmail(email)
            : dbUser?.display_name || inferNameFromEmail(email);

    if (!dbUser) {
        dbUser = await userService.createEmailUser(email, finalName);
    }

    const user: UserProfile = {
        id: dbUser.id,
        name: dbUser.display_name || finalName,
        email: dbUser.email,
        avatarUrl: dbUser.avatar_url || undefined,
    };

    const accessToken = tokenService.generateAccessToken(dbUser.id, dbUser.email);
    const refreshToken = await tokenService.generateRefreshToken(dbUser.id, input.ipAddress, input.userAgent);

    auditService.log({
        userId: dbUser.id,
        eventType: input.mode === 'signup' ? 'auth.google_login' : 'auth.login_success', // log appropriate signup/login
        severity: 'info',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { email }
    });

    return {
        success: true,
        message: input.mode === 'signup' ? 'Account created successfully.' : 'Login successful.',
        accessToken,
        refreshToken,
        accessTokenExpiry: Math.floor(Date.now() / 1000) + 24 * 3600,
        refreshTokenExpiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        user,
    };
}
