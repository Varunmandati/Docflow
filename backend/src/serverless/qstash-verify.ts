import crypto from 'crypto';
import { env } from '../config/env.js';

function headerValue(
    headers: Record<string, string | string[] | undefined>,
    name: string
): string | undefined {
    const direct = headers[name] ?? headers[name.toLowerCase()];
    if (direct === undefined) return undefined;
    return Array.isArray(direct) ? direct[0] : direct;
}

/**
 * Verify a QStash delivery and report its retry count.
 *
 * QStash signs every delivery as a JWS compact token in the `Upstash-Signature`
 * header: base64url(header).base64url(payload).base64url(HMAC-SHA256(key, header.payload)).
 * Recomputing the HMAC with the console's current AND next signing keys
 * (rotation-safe) authenticates the callback without a shared URL secret.
 *
 * When no signing keys are configured, falls back to a CRON_SECRET bearer
 * check — workable, but the signing keys are strongly preferred.
 */
export function verifyQStashRequest(headers: Record<string, string | string[] | undefined>): {
    ok: boolean;
    retried: number;
} {
    const retried = Number(headerValue(headers, 'upstash-retried') ?? 0) || 0;

    const keys = [
        env.QSTASH_SIGNING_KEY?.trim(),
        env.QSTASH_SIGNING_KEY_NEXT?.trim(),
    ].filter((k): k is string => !!k);

    if (keys.length > 0) {
        const signature = headerValue(headers, 'upstash-signature');
        const parts = signature ? signature.split('.') : [];
        if (parts.length !== 3) {
            return { ok: false, retried };
        }
        const signingInput = `${parts[0]}.${parts[1]}`;
        const ok = keys.some((key) => {
            const expected = crypto.createHmac('sha256', key).update(signingInput).digest('base64url');
            const a = Buffer.from(expected);
            const b = Buffer.from(parts[2]);
            if (a.length !== b.length) return false;
            return crypto.timingSafeEqual(a, b);
        });
        return { ok, retried };
    }

    const auth = headerValue(headers, 'authorization') ?? '';
    const expected = env.CRON_SECRET?.trim();
    if (!expected) {
        return { ok: false, retried };
    }
    return { ok: auth === `Bearer ${expected}`, retried };
}
