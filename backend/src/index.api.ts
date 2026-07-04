import { buildServer } from './api/server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { ensureStorageLayout } from './services/storage.service.js';
import { startCompressionWorker } from './workers/compression.worker.js';
import { startConversionWorker } from './workers/conversion.worker.js';
import { startUploadWorker } from './workers/upload.worker.js';
import { startCleanupWorker } from './workers/cleanup.worker.js';

async function startApi() {
    await ensureStorageLayout();

    const app = await buildServer();
    await app.listen({
        host: env.HOST,
        port: env.PORT,
    });

    logger.info({ host: env.HOST, port: env.PORT }, 'Conversion API server started');
    
    // Start workers inline for local development
    startCompressionWorker();
    startConversionWorker();
    startUploadWorker();
    startCleanupWorker();
    logger.info('Inline workers started successfully');
}

startApi().catch((error) => {
    logger.error({ err: error }, 'Failed to start API server');
    process.exit(1);
});
