import 'fastify';

// Extend FastifyRequest to include Firebase user
declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            uid: string;
            email?: string;
            name?: string;
            picture?: string;
            iat?: number;
            exp?: number;
            [key: string]: unknown;
        };
    }
}