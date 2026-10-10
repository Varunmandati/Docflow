/**
 * QStash callback: compression and batch image-combine jobs.
 *
 * Mirrors api/jobs/convert.ts — same verification, same shared processors the
 * BullMQ worker uses, same Postgres-backed polling contract.
 */
import { verifyQStashRequest } from '../../backend/dist/serverless/qstash-verify.js';
import { sendJson, BareResponse } from '../../backend/dist/serverless/http.js';
import { processCompressionJob, persistCompressionFailure } from '../../backend/dist/workers/compression.worker.js';
import { env } from '../../backend/dist/config/env.js';

export default async function handler(req: any, res: BareResponse): Promise<void> {
    if (!env.IS_QSTASH_QUEUE) {
        return sendJson(res, 404, { message: 'QStash callbacks are not enabled on this deployment.' });
    }

    const { ok, retried } = verifyQStashRequest(req.headers ?? {});
    if (!ok) {
        return sendJson(res, 401, { message: 'Unauthorized' });
    }

    const data = req.body;
    if (!data || typeof data !== 'object' || !data.jobId) {
        return sendJson(res, 400, { message: 'Missing jobId in job payload.' });
    }

    const maxRetries = Math.max(0, env.JOB_ATTEMPTS - 1);
    const isFinal = retried >= maxRetries;

    try {
        await processCompressionJob(data, retried === 0);
        return sendJson(res, 200, { ok: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Compression failed.';
        await persistCompressionFailure(data.jobId, data.userId, message, isFinal);
        return sendJson(res, 500, { ok: false, message, retried });
    }
}
