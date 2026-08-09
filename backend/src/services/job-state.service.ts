import { workerPool } from '../db/client.js';
import { JobResult, JobStatus } from '../models/types.js';

/**
 * DB-backed job state — source of truth for live progress and final
 * results. Workers (docflow_worker, BYPASSRLS) update these rows; the
 * API reads them. No in-memory state, so nothing is lost on restart.
 */

export interface JobStatusPatch {
    status?: JobStatus['status'];
    stage?: string;
    progress?: number;
    message?: string;
    error?: string;
    // Final-artifact fields
    outputFilename?: string;
    outputSizeBytes?: number;
    storagePath?: string;
    downloadToken?: string;
    startedAt?: boolean;
    completedAt?: boolean;
    expiresAt?: Date;
}

export async function updateJobStatus(jobId: string, patch: JobStatusPatch): Promise<JobStatus | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.status !== undefined) {
        const dbStatus = patch.status === 'in_progress' ? 'processing' : patch.status;
        params.push(dbStatus);
        sets.push(`status = $${params.length}`);
    }
    if (patch.stage !== undefined) {
        params.push(patch.stage.slice(0, 64));
        sets.push(`stage = $${params.length}`);
    }
    if (patch.progress !== undefined) {
        params.push(Math.max(0, Math.min(100, Math.round(patch.progress))));
        sets.push(`progress = $${params.length}`);
    }
    if (patch.message !== undefined) {
        params.push(patch.message?.slice(0, 2000) ?? null);
        sets.push(`message = $${params.length}`);
    }
    if (patch.error !== undefined) {
        params.push(patch.error?.slice(0, 2000) ?? null);
        sets.push(`error_message = $${params.length}`);
    }
    if (patch.outputFilename !== undefined) {
        params.push(patch.outputFilename.slice(0, 512));
        sets.push(`output_filename = $${params.length}`);
    }
    if (patch.outputSizeBytes !== undefined) {
        params.push(patch.outputSizeBytes);
        sets.push(`output_size_bytes = $${params.length}`);
    }
    if (patch.storagePath !== undefined) {
        params.push(patch.storagePath);
        sets.push(`storage_path = $${params.length}`);
    }
    if (patch.downloadToken !== undefined) {
        params.push(patch.downloadToken);
        sets.push(`download_token = $${params.length}`);
    }
    if (patch.startedAt) {
        params.push(new Date());
        sets.push(`started_at = $${params.length}`);
    }
    if (patch.completedAt) {
        params.push(new Date());
        sets.push(`completed_at = $${params.length}`);
    }
    if (patch.expiresAt) {
        params.push(patch.expiresAt);
        sets.push(`expires_at = $${params.length}`);
    }

    if (sets.length === 0) return getJobStatus(jobId);

    const res = await workerPool.query(
        `UPDATE jobs SET ${sets.join(', ')} WHERE id = $${params.length + 1} RETURNING *`,
        [...params, jobId]
    );
    return res.rows[0] ? mapRowToStatus(res.rows[0]) : null;
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
    const res = await workerPool.query(
        `SELECT id, status, stage, progress, message, error_message, updated_at
         FROM jobs WHERE id = $1`,
        [jobId]
    );
    return res.rows[0] ? mapRowToStatus(res.rows[0]) : null;
}

export async function setJobResult(jobId: string, result: JobResult): Promise<void> {
    await workerPool.query(
        `UPDATE jobs SET result_json = $1::jsonb WHERE id = $2`,
        [JSON.stringify(result), jobId]
    );
}

export async function getJobResult(jobId: string): Promise<JobResult | null> {
    const res = await workerPool.query(
        `SELECT result_json FROM jobs WHERE id = $1`,
        [jobId]
    );
    if (!res.rows[0]?.result_json) return null;
    return res.rows[0].result_json as JobResult;
}

const DB_TO_API: Record<string, JobStatus['status']> = {
    queued: 'queued',
    processing: 'in_progress',
    completed: 'completed',
    failed: 'failed',
    expired: 'expired',
};

function mapRowToStatus(row: any): JobStatus {
    return {
        jobId: row.id,
        status: DB_TO_API[row.status] ?? 'queued',
        stage: row.stage ?? '',
        progress: Number(row.progress ?? 0),
        message: row.message ?? undefined,
        error: row.error_message ?? undefined,
        updatedAt: (row.updated_at ?? new Date()).toISOString(),
    };
}
