import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
    putObjectFromBuffer,
    getObjectBuffer,
    deleteKey,
    presignPut,
    presignGet,
} from './storage-r2.service.js';

/**
 * Durable state for the Adobe PDF -> DOCX pipeline.
 *
 * Jobs are stored as one small JSON object per job next to the staged input
 * and output, so the whole lifecycle lives in R2 and needs no database
 * migration or coupling to the existing `jobs` table (which the /v1/convert
 * pipeline owns). Keys:
 *
 *   pdf-docx/jobs/{jobId}.json    metadata + state machine
 *   pdf-docx/input/{jobId}.pdf    staged upload (browser -> R2 direct)
 *   pdf-docx/output/{jobId}.docx  finished artifact
 *
 * The jobId is a random UUID and every endpoint re-checks ownership against
 * the authenticated uid, so the keys are not guessable and stay private.
 */

export type PdfDocxJobStatus = 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';

export interface PdfDocxJob {
    jobId: string;
    userId: string;
    status: PdfDocxJobStatus;
    statusText: string;
    progress: number;
    inputKey: string;
    outputKey?: string;
    inputName: string;
    outputName: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    error?: string;
    // Denormalised Adobe job URI so a retried /start can resume polling instead
    // of submitting a duplicate billable operation.
    adobeJobUri?: string;
    adobeAssetId?: string;
}

const JOB_PREFIX = 'pdf-docx/jobs/';
const INPUT_PREFIX = 'pdf-docx/input/';
const OUTPUT_PREFIX = 'pdf-docx/output/';

export const inputKeyFor = (jobId: string): string => `${INPUT_PREFIX}${jobId}.pdf`;
export const outputKeyFor = (jobId: string): string => `${OUTPUT_PREFIX}${jobId}.docx`;
const jobKeyFor = (jobId: string): string => `${JOB_PREFIX}${jobId}.json`;

export function newJobId(): string {
    return randomUUID();
}

const ttlMs = (): number => env.PDF_DOCX_JOB_TTL_MINUTES * 60_000;

/** Strip a user-facing display name into a safe .docx base name. */
export function deriveOutputName(inputName: string): string {
    const base = (inputName || 'document').replace(/\\/g, '/').split('/').pop() || 'document';
    const stem = base.replace(/\.pdf$/i, '').replace(/[^\w .-]/g, '_').trim() || 'document';
    return `${stem}.docx`;
}

export async function createJob(input: {
    jobId: string;
    userId: string;
    inputName: string;
}): Promise<PdfDocxJob> {
    const now = new Date();
    const job: PdfDocxJob = {
        jobId: input.jobId,
        userId: input.userId,
        status: 'uploading',
        statusText: 'Waiting for upload',
        progress: 0,
        inputKey: inputKeyFor(input.jobId),
        inputName: input.inputName,
        outputName: deriveOutputName(input.inputName),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs()).toISOString(),
    };
    await saveJob(job);
    return job;
}

export async function saveJob(job: PdfDocxJob): Promise<void> {
    const body = Buffer.from(JSON.stringify(job));
    await putObjectFromBuffer(jobKeyFor(job.jobId), body, 'application/json');
}

export async function getJob(jobId: string): Promise<PdfDocxJob | null> {
    try {
        const buf = await getObjectBuffer(jobKeyFor(jobId));
        return JSON.parse(buf.toString('utf8')) as PdfDocxJob;
    } catch {
        return null;
    }
}

export async function updateJob(jobId: string, patch: Partial<PdfDocxJob>): Promise<PdfDocxJob | null> {
    const job = await getJob(jobId);
    if (!job) return null;
    const next: PdfDocxJob = { ...job, ...patch, jobId: job.jobId, updatedAt: new Date().toISOString() };
    await saveJob(next);
    return next;
}

export async function deleteJob(jobId: string): Promise<void> {
    await deleteKey(jobKeyFor(jobId));
    await deleteKey(inputKeyFor(jobId));
    await deleteKey(outputKeyFor(jobId));
}

/** Presigned browser-direct upload URL for the staged PDF. */
export async function presignJobInput(jobId: string, expiresInSeconds = 900): Promise<string> {
    return presignPut(inputKeyFor(jobId), 'application/pdf', expiresInSeconds);
}

/** Presigned short-lived download URL for the finished DOCX. */
export async function presignJobOutput(job: PdfDocxJob, expiresInSeconds = 3600): Promise<string | null> {
    if (!job.outputKey) return null;
    return presignGet(job.outputKey, {
        expiresInSeconds,
        downloadName: job.outputName,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
}

/** Public projection of a job — never exposes R2 keys or the Adobe job URI. */
export function toJobView(job: PdfDocxJob): Omit<PdfDocxJob, 'inputKey' | 'outputKey' | 'adobeJobUri' | 'adobeAssetId' | 'userId'> {
    return {
        jobId: job.jobId,
        status: job.status,
        statusText: job.statusText,
        progress: job.progress,
        inputName: job.inputName,
        outputName: job.outputName,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        expiresAt: job.expiresAt,
        error: job.error,
    };
}

/**
 * Sweep expired jobs (metadata JSON plus their staged input/output objects).
 * Invoked from the daily Vercel cron alongside the existing cleanup sweeps.
 * Returns the number of jobs removed.
 *
 * Orphaned staging objects (a browser that uploaded but never called /start,
 * so no metadata JSON exists) are reaped by an R2 bucket lifecycle rule on the
 * `pdf-docx/input/` and `pdf-docx/output/` prefixes; see README. The job
 * metadata is the authoritative expiry signal handled here.
 */
export async function cleanupExpiredPdfDocxJobs(): Promise<number> {
    if (!env.IS_R2_STORAGE) return 0;
    let removed = 0;
    try {
        const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
        const bucket = env.R2_BUCKET?.trim();
        if (!bucket) return 0;
        const client = new S3Client({
            region: 'auto',
            endpoint: env.R2_ENDPOINT,
            credentials: {
                accessKeyId: env.R2_ACCESS_KEY_ID || '',
                secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
            },
        });
        const keys: string[] = [];
        let token: string | undefined;
        do {
            const listed = await client.send(
                new ListObjectsV2Command({ Bucket: bucket, Prefix: JOB_PREFIX, ContinuationToken: token }),
            );
            for (const obj of listed.Contents ?? []) {
                if (obj.Key) keys.push(obj.Key);
            }
            token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
        } while (token);

        const now = Date.now();
        for (const key of keys) {
            try {
                const job = JSON.parse((await getObjectBuffer(key)).toString('utf8')) as PdfDocxJob;
                if (new Date(job.expiresAt).getTime() > now) continue;
                await deleteJob(job.jobId);
                removed += 1;
            } catch {
                // Corrupt/unreadable metadata: remove the key so it does not
                // accumulate, but leave the (unknown) staging objects alone.
                await deleteKey(key);
                removed += 1;
            }
        }
        if (removed > 0) {
            logger.info({ removed }, 'Swept expired PDF->DOCX jobs');
        }
    } catch (err) {
        logger.error({ err }, 'Failed to sweep expired PDF->DOCX jobs');
    }
    return removed;
}
