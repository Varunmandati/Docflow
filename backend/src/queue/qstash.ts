import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * QStash publisher (serverless queue transport).
 *
 * QStash delivers the JSON body via HTTP POST to the mapped destination and
 * handles retries/delays itself; the receiving functions under api/jobs/*
 * verify the Upstash signature and run the extracted job processors. This
 * module has no SDK dependency — QStash is a plain REST API.
 */

const DESTINATIONS: Record<string, string> = {
    'convert-document': '/api/jobs/convert',
    'compress-document': '/api/jobs/compress',
    'batch-combine-images': '/api/jobs/compress',
};

export async function qstashPublish(jobName: string, jobData: { jobId: string } & Record<string, unknown>): Promise<void> {
    const destPath = DESTINATIONS[jobName];
    if (!destPath) {
        throw new Error(`QStash has no destination mapping for job "${jobName}".`);
    }
    if (!env.QSTASH_TOKEN?.trim()) {
        throw new Error('QStash publish requires QSTASH_TOKEN.');
    }
    if (!env.QSTASH_TARGET_BASE?.trim()) {
        throw new Error('QStash publish requires QSTASH_TARGET_BASE (the public URL of this deployment).');
    }

    const destination = `${env.QSTASH_TARGET_BASE.replace(/\/+$/, '')}${destPath}`;
    const url = `${env.QSTASH_URL.replace(/\/+$/, '')}/publish/${destination}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.QSTASH_TOKEN.trim()}`,
            'Content-Type': 'application/json',
            // Mirrors BullMQ `attempts`: first delivery + (JOB_ATTEMPTS - 1) retries.
            'Upstash-Retries': String(Math.max(0, env.JOB_ATTEMPTS - 1)),
        },
        body: JSON.stringify(jobData),
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`QStash publish failed (${res.status}): ${body.slice(0, 300)}`);
    }

    logger.info({ jobName, jobId: jobData.jobId, destination }, 'Published job to QStash');
}
