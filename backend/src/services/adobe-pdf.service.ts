import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Adobe PDF Services REST client — the high-fidelity PDF -> DOCX engine behind
 * the /api/pdf-to-docx/* endpoints.
 *
 * Flow (all server-to-server, credentials never leave the backend):
 *   1. POST /token                          -> OAuth access token
 *   2. POST /assets                         -> { uploadUri, assetID }
 *   3. PUT  {uploadUri}                     -> upload the PDF bytes
 *   4. POST /operation/exportpdf            -> 201, Location = job status URI
 *   5. GET  {jobStatusUri} (poll)           -> { status, asset.downloadUri }
 *   6. GET  {downloadUri}                   -> the DOCX bytes
 *
 * The client is deliberately transport-thin and each step is exported so the
 * orchestration is unit-testable with a mocked `fetch` and no live credentials.
 */

export interface AdobePdfConfig {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
}

export function getAdobeConfig(): AdobePdfConfig | null {
    const clientId = env.PDF_SERVICES_CLIENT_ID?.trim();
    const clientSecret = env.PDF_SERVICES_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return {
        clientId,
        clientSecret,
        baseUrl: (env.PDF_SERVICES_BASE_URL || 'https://pdf-services.adobe.io').replace(/\/$/, ''),
    };
}

export class AdobePdfError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.name = 'AdobePdfError';
        this.status = status;
    }
}

const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 5_000;

const authHeaders = (cfg: AdobePdfConfig, token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    'x-api-key': cfg.clientId,
});

/**
 * Adobe returns asset/job/download URIs; only ever follow HTTPS ones. This
 * blocks a downgraded or non-web scheme from turning the server into a client
 * for an unexpected protocol (SSRF hardening).
 */
function assertHttps(rawUrl: string, label: string): void {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new AdobePdfError(`Adobe returned an invalid ${label} URL.`);
    }
    if (parsed.protocol !== 'https:') {
        throw new AdobePdfError(`Refusing to follow a non-HTTPS ${label} URL.`);
    }
}

async function readError(res: Response): Promise<string> {
    try {
        const text = await res.text();
        return text.slice(0, 500);
    } catch {
        return '';
    }
}

