import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sendJson, BareResponse } from './http.js';
import { requireUser, rateLimit } from './auth.js';
import {
    convertPdfToDocx,
    getAdobeConfig,
    isPdfMagic,
    AdobePdfError,
} from '../services/adobe-pdf.service.js';
import {
    createJob,
    getJob,
    updateJob,
    newJobId,
    presignJobInput,
    presignJobOutput,
    toJobView,
} from '../services/pdf-docx-job.service.js';
import { getObjectBuffer, putObjectFromBuffer } from '../services/storage-r2.service.js';

/**
 * Adobe PDF Services PDF -> DOCX pipeline, exposed as three serverless
 * endpoints:
 *
 *   POST /api/pdf-to-docx/init    reserve a job + presigned R2 upload URL
 *   POST /api/pdf-to-docx/start   run the conversion (after the browser PUT)
 *   POST /api/pdf-to-docx/status  poll; returns a presigned download URL when done
 *
 * Every endpoint is authenticated and owned by the caller's uid. The design
 * keeps the browser out of the Adobe/R2 credential path entirely: uploads go
 * browser -> R2 directly (sidestepping the ~4.5MB function body cap) and Adobe
 * is called server-to-server.
 */

interface HandlerRequest {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
    body?: unknown;
    [key: string]: unknown;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Error carrying an HTTP status for the response. */
class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

function readBody(req: HandlerRequest): Record<string, unknown> {
    const body = req.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
        return body as Record<string, unknown>;
    }
    if (typeof body === 'string' && body.trim()) {
        try {
            return JSON.parse(body) as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    return {};
}

function queryValue(req: HandlerRequest, name: string): string | undefined {
    const raw = req.query?.[name];
    if (raw === undefined) return undefined;
    return Array.isArray(raw) ? raw[0] : raw;
}

/** Reserve a job and hand back the presigned upload URL. */
export async function handleInit(req: HandlerRequest, res: BareResponse): Promise<void> {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
        return sendJson(res, 405, { message: 'Method not allowed.' });
    }
    if (!env.IS_R2_STORAGE) {
        return sendJson(res, 501, { message: 'PDF to DOCX requires R2 storage (STORAGE_BACKEND=r2).' });
    }
    if (!env.IS_ADOBE_PDF_CONFIGURED) {
        return sendJson(res, 501, { message: 'PDF to DOCX is not configured (Adobe PDF Services credentials missing).' });
    }

    const user = await requireUser(req.headers);
    if (!user) return sendJson(res, 401, { message: 'Sign in is required for PDF to DOCX conversion.' });

    if (!(await rateLimit(`pdf-docx:init:${user.uid}`, 20, 600))) {
        return sendJson(res, 429, { message: 'Too many conversion requests. Please try again shortly.' });
    }

    let name: string;
    let size: number;
    let mimeType: string;
    try {
        const body = readBody(req);
        name = String(body.name ?? '').trim();
        size = Number(body.size ?? 0);
        mimeType = String(body.mimeType ?? 'application/pdf');
        if (!name) throw new HttpError(400, 'A file name is required.');
        if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'A positive file size is required.');
        if (size > env.MAX_UPLOAD_BYTES) {
            throw new HttpError(413, `File exceeds the ${Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit.`);
        }
        if (!name.toLowerCase().endsWith('.pdf') && !mimeType.includes('pdf')) {
            throw new HttpError(400, 'Only PDF files can be converted to DOCX here.');
        }
    } catch (err) {
        const status = err instanceof HttpError ? err.status : 400;
        return sendJson(res, status, { message: err instanceof Error ? err.message : 'Invalid request.' });
    }

    try {
        const jobId = newJobId();
        await createJob({ jobId, userId: user.uid, inputName: name });
        const uploadUrl = await presignJobInput(jobId, 900);
        return sendJson(res, 200, {
            jobId,
            status: 'uploading',
            uploadUrl,
            startUrl: '/api/pdf-to-docx/start',
            statusUrl: '/api/pdf-to-docx/status',
            expiresInSeconds: 900,
        });
    } catch (err) {
        logger.error({ err }, 'PDF->DOCX init failed');
        return sendJson(res, 500, { message: 'Could not start the conversion. Please try again.' });
    }
}

