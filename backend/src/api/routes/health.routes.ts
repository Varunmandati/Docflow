import { FastifyInstance } from 'fastify';
import { checkDatabaseHealth } from '../../db/client.js';
import { redisConnection } from '../../queue/connection.js';
import { conversionQueue, compressionQueue } from '../../queue/queues.js';
import { env } from '../../config/env.js';

export async function healthRoutes(app: FastifyInstance) {
    // Lightweight liveness/warmup check: no DB or Redis calls, returns 200 immediately.
    // This is the Docker HEALTHCHECK target. It must stay cheap: it runs every
    // few seconds forever, and the container is restarted if it ever blocks.
    app.get('/health', async (_request, reply) => {
        return reply.code(200).send({
            status: 'ok',
            timestamp: new Date().toISOString(),
        });
    });

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

        // Worker liveness. A BullMQ worker that is running but wedged (blocked
        // in a LibreOffice call that will never return, say) produces no signal
        // on Redis: its queue is still registered, the connection is still
        // open, and jobs simply stop moving. The worker process therefore
        // heartbeats a key with a TTL, and staleness of that key is the only
        // honest answer to "is anything actually processing jobs right now".
        let workerHeartbeatAgeMs: number | null = null;
        let workerHealthy = true;
        if (env.IS_QSTASH_QUEUE) {
            // Serverless: there is no long-lived worker to heartbeat — QStash
            // drives per-job serverless executions. Redis+DB health below is
            // the honest signal for this deployment shape.
            workerHealthy = true;
        } else {
            try {
                const beat = await Promise.race([
                    redisConnection.get(env.WORKER_HEARTBEAT_KEY),
                    timeout(3000),
                ]);
                if (beat) {
                    workerHeartbeatAgeMs = Math.max(0, Date.now() - Number(beat));
                    workerHealthy = workerHeartbeatAgeMs <= env.WORKER_HEARTBEAT_STALE_MS;
                } else {
                    // No key at all. Either the worker has not started yet, or this
                    // deployment runs inline workers inside the API process.
                    workerHealthy = env.RUN_INLINE_WORKERS;
                }
            } catch (e) {
                workerHealthy = false;
            }
        }

        // Queue depth is cheap to read and turns "degraded" into an actionable
        // diagnosis. A deep `waiting` backlog with a healthy worker means jobs
        // are queued faster than WORKER_CONCURRENCY can drain them. Skipped on
        // QStash: BullMQ keys never exist there, and every probe would spend
        // Upstash free-tier commands on an empty answer.
        let queue: { waiting: number; active: number; failed: number } | null = null;
        if (redisHealthy && !env.IS_QSTASH_QUEUE) {
            try {
                const counts = await Promise.race([
                    conversionQueue.getJobCounts('waiting', 'active', 'failed'),
                    timeout(3000),
                ]);
                queue = {
                    waiting: counts.waiting ?? 0,
                    active: counts.active ?? 0,
                    failed: counts.failed ?? 0,
                };
            } catch (e) {
                // Depth is diagnostics, not health. Do not fail the probe on it.
            }
        }

        const status = dbHealthy && redisHealthy && workerHealthy ? 'ok' : 'degraded';
        const body = {
            status,
            timestamp: new Date().toISOString(),
            checks: {
                database: dbHealthy ? 'ok' : 'down',
                redis: redisHealthy ? 'ok' : 'down',
                worker: workerHealthy ? 'ok' : 'stale',
            },
            workerHeartbeatAgeMs,
            queue,
        };

        // Report degradation with a non-2xx status so an external monitor or
        // `docker compose ps` notices. The previous behaviour always returned
        // 200, which meant a total Redis+DB outage was indistinguishable from
        // healthy to anything that only looks at the status code.
        return reply.code(status === 'ok' ? 200 : 503).send(body);
    });
}