/** Step 1 — exchange the client credentials for a short-lived access token. */
export async function getAccessToken(cfg: AdobePdfConfig, timeoutMs = 30_000): Promise<string> {
    const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
    });
    const res = await fetch(`${cfg.baseUrl}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-api-key': cfg.clientId,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
        throw new AdobePdfError(`Adobe token request failed (${res.status}): ${await readError(res)}`, res.status);
    }
    const data = (await res.json()) as { access_token?: string; token?: string };
    const token = data.access_token || data.token;
    if (!token) {
        throw new AdobePdfError('Adobe token response did not include an access token.');
    }
    return token;
}

/**
 * Step 2 — reserve an input asset; returns the presigned upload URI + asset id.
 * Adobe requires a `mediaType` in the body; `contentSize` is optional but lets
 * Adobe pre-size the upload target.
 */
export async function createAsset(
    cfg: AdobePdfConfig,
    token: string,
    options: { mediaType?: string; contentSize?: number; timeoutMs?: number } = {},
): Promise<{ uploadUri: string; assetID: string }> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const payload: Record<string, unknown> = { mediaType: options.mediaType ?? 'application/pdf' };
    if (typeof options.contentSize === 'number' && options.contentSize > 0) {
        payload.contentSize = options.contentSize;
    }
    const res = await fetch(`${cfg.baseUrl}/assets`, {
        method: 'POST',
        headers: {
            ...authHeaders(cfg, token),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
        throw new AdobePdfError(`Adobe asset creation failed (${res.status}): ${await readError(res)}`, res.status);
    }
    const headerAssetId = res.headers.get('x-asset-id') || res.headers.get('asset-id') || '';
    let body: { uploadUri?: string; assetID?: string } = {};
    try {
        body = (await res.json()) as { uploadUri?: string; assetID?: string };
    } catch {
        // Some responses carry the asset id only in a header.
    }
    const uploadUri = body.uploadUri;
    const assetID = body.assetID || headerAssetId;
    if (!uploadUri || !assetID) {
        throw new AdobePdfError('Adobe asset response was missing the upload URI or asset id.');
    }
    return { uploadUri, assetID };
}

/** Step 3 — upload the PDF bytes to the reserved asset. */
export async function uploadAsset(uploadUri: string, bytes: Buffer, timeoutMs = 120_000): Promise<void> {
    assertHttps(uploadUri, 'asset upload');
    const res = await fetch(uploadUri, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
        throw new AdobePdfError(`Adobe asset upload failed (${res.status}): ${await readError(res)}`, res.status);
    }
}

/** Step 4 — submit the Export PDF operation; returns the job status URI. */
export async function submitExport(
    cfg: AdobePdfConfig,
    token: string,
    assetID: string,
    options: { ocrLang?: string } = {},
    timeoutMs = 60_000,
): Promise<string> {
    const payload: Record<string, unknown> = { assetID, targetFormat: 'docx' };
    if (options.ocrLang) payload.ocrLang = options.ocrLang;
    const res = await fetch(`${cfg.baseUrl}/operation/exportpdf`, {
        method: 'POST',
        headers: {
            ...authHeaders(cfg, token),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
        throw new AdobePdfError(`Adobe export submission failed (${res.status}): ${await readError(res)}`, res.status);
    }
    const location = res.headers.get('location') || res.headers.get('Location');
    if (!location) {
        throw new AdobePdfError('Adobe export submission did not return a job location header.');
    }
    return location;
}

/** Step 5 — poll the job until it completes; resolves the DOCX download URI. */
export async function pollExport(
    cfg: AdobePdfConfig,
    token: string,
    jobUri: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();
    let interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    assertHttps(jobUri, 'job status');

    while (Date.now() - start < timeoutMs) {
        const res = await fetch(jobUri, {
            method: 'GET',
            headers: authHeaders(cfg, token),
            signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
            throw new AdobePdfError(`Adobe job poll failed (${res.status}): ${await readError(res)}`, res.status);
        }
        const data = (await res.json()) as {
            status?: string;
            asset?: { downloadUri?: string };
            error?: { message?: string; code?: string };
        };
        const status = (data.status || '').toLowerCase();
        if (status === 'done' || status === 'succeeded' || status === 'completed') {
            const downloadUri = data.asset?.downloadUri;
            if (!downloadUri) {
                throw new AdobePdfError('Adobe job completed without a download URI.');
            }
            return downloadUri;
        }
        if (status === 'failed' || status === 'error') {
            const detail = data.error?.message || data.error?.code || 'unknown error';
            throw new AdobePdfError(`Adobe export failed: ${detail}`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
        interval = Math.min(interval + 500, MAX_POLL_INTERVAL_MS);
    }
    throw new AdobePdfError('Adobe export timed out.');
}

/** Step 6 — download the finished DOCX bytes. */
export async function downloadResult(downloadUri: string, timeoutMs = 120_000): Promise<Buffer> {
    assertHttps(downloadUri, 'result download');
    const res = await fetch(downloadUri, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
        throw new AdobePdfError(`Adobe result download failed (${res.status}): ${await readError(res)}`, res.status);
    }
    return Buffer.from(await res.arrayBuffer());
}

/** Convenience check used by the endpoints to fail fast with a clear message. */
export function isPdfMagic(bytes: Buffer): boolean {
    return bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * A DOCX is a ZIP container. Reject anything that is not a plausible OOXML
 * zip before it is stored and handed back to the user (defends against a
 * provider returning an HTML error page with a 200 status).
 */
export function isDocxZip(bytes: Buffer): boolean {
    if (bytes.length < 4) return false;
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (!isZip) return false;
    // The OOXML package always contains [Content_Types].xml; its name appears
    // verbatim in the zip's local file headers.
    return bytes.includes(Buffer.from('[Content_Types].xml'));
}

/**
 * Full pipeline: PDF bytes in, DOCX bytes out. Returns a result object rather
 * than throwing raw provider errors so the caller can persist a status.
 */
export async function convertPdfToDocx(
    pdf: Buffer,
    options: { ocrLang?: string; timeoutMs?: number; pollIntervalMs?: number; config?: AdobePdfConfig } = {},
): Promise<{ docx: Buffer; durationMs: number }> {
    const cfg = options.config ?? getAdobeConfig();
    if (!cfg) {
        throw new AdobePdfError('Adobe PDF Services is not configured.');
    }
    if (!isPdfMagic(pdf)) {
        throw new AdobePdfError('Input is not a valid PDF file.');
    }

    const startedAt = Date.now();
    const token = await getAccessToken(cfg);
    const { uploadUri, assetID } = await createAsset(cfg, token, { contentSize: pdf.length });
    await uploadAsset(uploadUri, pdf);
    const jobUri = await submitExport(cfg, token, assetID, { ocrLang: options.ocrLang });
    const downloadUri = await pollExport(cfg, token, jobUri, {
        timeoutMs: options.timeoutMs,
        pollIntervalMs: options.pollIntervalMs,
    });
    const docx = await downloadResult(downloadUri);
    if (!isDocxZip(docx)) {
        throw new AdobePdfError('Adobe returned a file that is not a valid DOCX package.');
    }
    const durationMs = Date.now() - startedAt;
    logger.info({ durationMs, inputBytes: pdf.length, outputBytes: docx.length }, 'Adobe PDF -> DOCX completed');
    return { docx, durationMs };
}
