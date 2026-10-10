/**
 * QStash callback: conversion jobs.
 *
 * QStash delivers the JSON body published by /v1/convert (via qstashPublish)
 * to this function; the shared processor (also used by the BullMQ worker)
 * runs the conversion and persists progress into Postgres, which the frontend
 * polls exactly as before.
 */
import { verifyQStashRequest } from '../../backend/dist/serverless/qstash-verify.js';
import { sendJson, BareResponse } from '../../backend/dist/serverless/http.js';
import { processConversionJob, persistConversionFailure } from '../../backend/dist/workers/conversion.worker.js';
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
        await processConversionJob(data, retried === 0);
        return sendJson(res, 200, { ok: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Conversion failed.';
        await persistConversionFailure(data.jobId, data.userId, message, isFinal);
        // Non-2xx instructs QStash to redeliver (its retry budget was set at
        // publish time); the DB status only goes terminal on the final attempt.
        return sendJson(res, 500, { ok: false, message, retried });
    }
}
