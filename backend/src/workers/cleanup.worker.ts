import { workerPool } from '../db/client.js';
import { resolveStoragePath } from '../services/storage.service.js';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../config/logger.js';
import { auditService } from '../services/audit.service.js';

// Runs every hour — marks expired jobs, triggers file deletion
export async function cleanupExpiredJobs() {
  try {
    const result = await workerPool.query(`
      SELECT id, storage_path FROM jobs
      WHERE expires_at < NOW()
        AND status = 'completed'
        AND storage_path IS NOT NULL
      LIMIT 100
    `);

    for (const job of result.rows) {
      try {
        const absolutePath = resolveStoragePath(job.storage_path);
        // Recursively delete workspace directory/file
        await fs.rm(absolutePath, { recursive: true, force: true });
        
        // Also delete parent job directory if it is empty/part of job workspace
        const parentDir = path.dirname(absolutePath);
        if (parentDir.endsWith(job.id)) {
            await fs.rm(parentDir, { recursive: true, force: true }).catch(() => {});
        }
      } catch (e: any) {
        logger.warn({ jobId: job.id, err: e.message }, 'Could not delete expired file from filesystem');
      }

      // Clear storage path and download token
      await workerPool.query(`
        UPDATE jobs SET
          storage_path = NULL,
          download_token = NULL,
          status = 'expired'
        WHERE id = $1
      `, [job.id]);

      auditService.log({
          eventType: 'file.deleted',
          severity: 'info',
          resourceId: job.id,
          metadata: { reason: 'expiry' }
      }, 'worker');
    }
  } catch (err: any) {
    logger.error({ err }, 'Failed to run cleanup cron for expired files');
  }
}



export function startCleanupWorker() {
    setInterval(cleanupExpiredJobs, 60 * 60 * 1000); // every hour
    logger.info('Cleanup worker started successfully');
}
