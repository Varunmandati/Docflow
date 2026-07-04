import { JobResult, JobStatus } from '../models/types.js';

// In-memory store for local testing
const store = new Map<string, string>();
const timers = new Map<string, NodeJS.Timeout>();

const statusKey = (jobId: string) => `job:status:${jobId}`;
const resultKey = (jobId: string) => `job:result:${jobId}`;
const RETENTION_SECONDS = 7 * 24 * 60 * 60;

const memorySetEx = async (key: string, value: string, ttl: number) => {
    store.set(key, value);
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => store.delete(key), ttl * 1000));
};

export async function updateJobStatus(
    jobId: string,
    patch: Partial<Omit<JobStatus, 'jobId' | 'updatedAt'>>
): Promise<JobStatus> {
    const current = await getJobStatus(jobId);

    const next: JobStatus = {
        jobId,
        status: patch.status ?? current?.status ?? 'queued',
        stage: patch.stage ?? current?.stage ?? 'queued',
        progress: patch.progress ?? current?.progress ?? 0,
        message: patch.message ?? current?.message,
        error: patch.error ?? current?.error,
        updatedAt: new Date().toISOString(),
    };

    await memorySetEx(statusKey(jobId), JSON.stringify(next), RETENTION_SECONDS);
    return next;
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
    const raw = store.get(statusKey(jobId));
    if (!raw) return null;
    return JSON.parse(raw) as JobStatus;
}

export async function setJobResult(jobId: string, result: JobResult): Promise<void> {
    await memorySetEx(resultKey(jobId), JSON.stringify(result), RETENTION_SECONDS);
}

export async function getJobResult(jobId: string): Promise<JobResult | null> {
    const raw = store.get(resultKey(jobId));
    if (!raw) return null;
    return JSON.parse(raw) as JobResult;
}
