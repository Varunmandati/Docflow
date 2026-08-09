import { logger } from './config/logger.js';
import { ensureStorageLayout } from './services/storage.service.js';
import { startConversionWorker } from './workers/conversion.worker.js';
import { startCompressionWorker } from './workers/compression.worker.js';
import { withApiClient } from './db/client.js';

async function startWorker() {
    await ensureStorageLayout();
    startConversionWorker();
    startCompressionWorker();

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
