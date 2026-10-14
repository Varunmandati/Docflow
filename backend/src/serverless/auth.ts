import { initializeFirebaseAdmin, getFirebaseAdmin } from '../config/firebase.js';
import { getAuth } from 'firebase-admin/auth';
import { redis } from '../queue/connection.js';
import { logger } from '../config/logger.js';

/**
 * Request helpers shared by the standalone `/api/pdf-to-docx/*` serverless
 * functions. These run outside the Fastify app (which owns the /v1/* surface),
 * so they cannot reuse the Fastify auth/rate-limit middleware — but they reuse
 * the same Firebase Admin instance and the same Redis connection.
 */

export type RawHeaders = Record<string, string | string[] | undefined>;

export function headerValue(headers: RawHeaders, name: string): string | undefined {
    const direct = headers[name] ?? headers[name.toLowerCase()];
    if (direct === undefined) return undefined;
    return Array.isArray(direct) ? direct[0] : direct;
}

export interface AuthedUser {
    uid: string;
    email?: string;
}

/**
 * Verify the Firebase ID token from `Authorization: Bearer <idToken>`.
 * Returns null when the header is missing/invalid or the Admin SDK is not
 * configured — callers respond 401. The Adobe pipeline is authenticated-only
 * (it spends a billable provider call and stages private objects).
 */
export async function requireUser(headers: RawHeaders): Promise<AuthedUser | null> {
    const authHeader = headerValue(headers, 'authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    initializeFirebaseAdmin();
    const app = getFirebaseAdmin();
    if (!app) return null;

    try {
        const decoded = await getAuth(app).verifyIdToken(authHeader.slice('Bearer '.length));
        return { uid: decoded.uid, email: decoded.email };
    } catch {
        return null;
    }
}

/**
 * Fixed-window rate limiter over the shared Redis connection, mirroring
 * security.middleware.ts's fail-open stance: a Redis outage must not take the
 * endpoint down. Returns `true` when the request is allowed.
 */
export async function rateLimit(identifier: string, limit: number, windowSeconds: number): Promise<boolean> {
    const key = `rate_limit:${identifier}`;
    try {
        const current = await redis.incr(key);
        if (current === 1) {
            await redis.expire(key, windowSeconds);
        }
        return current <= limit;
    } catch (err) {
        logger.warn({ key, err }, 'Serverless rate limit Redis error (fail-open)');
        return true;
    }
}

/** Best-effort client IP extraction behind Vercel's proxy. */
export function clientIp(headers: RawHeaders): string {
    const forwarded = headerValue(headers, 'x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return headerValue(headers, 'x-real-ip') || 'unknown';
}
