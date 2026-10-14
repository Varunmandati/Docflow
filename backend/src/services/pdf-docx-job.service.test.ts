import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, Buffer>();

vi.mock('./storage-r2.service', () => ({
    putObjectFromBuffer: vi.fn(async (key: string, body: Buffer) => {
        store.set(key, body);
    }),
    getObjectBuffer: vi.fn(async (key: string) => {
        const buf = store.get(key);
        if (!buf) throw new Error(`missing ${key}`);
        return buf;
    }),
    deleteKey: vi.fn(async (key: string) => {
        store.delete(key);
    }),
    presignPut: vi.fn(async (key: string) => `https://r2.example/put/${key}`),
    presignGet: vi.fn(async (key: string) => `https://r2.example/get/${key}`),
}));

vi.mock('../config/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
    createJob,
    getJob,
    updateJob,
    deleteJob,
    deriveOutputName,
    toJobView,
    presignJobInput,
    presignJobOutput,
} from './pdf-docx-job.service';

beforeEach(() => store.clear());

describe('deriveOutputName', () => {
    it('strips .pdf and unsafe characters', () => {
        expect(deriveOutputName('My Report.pdf')).toBe('My Report.docx');
        expect(deriveOutputName('a/b\\c:weird?.pdf')).toBe('c_weird_.docx');
        expect(deriveOutputName('')).toBe('document.docx');
    });
});

describe('job lifecycle', () => {
    it('creates a job in the uploading state with R2-backed keys', async () => {
        const job = await createJob({ jobId: 'j1', userId: 'u1', inputName: 'Report.pdf' });
        expect(job.status).toBe('uploading');
        expect(job.inputKey).toBe('pdf-docx/input/j1.pdf');
        expect(job.outputName).toBe('Report.docx');

        const loaded = await getJob('j1');
        expect(loaded?.userId).toBe('u1');
    });

    it('updates and persists status', async () => {
        await createJob({ jobId: 'j2', userId: 'u1', inputName: 'x.pdf' });
        const done = await updateJob('j2', { status: 'completed', progress: 100, outputKey: 'pdf-docx/output/j2.docx' });
        expect(done?.status).toBe('completed');
        expect((await getJob('j2'))?.progress).toBe(100);
    });

    it('returns null for an unknown job', async () => {
        expect(await getJob('nope')).toBeNull();
    });

    it('deletes metadata and staging objects', async () => {
        await createJob({ jobId: 'j3', userId: 'u1', inputName: 'x.pdf' });
        store.set('pdf-docx/input/j3.pdf', Buffer.from('x'));
        store.set('pdf-docx/output/j3.docx', Buffer.from('y'));
        await deleteJob('j3');
        expect(await getJob('j3')).toBeNull();
        expect(store.has('pdf-docx/input/j3.pdf')).toBe(false);
        expect(store.has('pdf-docx/output/j3.docx')).toBe(false);
    });
});

describe('projections and presigns', () => {
    it('toJobView never exposes R2 keys, the Adobe URI or the uid', async () => {
        const job = await createJob({ jobId: 'j4', userId: 'secret-uid', inputName: 'a.pdf' });
        const view = toJobView({ ...job, adobeJobUri: 'https://adobe/j', adobeAssetId: 'a' });
        expect(view).not.toHaveProperty('inputKey');
        expect(view).not.toHaveProperty('outputKey');
        expect(view).not.toHaveProperty('adobeJobUri');
        expect(view).not.toHaveProperty('adobeAssetId');
        expect(view).not.toHaveProperty('userId');
        expect(JSON.stringify(view)).not.toContain('secret-uid');
    });

    it('presigns the input upload URL', async () => {
        const url = await presignJobInput('j5');
        expect(url).toBe('https://r2.example/put/pdf-docx/input/j5.pdf');
    });

    it('presigns the output download URL only when an output exists', async () => {
        const job = await createJob({ jobId: 'j6', userId: 'u1', inputName: 'a.pdf' });
        expect(await presignJobOutput(job)).toBeNull();
        const url = await presignJobOutput({ ...job, outputKey: 'pdf-docx/output/j6.docx' });
        expect(url).toBe('https://r2.example/get/pdf-docx/output/j6.docx');
    });
});
