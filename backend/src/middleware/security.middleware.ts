import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisConnection } from '../queue/connection.js';
import crypto from 'crypto';

/**
 * Rate limiting middleware - limit requests per IP
 *
 * Fail-open on Redis errors: if the rate-limit store is unreachable, the
 * request is allowed through (with a warning) instead of failing with a 500.
 * This keeps every API route usable even when Redis is down, at the cost of
 * rate-limit enforcement during that window. Normal operation still enforces
 * the configured limits.
 */
export async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    limit: number = 100,
    windowSeconds: number = 60
) {
    const ip = request.ip || 'unknown';
    const key = `rate_limit:${ip}`;

    let current: number;
    try {
        current = await redisConnection.incr(key);
        if (current === 1) {
            await redisConnection.expire(key, windowSeconds);
        }
    } catch (err) {
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

    // Rate limit conversion uploads: 20 per 5 minutes per IP
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/files/upload') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 20, 300);
        }
    });

    // Rate limit compression: 50 per 10 minutes per IP
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/compress') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 50, 600);
        }
    });

    // Rate limit single-file conversions: 30 per 10 minutes per IP
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/convert') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 30, 600);
        }
    });

    // Rate limit batch image combine-to-pdf: 20 per 10 minutes per IP
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/images/combine-to-pdf') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 20, 600);
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

    // Rate limit email change: 10 per hour per IP (sensitive account action).
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/auth/change-email') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 10, 3600);
        }
    });

    // Rate limit email-change verification: 10 per 10 minutes per IP.
    app.addHook('onRequest', async (request, reply) => {
        if (matchRoute(request, '/v1/auth/verify-email-change') && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 10, 600);
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


