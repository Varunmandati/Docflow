import { workerPool } from '../db/client.js';
import { resolveStoragePath } from '../services/storage.service.js';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../config/logger.js';
import { auditService } from '../services/audit.service.js';
import { env } from '../config/env.js';

// Cleans up orphaned uploads and temp files older than ARTIFACT_TTL_MINUTES
export async function cleanupTempUploads() {
  const maxAgeMs = env.ARTIFACT_TTL_MINUTES * 60 * 1000;
  const now = Date.now();
  const dirsToClean = [
    path.join(env.STORAGE_ROOT, 'uploads'),
    path.join(env.STORAGE_ROOT, 'temp'),
  ];

  for (const dir of dirsToClean) {
    try {
      const entries = await fs.readdir(dir).catch(() => []);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = await fs.stat(fullPath);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
          }
        } catch {}
      }
    } catch (err: any) {
      logger.warn({ dir, err: err.message }, 'Failed to scan directory during temp uploads cleanup');
    }
  }
}

// Runs every hour — marks expired jobs, triggers file deletion
export async function cleanupExpiredJobs() {
  await cleanupTempUploads();
  if (env.IS_R2_STORAGE) {
    // R2 has no temp/ layout: the equivalent sweep is expired upload rows
    // (and their objects) in the uploads table.
    try {
      const { cleanupExpiredR2Uploads } = await import('../services/storage-r2.service.js');
      await cleanupExpiredR2Uploads();
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to sweep R2 uploads');
    }
  }
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
        if (env.IS_R2_STORAGE) {
          // The logical storage path is the bucket key prefix
          // (`jobs/{jobId}/output/<file>`); drop the whole workspace prefix.
          const { deleteByPrefix } = await import('../services/storage-r2.service.js');
          await deleteByPrefix(`jobs/${job.id}/`);
        } else {
          const absolutePath = resolveStoragePath(job.storage_path);
          // Recursively delete the artifact file and the whole `jobs/{jobId}`
          // workspace (input/, output/, pages/, images/, html/).
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
        }
      } catch (e: any) {
        logger.warn({ jobId: job.id, err: e.message }, 'Could not delete expired file from storage');
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

/**
 * Delete expired OTP rows. Extracted from index.worker.ts so the serverless
 * cron (api/cron/cleanup.ts) runs the same sweep as the long-lived worker.
 */
export async function cleanupExpiredOtps(): Promise<void> {
  try {
    const result = await workerPool.query(`DELETE FROM otps WHERE expires_at < NOW()`);
    if (result.rowCount && result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} expired OTPs`);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to clean up expired OTPs');
  }
}
