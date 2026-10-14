import { describe, it, expect, vi, beforeEach } from 'vitest';

const jobs = new Map<string, any>();

vi.mock('../config/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../config/env.js', () => ({
    env: {
        IS_R2_STORAGE: true,
        IS_ADOBE_PDF_CONFIGURED: true,
        MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
        PDF_DOCX_JOB_TTL_MINUTES: 1440,
    },
}));

vi.mock('./auth.js', () => ({
    requireUser: vi.fn(async () => ({ uid: 'u1' })),
    rateLimit: vi.fn(async () => true),
}));

vi.mock('../services/adobe-pdf.service.js', () => ({
    convertPdfToDocx: vi.fn(async () => ({ docx: Buffer.from('PK\x03\x04[Content_Types].xml'), durationMs: 1 })),
    getAdobeConfig: vi.fn(() => ({ clientId: 'c', clientSecret: 's', baseUrl: 'https://x' })),
    isPdfMagic: vi.fn((b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-'),
    AdobePdfError: class AdobePdfError extends Error {},
}));

vi.mock('../services/pdf-docx-job.service.js', () => ({
    createJob: vi.fn(async ({ jobId, userId, inputName }: any) => {
        const j = {
            jobId,
            userId,
            status: 'uploading',
            statusText: 'Waiting for upload',
            progress: 0,
            inputKey: `pdf-docx/input/${jobId}.pdf`,
            inputName,
            outputName: inputName.replace(/\.pdf$/i, '') + '.docx',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        };
        jobs.set(jobId, j);
        return j;
    }),
    getJob: vi.fn(async (id: string) => {
        const j = jobs.get(id);
        return j ? { ...j } : null;
    }),
    updateJob: vi.fn(async (id: string, patch: any) => {
        const j = jobs.get(id);
        if (!j) return null;
        const next = { ...j, ...patch, updatedAt: new Date().toISOString() };
        jobs.set(id, next);
        return { ...next };
    }),
    newJobId: vi.fn(() => 'job-1'),
    presignJobInput: vi.fn(async () => 'https://r2.example/put'),
    presignJobOutput: vi.fn(async (j: any) => (j.outputKey ? 'https://r2.example/get' : null)),
    toJobView: vi.fn((j: any) => ({
        jobId: j.jobId,
        status: j.status,
        statusText: j.statusText,
        progress: j.progress,
        inputName: j.inputName,
        outputName: j.outputName,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        expiresAt: j.expiresAt,
        error: j.error,
    })),
}));

vi.mock('../services/storage-r2.service.js', () => ({
    getObjectBuffer: vi.fn(async () => Buffer.from('%PDF-1.7\nbody')),
    putObjectFromBuffer: vi.fn(async () => {}),
}));

import { handleInit, handleStart, handleStatus, handleUpload, handleDownload } from './pdf-docx';
import { env } from '../config/env';
import { requireUser } from './auth';

function makeRes() {
    const out: { statusCode: number; body: any; raw?: unknown; headers: Record<string, string> } = {
        statusCode: 0,
        body: undefined,
        headers: {},
    };
    const res = {
        get statusCode() {
            return out.statusCode;
        },
        set statusCode(value: number) {
            out.statusCode = value;
        },
        setHeader: (name: string, value: string) => {
            out.headers[name.toLowerCase()] = value;
        },
        end: (chunk?: unknown) => {
            out.raw = chunk;
            if (chunk === undefined) {
                out.body = undefined;
                return;
            }
            try {
                out.body = JSON.parse(String(chunk));
            } catch {
                out.body = chunk;
            }
        },
    };
    return { res, out };
}

beforeEach(() => {
    jobs.clear();
    vi.clearAllMocks();
});

describe('handleInit', () => {
    it('requires authentication', async () => {
        (requireUser as any).mockResolvedValueOnce(null);
        const { res, out } = makeRes();
        await handleInit({ method: 'POST', headers: {}, body: { name: 'a.pdf', size: 10 } }, res);
        expect(out.statusCode).toBe(401);
    });

    it('rejects a non-PDF name', async () => {
        const { res, out } = makeRes();
        await handleInit(
            { method: 'POST', headers: {}, body: { name: 'a.docx', size: 10, mimeType: 'application/msword' } },
            res,
        );
        expect(out.statusCode).toBe(400);
    });

    it('returns a presigned upload URL for a valid PDF', async () => {
        const { res, out } = makeRes();
        await handleInit({ method: 'POST', headers: {}, body: { name: 'a.pdf', size: 10, mimeType: 'application/pdf' } }, res);
        expect(out.statusCode).toBe(200);
        expect(out.body.jobId).toBe('job-1');
        expect(out.body.uploadUrl).toBe('https://r2.example/put');
    });

    it('answers 501 when Adobe is not configured', async () => {
        (env as any).IS_ADOBE_PDF_CONFIGURED = false;
        const { res, out } = makeRes();
        await handleInit({ method: 'POST', headers: {}, body: { name: 'a.pdf', size: 10 } }, res);
        expect(out.statusCode).toBe(501);
        (env as any).IS_ADOBE_PDF_CONFIGURED = true;
    });
});

describe('handleStart', () => {
    it('404s for an unknown job', async () => {
        const { res, out } = makeRes();
        await handleStart({ method: 'POST', headers: {}, body: { jobId: 'missing' } }, res);
        expect(out.statusCode).toBe(404);
    });

    it('runs the conversion and marks the job completed', async () => {
        const { res: initRes } = makeRes();
        await handleInit({ method: 'POST', headers: {}, body: { name: 'a.pdf', size: 10, mimeType: 'application/pdf' } }, initRes);
        const { res, out } = makeRes();
        await handleStart({ method: 'POST', headers: {}, body: { jobId: 'job-1' } }, res);
        expect(out.statusCode).toBe(200);
        expect(out.body.completed).toBe(true);
        expect(jobs.get('job-1').status).toBe('completed');
        expect(jobs.get('job-1').outputKey).toBe('pdf-docx/output/job-1.docx');
    });
});

describe('handleStatus', () => {
    it('hides a job owned by another user', async () => {
        jobs.set('foreign', { jobId: 'foreign', userId: 'someone-else', status: 'processing' });
        const { res, out } = makeRes();
        await handleStatus({ method: 'GET', headers: {}, query: { jobId: 'foreign' } }, res);
        expect(out.statusCode).toBe(404);
    });

    it('returns a download URL once complete', async () => {
        jobs.set('done', {
            jobId: 'done',
            userId: 'u1',
            status: 'completed',
            outputKey: 'pdf-docx/output/done.docx',
        });
        const { res, out } = makeRes();
        await handleStatus({ method: 'GET', headers: {}, query: { jobId: 'done' } }, res);
        expect(out.statusCode).toBe(200);
        expect(out.body.downloadUrl).toBe('https://r2.example/get');
    });
});

describe('handleUpload (same-origin fallback)', () => {
    beforeEach(async () => {
        const { res } = makeRes();
        await handleInit({ method: 'POST', headers: {}, body: { name: 'a.pdf', size: 10, mimeType: 'application/pdf' } }, res);
    });

    it('requires authentication', async () => {
        (requireUser as any).mockResolvedValueOnce(null);
        const { res, out } = makeRes();
        await handleUpload({ method: 'POST', headers: {}, query: { jobId: 'job-1' } }, res, Buffer.from('%PDF-1.7'));
        expect(out.statusCode).toBe(401);
    });

    it('400s without a jobId', async () => {
        const { res, out } = makeRes();
        await handleUpload({ method: 'POST', headers: {}, query: {} }, res, Buffer.from('%PDF-1.7'));
        expect(out.statusCode).toBe(400);
    });

    it('rejects a non-PDF body', async () => {
        const { res, out } = makeRes();
        await handleUpload({ method: 'POST', headers: {}, query: { jobId: 'job-1' } }, res, Buffer.from('not a pdf'));
        expect(out.statusCode).toBe(400);
    });

    it('stores a valid PDF and returns ok', async () => {
        const { res, out } = makeRes();
        await handleUpload({ method: 'POST', headers: {}, query: { jobId: 'job-1' } }, res, Buffer.from('%PDF-1.7\nbody'));
        expect(out.statusCode).toBe(200);
        expect(out.body.ok).toBe(true);
    });
});

describe('handleDownload (same-origin fallback)', () => {
    it('409s when the job is not finished', async () => {
        jobs.set('pending', { jobId: 'pending', userId: 'u1', status: 'processing' });
        const { res, out } = makeRes();
        await handleDownload({ method: 'GET', headers: {}, query: { jobId: 'pending' } }, res);
        expect(out.statusCode).toBe(409);
    });

    it('streams the finished DOCX with an attachment disposition', async () => {
        jobs.set('done', {
            jobId: 'done',
            userId: 'u1',
            status: 'completed',
            outputKey: 'pdf-docx/output/done.docx',
            outputName: 'report.docx',
            inputName: 'report.pdf',
        });
        const { res, out } = makeRes();
        await handleDownload({ method: 'GET', headers: {}, query: { jobId: 'done' } }, res);
        expect(out.statusCode).toBe(200);
        expect(Buffer.isBuffer(out.raw)).toBe(true);
        expect(out.headers['content-disposition']).toContain('report.docx');
        expect(out.headers['content-type']).toContain('wordprocessingml');
    });
});
