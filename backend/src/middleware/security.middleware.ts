import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redisConnection } from '../queue/connection.js';
import crypto from 'crypto';

/**
 * Rate limiting middleware - limit requests per IP
 */
export async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    limit: number = 100,
    windowSeconds: number = 60
) {
    const ip = request.ip || 'unknown';
    const key = `rate_limit:${ip}`;

    const current = await redisConnection.incr(key);
    if (current === 1) {
        await redisConnection.expire(key, windowSeconds);
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
    // Rate limit OTP requests: 5 per minute per IP
    app.addHook('onRequest', async (request, reply) => {
        if (request.url.includes('/otp/request') || request.url.includes('/auth/otp/request')) {
            await rateLimitMiddleware(request, reply, 5, 60);
        }
    });

    // Rate limit conversion uploads: 20 per 5 minutes per IP
    app.addHook('onRequest', async (request, reply) => {
        if (request.url === '/v1/files/upload' && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 20, 300);
        }
    });

    // Rate limit compression: 50 per 10 minutes per IP
    app.addHook('onRequest', async (request, reply) => {
        if (request.url === '/v1/compress' && request.method === 'POST') {
            await rateLimitMiddleware(request, reply, 50, 600);
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

/**
 * Get token from cookie or Authorization header
 */
export function extractAuthToken(request: FastifyRequest): string | null {
    // Try Authorization header first (Bearer token)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Try httpOnly cookie
    const token = request.cookies.accessToken;
    if (token) {
        return token;
    }

    return null;
}