/** Run the conversion once the browser has PUT the PDF to R2. */
export async function handleStart(req: HandlerRequest, res: BareResponse): Promise<void> {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
        return sendJson(res, 405, { message: 'Method not allowed.' });
    }
    if (!env.IS_R2_STORAGE || !env.IS_ADOBE_PDF_CONFIGURED) {
        return sendJson(res, 501, { message: 'PDF to DOCX is not available on this deployment.' });
    }

    const user = await requireUser(req.headers);
    if (!user) return sendJson(res, 401, { message: 'Sign in is required for PDF to DOCX conversion.' });

    if (!(await rateLimit(`pdf-docx:start:${user.uid}`, 20, 600))) {
        return sendJson(res, 429, { message: 'Too many conversion requests. Please try again shortly.' });
    }

    const jobId = String(readBody(req).jobId ?? '').trim();
    if (!jobId) return sendJson(res, 400, { message: 'A jobId is required.' });

    const job = await getJob(jobId);
    if (!job || job.userId !== user.uid) {
        // Missing and someone-else's are indistinguishable on purpose.
        return sendJson(res, 404, { message: 'Job not found.' });
    }

    // Idempotency: a completed job returns immediately; a job that started
    // within the last five minutes is reported as still processing rather than
    // burning a second Adobe operation.
    if (job.status === 'completed') {
        return sendJson(res, 200, { job: toJobView(job), completed: true });
    }
    if (job.status === 'processing' && Date.now() - new Date(job.updatedAt).getTime() < 5 * 60_000) {
        return sendJson(res, 200, { job: toJobView(job), completed: false });
    }

    let pdf: Buffer;
    try {
        pdf = await getObjectBuffer(job.inputKey);
    } catch {
        await updateJob(jobId, { status: 'failed', statusText: 'Upload missing', progress: 100, error: 'The uploaded PDF could not be found.' });
        return sendJson(res, 400, { message: 'The uploaded PDF could not be found. Please upload again.' });
    }

    if (pdf.length === 0) {
        await updateJob(jobId, { status: 'failed', statusText: 'Empty upload', progress: 100, error: 'The uploaded PDF is empty.' });
        return sendJson(res, 400, { message: 'The uploaded PDF is empty.' });
    }
    if (pdf.length > env.MAX_UPLOAD_BYTES) {
        await updateJob(jobId, { status: 'failed', statusText: 'File too large', progress: 100, error: 'The PDF exceeds the size limit.' });
        return sendJson(res, 413, { message: 'The PDF exceeds the size limit.' });
    }
    if (!isPdfMagic(pdf)) {
        await updateJob(jobId, { status: 'failed', statusText: 'Not a PDF', progress: 100, error: 'The uploaded file is not a valid PDF.' });
        return sendJson(res, 400, { message: 'The uploaded file is not a valid PDF.' });
    }

    await updateJob(jobId, { status: 'processing', statusText: 'Converting with Adobe PDF Services', progress: 25 });

    try {
        const config = getAdobeConfig()!;
        const { docx } = await convertPdfToDocx(pdf, { config, ocrLang: 'en-US' });
        await updateJob(jobId, { status: 'processing', statusText: 'Saving result', progress: 90 });
        const outputKey = `pdf-docx/output/${jobId}.docx`;
        await putObjectFromBuffer(outputKey, docx, DOCX_MIME);
        const done = await updateJob(jobId, {
            status: 'completed',
            statusText: 'Completed',
            progress: 100,
            outputKey,
        });
        return sendJson(res, 200, { job: done ? toJobView(done) : toJobView(job), completed: true });
    } catch (err) {
        const message = err instanceof AdobePdfError ? err.message : 'Conversion failed. Please try again.';
        logger.error({ err, jobId }, 'PDF->DOCX conversion failed');
        const failed = await updateJob(jobId, {
            status: 'failed',
            statusText: 'Failed',
            progress: 100,
            error: message,
        });
        return sendJson(res, 502, { job: failed ? toJobView(failed) : undefined, message });
    }
}

/** Poll job state; mint a download URL once complete. */
export async function handleStatus(req: HandlerRequest, res: BareResponse): Promise<void> {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
        return sendJson(res, 405, { message: 'Method not allowed.' });
    }
    if (!env.IS_R2_STORAGE) {
        return sendJson(res, 501, { message: 'PDF to DOCX requires R2 storage (STORAGE_BACKEND=r2).' });
    }

    const user = await requireUser(req.headers);
    if (!user) return sendJson(res, 401, { message: 'Sign in is required.' });

    if (!(await rateLimit(`pdf-docx:status:${user.uid}`, 600, 60))) {
        return sendJson(res, 429, { message: 'Too many status requests.' });
    }

    const jobId = String(readBody(req).jobId ?? queryValue(req, 'jobId') ?? '').trim();
    if (!jobId) return sendJson(res, 400, { message: 'A jobId is required.' });

    const job = await getJob(jobId);
    if (!job || job.userId !== user.uid) {
        return sendJson(res, 404, { message: 'Job not found.' });
    }

    const view = toJobView(job);
    if (job.status === 'completed') {
        const downloadUrl = await presignJobOutput(job, 3600);
        return sendJson(res, 200, {
            job: view,
            downloadUrl,
            downloadExpiresInSeconds: downloadUrl ? 3600 : undefined,
        });
    }
    return sendJson(res, 200, { job: view });
}

