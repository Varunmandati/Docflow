import { logger } from './config/logger.js';
import { ensureStorageLayout } from './services/storage.service.js';
import { startConversionWorker } from './workers/conversion.worker.js';
import { startCompressionWorker } from './workers/compression.worker.js';
import { startCleanupWorker } from './workers/cleanup.worker.js';
import { closeDatabaseConnections, withApiClient } from './db/client.js';
import { redis } from './queue/connection.js';

let shuttingDown = false;

async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker process');
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
    await ensureStorageLayout();
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

    logger.info('Conversion and compression workers started');
}

startWorker().catch((error) => {
    logger.error({ err: error }, 'Failed to start conversion worker');
    process.exit(1);
});
