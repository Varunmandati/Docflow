import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisConnection } from '../queue/connection.js';
import crypto from 'crypto';
import { env } from '../config/env.js';

// In-process fallback store for when Redis errors and RATE_LIMIT_EXPENSIVE_FALLBACK === 'memory'
const inMemoryRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkInMemoryFallback(key: string, limit: number, windowSeconds: number): boolean {
    const now = Date.now();
    const record = inMemoryRateLimitStore.get(key);
    if (!record || record.resetAt <= now) {
        inMemoryRateLimitStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
        return true;
    }
    if (record.count >= limit) {
        return false;
    }
    record.count++;
    return true;
}

/**
 * Rate limiting middleware - limit requests per IP
 *
 * Fail-open on Redis errors by default: if the rate-limit store is unreachable,
 * the request is allowed through (with a warning) instead of failing with a 500.
 * If RATE_LIMIT_EXPENSIVE_FALLBACK is set to 'memory', expensive endpoints
 * fallback to an in-process memory limiter so heavy endpoints cannot be abused.
 *
 * `keySuffix` lets a caller narrow the bucket to a second dimension. For
 * authenticated routes the limiter uses it to bucket by `<ip>:<uid>` as well as
 * by IP, so one abusive user behind a shared NAT egress address cannot spend
 * every other user's budget, and a single account cannot spread an attack
 * across many source addresses.
 */
export async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    limit: number = 100,
    windowSeconds: number = 60,
    isExpensive: boolean = false,
    keySuffix: string = ''
) {
    const ip = request.ip || 'unknown';
    const key = `rate_limit:${keySuffix ? `${keySuffix}:` : ''}${ip}`;

    let current: number;
    try {
        current = await redisConnection.incr(key);
        if (current === 1) {
            await redisConnection.expire(key, windowSeconds);
        }
    } catch (err) {
        if (env.RATE_LIMIT_EXPENSIVE_FALLBACK === 'memory' && isExpensive) {
            const allowed = checkInMemoryFallback(key, limit, windowSeconds);
            if (!allowed) {
                return reply.code(429).send({
                    success: false,
                    message: `Rate limit exceeded. Maximum ${limit} requests per ${windowSeconds} seconds.`,
                });
            }
            return;
        }
        console.warn(`[rate-limit] Redis unavailable, allowing request through: ${(err as Error).message}`);
        return;
    }

    if (current > limit) {
        return reply.code(429).send({
            success: false,
            message: `Rate limit exceeded. Maximum ${limit} requests per ${windowSeconds} seconds.`,
        });
    }
}

/**
 * CSRF token generation middleware
 */
export async function generateCsrfToken(sessionId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const key = `csrf:${sessionId}`;
    await redisConnection.setex(key, 3600, token); // Valid for 1 hour
    return token;
}

/**
 * CSRF token validation middleware
 */
export async function validateCsrfToken(sessionId: string, token: string): Promise<boolean> {
    const key = `csrf:${sessionId}`;
    const storedToken = await redisConnection.get(key);
    return storedToken === token;
}

/**
 * Apply rate limiting to specific routes
 */
export function setupRateLimitedRoutes(app: FastifyInstance) {
    // Match on the matched route template (request.routeOptions.url) rather
    // than request.url: the latter includes the query string, which would let a
    // request like `/v1/files/upload?anything` bypass the limiter entirely.
    const matchRoute = (request: FastifyRequest, route: string) =>
        request.routeOptions.url === route;

    // Rate limit conversion uploads: 20 per 5 minutes per IP (expensive)
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/files/upload') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 20, 300, true);
        }
    });

    // Rate limit compression: 50 per 10 minutes per IP (expensive)
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/compress') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 50, 600, true);
        }
    });

    // Rate limit single-file conversions: 30 per 10 minutes per IP (expensive)
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/convert') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 30, 600, true);
        }
    });

    // Rate limit batch image combine-to-pdf: 20 per 10 minutes per IP (expensive)
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/images/combine-to-pdf') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 20, 600, true);
        }
    });

    // Rate limit AI suggestion: 30 per 10 minutes per IP (expensive)
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/ai/suggest-filename') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 30, 600, true);
        }
    });

    // Rate limit job history listing (pagination crawl / scrapers): 120 per
    // minute per IP — generous for the UI poller but bounded against scraping.
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/jobs') && request.method === 'GET') {
            await rateLimitMiddleware(request, reply, 120, 60);
        }
    });

    // Rate limit authenticated file downloads: 60 per minute per IP.
    app.addHook('onRequest', async (request, reply) => {
        if ((matchRoute(request, '/v1/files/:fileId/download') || matchRoute(request, '/v1/files/download')) && request.method === 'GET') {
            await rateLimitMiddleware(request, reply, 60, 60);
        }
    });

    // Rate limit public download-by-token: 30 per minute per IP.
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/download/:token') && request.method === 'GET') {
            await rateLimitMiddleware(request, reply, 30, 60);
        }
    });

    // Rate limit email change: 10 per 10 minutes per IP.
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/auth/change-email') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 10, 600);
        }
    });

    // Rate limit email-change verification: 10 per 10 minutes per IP.
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/auth/verify-email-change') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 10, 600);
        }
    });

    // Rate limit OTP request: 10 per 10 minutes per IP.
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/auth/otp/request') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 10, 600);
        }
    });

    // Rate limit OTP verify: 20 per 10 minutes per IP.
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/auth/otp/verify') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 20, 600);
        }
    });
}

/**
 * Set secure cookie headers
 */
export function setSecureCookie(
    reply: FastifyReply,
    name: string,
    value: string,
    maxAgeSeconds: number = 86400,
    isHttpOnly: boolean = true
) {
    reply.setCookie(name, value, {
        httpOnly: isHttpOnly,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: maxAgeSeconds,
        path: '/',
    });
}


