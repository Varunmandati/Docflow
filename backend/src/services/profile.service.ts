import crypto from 'crypto';
import { env } from '../config/env.js';
import { userService } from './user.service.js';
import { withUserContext, withApiClient } from '../db/client.js';
import { sendMailWithTimeout } from './email.service.js';

// In-memory store for local testing without real Redis (reusing memory mapping from original code)
const store = new Map<string, string>();
const timers = new Map<string, NodeJS.Timeout>();

const memorySet = async (key: string, value: string) => store.set(key, value);
const memoryGet = async (key: string) => store.get(key) || null;
const memoryDel = async (key: string) => {
    store.delete(key);
    if (timers.has(key)) {
        clearTimeout(timers.get(key));
        timers.delete(key);
    }
};
const memorySetEx = async (key: string, ttlSeconds: number, value: string) => {
    store.set(key, value);
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => store.delete(key), ttlSeconds * 1000));
};
const memoryIncr = async (key: string) => {
    const val = parseInt(store.get(key) || '0') + 1;
    store.set(key, val.toString());
    return val;
};
const memoryExpire = async (key: string, ttlSeconds: number) => {
    if (store.has(key)) {
        if (timers.has(key)) clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => store.delete(key), ttlSeconds * 1000));
    }
};

interface ChangeEmailOtpData {
    oldEmail: string;
    newEmail: string;
    createdAt: number;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const changeEmailOtpKey = (newEmail: string) => `email-change-otp:${normalizeEmail(newEmail)}`;
const hashOtp = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

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
 * Generate and store OTP for email change verification
 */
export async function generateEmailChangeOtp(
    oldEmail: string,
    newEmail: string,
    ttlSeconds: number = 600
): Promise<{ success: boolean; message: string }> {
    const normalizedOldEmail = normalizeEmail(oldEmail);
    const normalizedNewEmail = normalizeEmail(newEmail);

    console.log(`[ProfileService] Email change OTP requested: ${normalizedOldEmail} -> ${normalizedNewEmail}`);

    // Validate emails are different
    if (normalizedOldEmail === normalizedNewEmail) {
        throw new Error('New email must be different from current email');
    }

    // Rate limiting: max 3 OTP requests per new email per 10 minutes
    const rateLimitKey = `email-change-ratelimit:${normalizedNewEmail}`;
    const rateLimitCount = await memoryIncr(rateLimitKey);
    if (rateLimitCount === 1) {
        await memoryExpire(rateLimitKey, 600);
    }

    if (rateLimitCount > 3) {
        throw new Error('Too many email change requests. Please try again in 10 minutes.');
    }

    // Generate OTP
    const otp = `${crypto.randomInt(100000, 1000000)}`;
    console.log(`[ProfileService] Generated OTP: ${otp} for ${normalizedNewEmail} (oldEmail: ${normalizedOldEmail})`);

    const otpData: ChangeEmailOtpData = {
        oldEmail: normalizedOldEmail,
        newEmail: normalizedNewEmail,
        createdAt: Date.now(),
    };

    // Store OTP hash and metadata in Redis
    const dataToStore = JSON.stringify({
        otpHash: hashOtp(otp),
        ...otpData,
    });

    await memorySetEx(
        changeEmailOtpKey(normalizedNewEmail),
        ttlSeconds,
        dataToStore
    );

    // Send email with OTP
    console.log(`[ProfileService] Sending OTP email to: ${normalizedNewEmail} from: ${env.SMTP_FROM}`);
    try {
        const info = await sendMailWithTimeout({
            from: env.SMTP_FROM,
            to: normalizedNewEmail,
            subject: 'DocFlow Email Change Verification',
            text: `Your email change verification code is ${otp}. It expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes.`,
            html: buildEmailChangeOtpEmailHtml(otp),
        });
        console.log(`[ProfileService] ✅ OTP email sent successfully. MessageId: ${info.messageId}`);
    } catch (emailError) {
        // Delete the stored OTP if email sending fails
        await memoryDel(changeEmailOtpKey(normalizedNewEmail));
        const errorMsg = emailError instanceof Error ? emailError.message : 'Email sending failed';
        console.error(`[ProfileService] ❌ Failed to send OTP email:`, errorMsg);
        if (emailError instanceof Error && emailError.stack) {
            console.error(`[ProfileService] Stack:`, emailError.stack);
        }
        throw new Error(`Failed to send OTP email: ${errorMsg}`);
    }

    return { 
        success: true, 
        message: `Verification code sent to ${normalizedNewEmail}.` 
    };
}

/**
 * Verify OTP for email change
 */
export async function verifyEmailChangeOtp(
    oldEmail: string,
    newEmail: string,
    otp: string
): Promise<{ success: boolean; message: string }> {
    const normalizedOldEmail = normalizeEmail(oldEmail);
    const normalizedNewEmail = normalizeEmail(newEmail);
    const trimmedOtp = otp.trim();

    const key = changeEmailOtpKey(normalizedNewEmail);
    console.log(`[ProfileService] Verifying OTP — key: ${key}, oldEmail: ${normalizedOldEmail}, otp: "${trimmedOtp}"`);

    const storedData = await memoryGet(key);
    if (!storedData) {
        console.error(`[ProfileService] ❌ No OTP found in memory for key: ${key}`);
        console.error(`[ProfileService] Memory store keys:`, Array.from(store.keys()));
        throw new Error('OTP expired or not found. Please request a new one.');
    }

    const data = JSON.parse(storedData);
    console.log(`[ProfileService] Stored data — oldEmail: ${data.oldEmail}, newEmail: ${data.newEmail}, hasOtpHash: ${!!data.otpHash}`);

    // Verify old email matches
    if (data.oldEmail !== normalizedOldEmail) {
        console.error(`[ProfileService] ❌ Old email mismatch: stored="${data.oldEmail}" vs request="${normalizedOldEmail}"`);
        throw new Error(`Old email does not match. Expected "${data.oldEmail}" but got "${normalizedOldEmail}".`);
    }

    // Verify OTP
    const computedHash = hashOtp(trimmedOtp);
    console.log(`[ProfileService] OTP hash comparison — stored: ${data.otpHash.substring(0, 16)}... vs computed: ${computedHash.substring(0, 16)}...`);
    
    if (data.otpHash !== computedHash) {
        console.error(`[ProfileService] ❌ OTP hash mismatch! User entered wrong OTP or OTP was regenerated.`);
        throw new Error('Invalid OTP. Please check the code and try again.');
    }

    console.log(`[ProfileService] ✅ OTP verified successfully`);

    // Check if new email is already in use
    const exists = await userService.findByEmail(normalizedNewEmail);
    if (exists) {
        throw new Error('Email already in use');
    }

    // Delete the OTP
    await memoryDel(changeEmailOtpKey(normalizedNewEmail));

    // Update in database
    const oldUser = await userService.findByEmail(normalizedOldEmail);
    if (!oldUser) {
        throw new Error('User not found');
    }

    await withApiClient(async (client) => {
        await client.query(
            'UPDATE users SET email = $1 WHERE id = $2',
            [normalizedNewEmail, oldUser.id]
        );
    });

    return { success: true, message: 'Email changed successfully.' };
}

/**
 * Store temporary profile picture data
 */
export async function storeProfilePicture(
    email: string,
    pictureDataUrl: string,
    ttlSeconds: number = 3600
): Promise<{ pictureId: string }> {
    const normalizedEmail = normalizeEmail(email);
    const pictureId = crypto.randomUUID();
    const key = `profile-pic:${normalizedEmail}:${pictureId}`;

    await memorySetEx(key, ttlSeconds, pictureDataUrl);

    return { pictureId };
}

/**
 * Retrieve temporary profile picture
 */
export async function getProfilePicture(email: string, pictureId: string): Promise<string | null> {
    const normalizedEmail = normalizeEmail(email);
    const key = `profile-pic:${normalizedEmail}:${pictureId}`;

    return memoryGet(key);
}

/**
 * Delete temporary profile picture
 */
export async function deleteProfilePicture(email: string, pictureId: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const key = `profile-pic:${normalizedEmail}:${pictureId}`;

    await memoryDel(key);
}

/**
 * Store user profile data in database
 */
export async function updateUserProfile(
    email: string,
    profile: { name?: string; avatarUrl?: string; downloadedBytes?: number }
): Promise<void> {
    const user = await userService.findByEmail(email);
    if (!user) return;

    await withUserContext(user.id, async (client) => {
        if (profile.name !== undefined) {
            const sanitized = profile.name.replace(/<[^>]*>/g, '').trim().slice(0, 128);
            await client.query(
                'UPDATE users SET display_name = $1 WHERE id = $2',
                [sanitized, user.id]
            );
        }
        if (profile.avatarUrl !== undefined) {
            await client.query(
                'UPDATE users SET avatar_url = $1 WHERE id = $2',
                [profile.avatarUrl, user.id]
            );
        }
        if (profile.downloadedBytes !== undefined) {
            await client.query(
                'UPDATE users SET storage_used_bytes = $1 WHERE id = $2',
                [profile.downloadedBytes, user.id]
            );
        }
    });
}

/**
 * Get user profile data from database
 */
export async function getUserProfile(email: string): Promise<{ name?: string; email: string; avatarUrl?: string; downloadedBytes?: number } | null> {
    const user = await userService.findByEmail(email);
    if (!user) return null;

    const dbProfile = await userService.getProfile(user.id);
    if (!dbProfile) return null;

    return {
        name: dbProfile.display_name || undefined,
        email: dbProfile.email,
        avatarUrl: dbProfile.avatar_url || undefined,
        downloadedBytes: Number(dbProfile.storage_used_bytes),
    };
}
