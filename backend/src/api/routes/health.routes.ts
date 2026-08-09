import { FastifyInstance } from 'fastify';
import { checkDatabaseHealth } from '../../db/client.js';
import { redisConnection } from '../../queue/connection.js';
import { conversionQueue, compressionQueue } from '../../queue/queues.js';

export async function healthRoutes(app: FastifyInstance) {
    app.get('/v1/health', async (request, reply) => {
        let redisHealthy = false;
        try {
            await redisConnection.ping();
            redisHealthy = true;
        } catch (e) {
            redisHealthy = false;
        }

        const [dbHealthy] = await Promise.all([
            checkDatabaseHealth()
        ]);

        // Real BullMQ queue statistics
        const queueStats = redisHealthy
            ? {
                conversion: await conversionQueue.getJobCounts().catch(() => null),
                compression: await compressionQueue.getJobCounts().catch(() => null),
            }
            : {
                conversion: null,
                compression: null,
            };

        const status = dbHealthy && redisHealthy ? 'ok' : 'degraded';
        return {
            status,
            timestamp: new Date().toISOString(),
            services: {
                database: dbHealthy ? 'ok' : 'error',
                redis: redisHealthy ? 'ok' : 'error',
                queues: {
                    status: redisHealthy ? 'ok' : 'degraded',
                    stats: queueStats
                }
            },
        };
    });
}
