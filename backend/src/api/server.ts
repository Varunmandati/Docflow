import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { env } from '../config/env.js';
import { registerRoutes } from './routes.js';

export async function buildServer() {
    const app = Fastify({
        logger: false,
        bodyLimit: 100 * 1024 * 1024, // Reduced from 300MB to 100MB
    });

    await app.register(cors, {
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((value) => value.trim()),
        credentials: true,
    });

    await app.register(cookie);

    await app.register(multipart, {
        limits: {
            fileSize: 100 * 1024 * 1024, // Reduced from 300MB to 100MB
        },
    });

    await registerRoutes(app);
    return app;
}
