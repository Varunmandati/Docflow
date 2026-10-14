import { authFetch } from './authFetch';

/**
 * Adobe PDF Services PDF -> DOCX pipeline (server-side), used for authenticated
 * single-file conversions. The browser:
 *   1. POST /api/pdf-to-docx/init    -> presigned R2 upload URL
 *   2. PUT  the PDF straight to R2   (never through the API function)
 *   3. POST /api/pdf-to-docx/start   -> runs Adobe server-to-server
 *   4. GET  /api/pdf-to-docx/status  -> presigned DOCX download when done
 *
 * Every call throws on failure so the caller can fall back to the existing
 * conversion pipeline. Presigned R2 URLs are fetched WITHOUT the Authorization
 * header (an extra auth header would break the S3 signature).
 */

export interface PdfDocxProgress {
    percent: number;
    message: string;
}

export interface PdfDocxResult {
    name: string;
    url: string;
    format: 'docx';
}

const INIT_URL = '/api/pdf-to-docx/init';
const START_URL = '/api/pdf-to-docx/start';
const STATUS_URL = '/api/pdf-to-docx/status';
const UPLOAD_URL = '/api/pdf-to-docx/upload';
const DOWNLOAD_URL = '/api/pdf-to-docx/download';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function errorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json();
        if (data?.message) return String(data.message);
    } catch {
        // not JSON
    }
    return fallback;
}

export async function convertPdfToDocxViaAdobe(
    file: File,
    onProgress: (progress: PdfDocxProgress) => void = () => {},
    options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<PdfDocxResult> {
    const pollIntervalMs = options.pollIntervalMs ?? 1500;
    const timeoutMs = options.timeoutMs ?? 300_000;

    onProgress({ percent: 5, message: 'Preparing conversion' });

    // 1. Reserve the job.
    const initResponse = await authFetch(INIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, size: file.size, mimeType: file.type || 'application/pdf' }),
    });
    if (!initResponse.ok) {
        throw new Error(await errorMessage(initResponse, `Could not start conversion (${initResponse.status}).`));
    }
    const init = (await initResponse.json()) as { jobId: string; uploadUrl: string };
    if (!init.jobId || !init.uploadUrl) {
        throw new Error('Conversion init response was incomplete.');
    }

    // 2. Upload the PDF. Prefer the browser-direct R2 PUT (bypasses the
    //    serverless body cap) but fall back to a same-origin upload when the R2
    //    bucket has no CORS rule for this origin (the PUT/preflight is rejected).
    onProgress({ percent: 15, message: 'Uploading PDF' });
    let uploadedDirectly = false;
    try {
        const uploadResponse = await fetch(init.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/pdf' },
            body: file,
        });
        uploadedDirectly = uploadResponse.ok;
    } catch {
        uploadedDirectly = false;
    }
    if (!uploadedDirectly) {
        const fallbackResponse = await authFetch(`${UPLOAD_URL}?jobId=${encodeURIComponent(init.jobId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf' },
            body: file,
        });
        if (!fallbackResponse.ok) {
            throw new Error(await errorMessage(fallbackResponse, `Upload failed (${fallbackResponse.status}).`));
        }
    }

    // 3. Run the conversion.
    onProgress({ percent: 30, message: 'Converting with Adobe PDF Services' });
    const startResponse = await authFetch(START_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: init.jobId }),
    });
    if (!startResponse.ok) {
        throw new Error(await errorMessage(startResponse, `Conversion failed (${startResponse.status}).`));
    }

    // 4. Poll until the job completes (usually already done after /start).
    const startedAt = Date.now();
    for (;;) {
        const statusResponse = await authFetch(`${STATUS_URL}?jobId=${encodeURIComponent(init.jobId)}`);
        if (!statusResponse.ok) {
            throw new Error(await errorMessage(statusResponse, `Status check failed (${statusResponse.status}).`));
        }
        const payload = (await statusResponse.json()) as {
            job?: { status?: string; statusText?: string; progress?: number; outputName?: string; error?: string };
            downloadUrl?: string;
        };
        const job = payload.job || {};
        const percent = Math.max(30, Math.min(95, Number(job.progress ?? 30)));

        if (job.status === 'failed') {
            throw new Error(job.error || 'Conversion failed.');
        }
        if (job.status === 'completed' && payload.downloadUrl) {
            onProgress({ percent: 97, message: 'Downloading result' });
            // Prefer the presigned R2 GET; fall back to the same-origin proxy
            // when the bucket has no CORS rule (the direct fetch is blocked).
            let blob: Blob | null = null;
            try {
                const downloadResponse = await fetch(payload.downloadUrl);
                if (downloadResponse.ok) blob = await downloadResponse.blob();
            } catch {
                blob = null;
            }
            if (!blob) {
                const proxied = await authFetch(`${DOWNLOAD_URL}?jobId=${encodeURIComponent(init.jobId)}`);
                if (!proxied.ok) {
                    throw new Error(await errorMessage(proxied, `Result download failed (${proxied.status}).`));
                }
                blob = await proxied.blob();
            }
            const baseName = file.name.replace(/\.pdf$/i, '') || 'document';
            onProgress({ percent: 100, message: 'Complete' });
            return {
                name: job.outputName?.replace(/\.docx$/i, '') || baseName,
                url: URL.createObjectURL(blob),
                format: 'docx',
            };
        }

        onProgress({ percent, message: job.statusText || 'Converting with Adobe PDF Services' });

        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Conversion timed out.');
        }
        await sleep(pollIntervalMs);
    }
}
