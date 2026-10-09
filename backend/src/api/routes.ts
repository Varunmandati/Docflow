import { FastifyInstance } from 'fastify';
import { logger } from '../config/logger.js';
import { setupRateLimitedRoutes } from '../middleware/security.middleware.js';
import { filesRoutes } from './routes/files.routes.js';
import { jobsRoutes } from './routes/jobs.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { configRoutes } from './routes/config.routes.js';
import { aiRoutes } from './routes/ai.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
    // Setup rate limiting
    setupRateLimitedRoutes(app);

    // Register all domain routes
    await app.register(healthRoutes);
    await app.register(filesRoutes);
    await app.register(jobsRoutes);
    await app.register(profileRoutes);
    await app.register(authRoutes);
    await app.register(configRoutes, { prefix: '/v1/config' });
    await app.register(aiRoutes);

    // Global Error Handler
    app.setErrorHandler((error, request, reply) => {
        logger.error({ err: error, method: request.method, url: request.url }, 'API error');
        const statusCode = (error as any)?.statusCode && Number((error as any).statusCode) >= 400
            ? Number((error as any).statusCode)
            : 500;
        reply.code(statusCode).send({
            success: false,
            message: statusCode === 500 ? 'Internal server error.' : ((error as any)?.message || 'Request failed.'),
        });
    });
}
