import { logger } from './config/logger.js';
import { ensureStorageLayout } from './services/storage.service.js';
import { startConversionWorker } from './workers/conversion.worker.js';
import { startCompressionWorker } from './workers/compression.worker.js';
import { startUploadWorker } from './workers/upload.worker.js';

async function startWorker() {
    await ensureStorageLayout();
    startConversionWorker();
    startCompressionWorker();
    startUploadWorker();
    logger.info('Conversion, compression, and upload workers started');
}

startWorker().catch((error) => {
    logger.error({ err: error }, 'Failed to start conversion worker');
    process.exit(1);
});
