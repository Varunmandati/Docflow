import fs from 'fs/promises';
import path from 'path';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { EngineConversionResult, EngineOptions } from './ConverterEngine.js';

const DEFAULT_BASE = 'https://api.cloudconvert.com/v2';

// Our format slug -> CloudConvert format slug. Only the aliases that differ.
const CLOUDCONVERT_FORMAT_ALIASES: Record<string, string> = {
    'tar.gz': 'tgz',
};

export function mapCloudConvertFormat(format: string): string {
    return CLOUDCONVERT_FORMAT_ALIASES[format] ?? format;
}

const REMOTE_TIMEOUT_MS = Math.max(60_000, env.CONVERSION_TIMEOUT_MS || 180_000);

interface CloudConvertTask {
    id: string;
    operation: string;
    status: string;
    message?: string;
    code?: string;
    links?: { put?: string; get?: string };
    result?: { files?: Array<{ url?: string; filename?: string }> };
}

interface CloudConvertJob {
    data?: {
        id?: string;
        status?: string;
        tasks?: CloudConvertTask[];
    };
}

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
    const key = env.CLOUDCONVERT_API_KEY?.trim();
    if (!key) {
        throw new Error(
            'This conversion (audio, video, or 7z) requires the CloudConvert provider: set CLOUDCONVERT_API_KEY.'
        );
    }
    return fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${key}`,
            Accept: 'application/json',
            ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
}

function describeJobFailure(job: CloudConvertJob): string {
    const failed = (job.data?.tasks ?? []).filter((t) => t.status === 'error');
    const detail = failed
        .map((t) => t.message || t.code || t.status)
        .filter(Boolean)
        .join('; ');
    return detail || 'unknown provider error';
}

/**
 * Convert audio/video/7z pairs through CloudConvert (the second free-tier
 * provider). ConvertAPI has no audio or video support and cannot convert
 * between archive formats, so the processor routes those categories here.
 *
 * Flow: create job (import/upload + convert + export/url) -> PUT the bytes
 * onto the signed upload link -> block on GET /jobs/{id}?wait=true -> pull
 * the signed result URL. One synchronous call from the processor's point of
 * view, bounded by the same remote timeout as ConvertAPI calls.
 */
export async function convertViaCloudConvert(args: {
    inputPath: string;
    outputDir: string;
    sourceFormat: string;
    targetFormat: string;
    options?: EngineOptions;
}): Promise<EngineConversionResult> {
    const startedAt = Date.now();
    const { inputPath, outputDir, sourceFormat, targetFormat } = args;
    const base = (env.CLOUDCONVERT_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');

    const fileName = path.basename(inputPath);
    const jobBody = {
        tasks: {
            'import-file': { operation: 'import/upload', file: fileName },
            'convert-file': {
                operation: 'convert',
                input: 'import-file',
                input_format: mapCloudConvertFormat(sourceFormat),
                target_format: mapCloudConvertFormat(targetFormat),
            },
            'export-file': { operation: 'export/url', input: 'convert-file' },
        },
    };

    const createRes = await apiFetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobBody),
    });
    if (!createRes.ok) {
        const detail = await createRes.text().catch(() => '');
        throw new Error(`CloudConvert job creation failed (${createRes.status}): ${detail.slice(0, 400)}`);
    }
    const created = (await createRes.json()) as CloudConvertJob;
    const jobId = created.data?.id;
    if (!jobId) {
        throw new Error('CloudConvert job creation returned no job id.');
    }

    const importTask = (created.data?.tasks ?? []).find((t) => t.operation === 'import/upload');
    const uploadUrl = importTask?.links?.put;
    if (!uploadUrl) {
        throw new Error('CloudConvert import task returned no upload link.');
    }

    const fileBytes = await fs.readFile(inputPath);
    const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(fileBytes),
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
    if (!putRes.ok) {
        throw new Error(`CloudConvert upload failed (${putRes.status}).`);
    }

    const waitRes = await apiFetch(`${base}/jobs/${jobId}?wait=true`, { method: 'GET' });
    if (!waitRes.ok) {
        const detail = await waitRes.text().catch(() => '');
        throw new Error(`CloudConvert job wait failed (${waitRes.status}): ${detail.slice(0, 400)}`);
    }
    const finished = (await waitRes.json()) as CloudConvertJob;
    if (finished.data?.status === 'error') {
        throw new Error(`CloudConvert conversion ${sourceFormat}->${targetFormat} failed: ${describeJobFailure(finished)}`);
    }

    const exportTask = (finished.data?.tasks ?? []).find(
        (t) => t.operation === 'export/url' && t.status === 'finished'
    );
    const files = exportTask?.result?.files ?? [];
    if (files.length === 0 || !files[0].url) {
        throw new Error(`CloudConvert conversion ${sourceFormat}->${targetFormat} returned no files.`);
    }

    const baseName = path.basename(inputPath, path.extname(inputPath));
    let outputPath = '';
    let sizeBytes = 0;
    for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        const dl = await fetch(entry.url!, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
        if (!dl.ok) {
            throw new Error(`CloudConvert result download failed (${dl.status}).`);
        }
        const bytes = Buffer.from(await dl.arrayBuffer());
        const ext =
            (entry.filename || '').split('.').pop() ||
            mapCloudConvertFormat(targetFormat);
        const outPath =
            files.length === 1
                ? path.join(outputDir, `${baseName}.${ext}`)
                : path.join(outputDir, `${baseName}-${i + 1}.${ext}`);
        await fs.writeFile(outPath, bytes);
        if (i === 0) {
            outputPath = outPath;
            sizeBytes = bytes.length;
        }
    }

    logger.info(
        { sourceFormat, targetFormat, files: files.length, durationMs: Date.now() - startedAt },
        'CloudConvert conversion completed'
    );

    return {
        outputPath,
        sizeBytes,
        durationMs: Date.now() - startedAt,
    };
}
