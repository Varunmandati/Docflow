import { logger } from './config/logger.js';
import { env, ensureStorageRootLayout } from './config/env.js';
import { ensureStorageLayout } from './services/storage.service.js';
import { startConversionWorker } from './workers/conversion.worker.js';
import { startCompressionWorker } from './workers/compression.worker.js';
import { startCleanupWorker } from './workers/cleanup.worker.js';
import { startWorkerHeartbeat, clearWorkerHeartbeat } from './workers/heartbeat.js';
import { closeDatabaseConnections, withApiClient } from './db/client.js';
import { redis } from './queue/connection.js';

let shuttingDown = false;

async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker process');
    // Drop the heartbeat first so /v1/health reports the worker as stale while
    // it is draining, rather than continuing to advertise a live worker for the
    // whole graceful-shutdown window.
    await clearWorkerHeartbeat();
    try {
        await Promise.all([closeDatabaseConnections(), redis.quit()]);
    } catch (err) {
        logger.error({ err }, 'Error during worker shutdown');
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function startWorker() {
    // Fail fast on a missing or unwritable STORAGE_ROOT. Without this the
    // worker happily starts and fails every job later with an ENOENT that looks
    // like a converter bug.
    ensureStorageRootLayout();
    await ensureStorageLayout();

    startWorkerHeartbeat();

    startConversionWorker();
    startCompressionWorker();
    // Expired-artifact reclamation must run in the dedicated worker process
    // too; previously it only started under RUN_INLINE_WORKERS in index.api.ts,
    // so a production split deployment never expired storage.
    startCleanupWorker();

    // Start background OTP cleanup task (runs every hour)
    setInterval(async () => {
        try {
            await withApiClient(async (client) => {
                const res = await client.query(`DELETE FROM otps WHERE expires_at < NOW()`);
                if (res.rowCount && res.rowCount > 0) {
                    logger.info(`Cleaned up ${res.rowCount} expired OTPs`);
                }
            });
        } catch (err) {
            logger.error({ err }, 'Failed to clean up expired OTPs');
        }
    }, 60 * 60 * 1000); // 1 hour

    logger.info(
        {
            storageRoot: env.STORAGE_ROOT,
            workerConcurrency: env.WORKER_CONCURRENCY,
            heavyJobConcurrency: env.HEAVY_JOB_CONCURRENCY ?? 'unlimited',
        },
        'Conversion and compression workers started'
    );
}

startWorker().catch((error) => {
    logger.error({ err: error }, 'Failed to start conversion worker');
    process.exit(1);
});
