import { buildServer } from './api/server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { ensureStorageLayout } from './services/storage.service.js';
import { startCompressionWorker } from './workers/compression.worker.js';
import { startConversionWorker } from './workers/conversion.worker.js';
import { startCleanupWorker } from './workers/cleanup.worker.js';
import { initializeFirebaseAdmin } from './config/firebase.js';

async function startApi() {
    initializeFirebaseAdmin();
    await ensureStorageLayout();

    const app = await buildServer();
    await app.listen({
        host: env.HOST,
        port: env.PORT,
    });

    logger.info({ host: env.HOST, port: env.PORT }, 'Conversion API server started');
    
    // Start workers inline only when explicitly enabled (local dev).
    // In production, run the separate worker process (index.worker.js).
    if (env.RUN_INLINE_WORKERS) {
        startCompressionWorker();
        startConversionWorker();
        startCleanupWorker();
        logger.info('Inline workers started successfully');
    } else {
        logger.info('Inline workers disabled — starting separate worker process for jobs');
    }
}

startApi().catch((error) => {
    logger.error({ err: error }, 'Failed to start API server');
    process.exit(1);
});
