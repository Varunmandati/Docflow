import { buildServer } from './api/server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { ensureStorageLayout } from './services/storage.service.js';
import { startCompressionWorker } from './workers/compression.worker.js';
import { startConversionWorker } from './workers/conversion.worker.js';
import { startCleanupWorker } from './workers/cleanup.worker.js';
import { initializeFirebaseAdmin } from './config/firebase.js';
import { closeDatabaseConnections } from './db/client.js';
import { redis } from './queue/connection.js';
import { runMigrations } from './db/migrate.js';

let shuttingDown = false;

async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down API server');
    try {
        await Promise.all([closeDatabaseConnections(), redis.quit()]);
    } catch (err) {
        logger.error({ err }, 'Error during API shutdown');
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function startApi() {
    if (env.RUN_MIGRATIONS_ON_START) {
        logger.info('RUN_MIGRATIONS_ON_START is enabled — running database migrations');
        await runMigrations();
        logger.info('Database migrations finished');
    }
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
