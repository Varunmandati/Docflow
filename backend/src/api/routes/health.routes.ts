import { FastifyInstance } from 'fastify';
import { checkDatabaseHealth } from '../../db/client.js';
import { redisConnection } from '../../queue/connection.js';
import { conversionQueue, compressionQueue } from '../../queue/queues.js';

export async function healthRoutes(app: FastifyInstance) {
    app.get('/v1/health', async (request, reply) => {
        const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

        let redisHealthy = false;
        try {
            await Promise.race([redisConnection.ping(), timeout(3000)]);
            redisHealthy = true;
        } catch (e) {
            redisHealthy = false;
        }

        let dbHealthy = false;
        try {
            dbHealthy = await Promise.race([
                checkDatabaseHealth(),
                new Promise<boolean>(resolve => setTimeout(() => resolve(false), 8000)),
            ]);
        } catch (e) {
            dbHealthy = false;
        }

        const status = dbHealthy && redisHealthy ? 'ok' : 'degraded';
        return {
            status,
            timestamp: new Date().toISOString(),
        };
    });
}