/**
 * Same-origin upload fallback. The browser normally PUTs the PDF straight to a
 * presigned R2 URL, but that only works when the bucket has a CORS rule for the
 * SPA origin. When it does not, the browser POSTs the bytes here instead and the
 * function writes them to R2 server-to-server (bounded by the serverless request
 * body cap, so it suits small/medium files; large files use the presigned path
 * once CORS is in place).
 */
export async function handleUpload(req: HandlerRequest, res: BareResponse, body: Buffer): Promise<void> {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
        return sendJson(res, 405, { message: 'Method not allowed.' });
    }
    if (!env.IS_R2_STORAGE || !env.IS_ADOBE_PDF_CONFIGURED) {
        return sendJson(res, 501, { message: 'PDF to DOCX is not available on this deployment.' });
    }

    const user = await requireUser(req.headers);
    if (!user) return sendJson(res, 401, { message: 'Sign in is required for PDF to DOCX conversion.' });

    if (!(await rateLimit(`pdf-docx:upload:${user.uid}`, 30, 600))) {
        return sendJson(res, 429, { message: 'Too many uploads. Please try again shortly.' });
    }

    const jobId = String(queryValue(req, 'jobId') ?? readBody(req).jobId ?? '').trim();
    if (!jobId) return sendJson(res, 400, { message: 'A jobId is required.' });

    const job = await getJob(jobId);
    if (!job || job.userId !== user.uid) {
        return sendJson(res, 404, { message: 'Job not found.' });
    }

    if (!body || body.length === 0) {
        return sendJson(res, 400, { message: 'The uploaded PDF is empty.' });
    }
    if (body.length > env.MAX_UPLOAD_BYTES) {
        return sendJson(res, 413, { message: 'The PDF exceeds the size limit.' });
    }
    if (!isPdfMagic(body)) {
        return sendJson(res, 400, { message: 'The uploaded file is not a valid PDF.' });
    }

    try {
        await putObjectFromBuffer(job.inputKey, body, 'application/pdf');
        const updated = await updateJob(jobId, { status: 'queued', statusText: 'Uploaded', progress: 15 });
        return sendJson(res, 200, { ok: true, job: toJobView(updated ?? job) });
    } catch (err) {
        logger.error({ err, jobId }, 'PDF->DOCX upload fallback failed');
        return sendJson(res, 500, { message: 'Could not store the uploaded PDF. Please try again.' });
    }
}

/**
 * Same-origin download fallback for finished artifacts, used when the browser
 * cannot read the presigned R2 GET (no bucket CORS). Streams the DOCX through
 * the function with an attachment disposition.
 */
export async function handleDownload(req: HandlerRequest, res: BareResponse): Promise<void> {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
        return sendJson(res, 405, { message: 'Method not allowed.' });
    }
    if (!env.IS_R2_STORAGE) {
        return sendJson(res, 501, { message: 'PDF to DOCX requires R2 storage (STORAGE_BACKEND=r2).' });
    }

    const user = await requireUser(req.headers);
    if (!user) return sendJson(res, 401, { message: 'Sign in is required.' });

    if (!(await rateLimit(`pdf-docx:download:${user.uid}`, 600, 60))) {
        return sendJson(res, 429, { message: 'Too many download requests.' });
    }

    const jobId = String(queryValue(req, 'jobId') ?? readBody(req).jobId ?? '').trim();
    if (!jobId) return sendJson(res, 400, { message: 'A jobId is required.' });

    const job = await getJob(jobId);
    if (!job || job.userId !== user.uid) {
        return sendJson(res, 404, { message: 'Job not found.' });
    }
    if (job.status !== 'completed' || !job.outputKey) {
        return sendJson(res, 409, { message: 'The conversion is not finished yet.' });
    }

    let docx: Buffer;
    try {
        docx = await getObjectBuffer(job.outputKey);
    } catch {
        return sendJson(res, 404, { message: 'The converted file is no longer available.' });
    }

    const safeName = job.outputName.replace(/[\r\n"]/g, '_').replace(/\\/g, '/').split('/').pop() || 'document.docx';
    res.statusCode = 200;
    res.setHeader('content-type', DOCX_MIME);
    res.setHeader('content-disposition', `attachment; filename="${safeName}"`);
    res.setHeader('content-length', String(docx.length));
    res.setHeader('cache-control', 'no-store');
    res.end(docx);
}
