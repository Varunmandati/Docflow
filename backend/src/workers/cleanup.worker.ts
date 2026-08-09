import { workerPool } from '../db/client.js';
import { resolveStoragePath } from '../services/storage.service.js';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../config/logger.js';
import { auditService } from '../services/audit.service.js';
import { env } from '../config/env.js';

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
        // Recursively delete the artifact file and the whole `jobs/{jobId}`
        // workspace (input/, output/, pages/, images/, html/, .torrent-tmp).
        // Storage paths look like `jobs/{jobId}/output/<file>`; walk up to the
        // directory named after the job id so the full workspace is reclaimed.
        await fs.rm(absolutePath, { recursive: true, force: true });

        let cursor = path.dirname(absolutePath);
        const root = env.STORAGE_ROOT;
        while (cursor.startsWith(root)) {
          if (path.basename(cursor) === job.id) {
            await fs.rm(cursor, { recursive: true, force: true }).catch(() => {});
            break;
          }
          cursor = path.dirname(cursor);
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
      });
    }
  } catch (err: any) {
    logger.error({ err }, 'Failed to run cleanup cron for expired files');
  }
}



export function startCleanupWorker() {
    setInterval(cleanupExpiredJobs, 60 * 60 * 1000); // every hour
    logger.info('Cleanup worker started successfully');
}
