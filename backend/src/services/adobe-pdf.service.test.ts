import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    convertPdfToDocx,
    getAccessToken,
    createAsset,
    isPdfMagic,
    isDocxZip,
    AdobePdfError,
    type AdobePdfConfig,
} from './adobe-pdf.service';

vi.mock('../config/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const cfg: AdobePdfConfig = { clientId: 'cid', clientSecret: 'secret', baseUrl: 'https://pdf.example' };

const PDF = Buffer.from('%PDF-1.7\n...');

/** A minimal valid-looking DOCX zip body: PK\x03\x04 + the required part name. */
function docxZip(): Buffer {
    return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('...[Content_Types].xml...')]);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

describe('isPdfMagic / isDocxZip', () => {
    it('recognises a PDF header', () => {
        expect(isPdfMagic(PDF)).toBe(true);
        expect(isPdfMagic(Buffer.from('not a pdf'))).toBe(false);
    });

    it('requires a zip header AND the OOXML content-types part', () => {
        expect(isDocxZip(docxZip())).toBe(true);
        expect(isDocxZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false);
        expect(isDocxZip(Buffer.from('PK\x03\x04 but not a docx'))).toBe(false);
    });
});

describe('getAccessToken', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('returns the access token', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ access_token: 'tok' })));
        await expect(getAccessToken(cfg)).resolves.toBe('tok');
    });

    it('throws with the status on failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
        await expect(getAccessToken(cfg)).rejects.toMatchObject({ status: 401 });
    });
});

describe('createAsset', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sends the required mediaType body and reads the asset id', async () => {
        let captured: any;
        vi.stubGlobal('fetch', vi.fn(async (_input: any, init?: any) => {
            captured = JSON.parse(String(init?.body));
            return json({ uploadUri: 'https://upload.example/put', assetID: 'asset-1' });
        }));
        const { assetID, uploadUri } = await createAsset(cfg, 'tok', { contentSize: 123 });
        expect(captured).toEqual({ mediaType: 'application/pdf', contentSize: 123 });
        expect(assetID).toBe('asset-1');
        expect(uploadUri).toBe('https://upload.example/put');
    });

    it('defaults mediaType when no options are supplied', async () => {
        let captured: any;
        vi.stubGlobal('fetch', vi.fn(async (_input: any, init?: any) => {
            captured = JSON.parse(String(init?.body));
            return json({ uploadUri: 'https://upload.example/put', assetID: 'a' });
        }));
        await createAsset(cfg, 'tok');
        expect(captured).toEqual({ mediaType: 'application/pdf' });
    });
});

describe('convertPdfToDocx (orchestration)', () => {
    beforeEach(() => {
        const calls: string[] = [];
        const fetchMock = vi.fn(async (input: any, init?: any) => {
            const url = String(input);
            calls.push(`${init?.method || 'GET'} ${url}`);
            if (url.endsWith('/token')) return json({ access_token: 'tok' });
            if (url.endsWith('/assets')) {
                return json({ uploadUri: 'https://upload.example/put', assetID: 'asset-1' }, 201);
            }
            if (url === 'https://upload.example/put') return new Response('', { status: 200 });
            if (url.endsWith('/operation/exportpdf')) {
                return new Response('', { status: 201, headers: { location: 'https://pdf.example/jobs/1' } });
            }
            if (url === 'https://pdf.example/jobs/1') return json({ status: 'done', asset: { downloadUri: 'https://dl.example/out.docx' } });
            if (url === 'https://dl.example/out.docx') {
                return new Response(new Uint8Array(docxZip()), { status: 200 });
            }
            throw new Error(`unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('runs the full flow and returns DOCX bytes', async () => {
        const { docx } = await convertPdfToDocx(PDF, { config: cfg, pollIntervalMs: 1 });
        expect(isDocxZip(docx)).toBe(true);
    });

    it('rejects a non-PDF input before any network call', async () => {
        await expect(
            convertPdfToDocx(Buffer.from('hello'), { config: cfg, pollIntervalMs: 1 }),
        ).rejects.toBeInstanceOf(AdobePdfError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('surfaces a failed Adobe job', async () => {
        const fetchMock = vi.fn(async (input: any, init?: any) => {
            const url = String(input);
            if (url.endsWith('/token')) return json({ access_token: 'tok' });
            if (url.endsWith('/assets')) return json({ uploadUri: 'https://upload.example/put', assetID: 'a' }, 201);
            if (url === 'https://upload.example/put') return new Response('', { status: 200 });
            if (url.endsWith('/operation/exportpdf')) {
                return new Response('', { status: 201, headers: { location: 'https://pdf.example/jobs/2' } });
            }
            if (url === 'https://pdf.example/jobs/2') {
                return json({ status: 'failed', error: { message: 'bad pdf' } });
            }
            throw new Error(`unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(convertPdfToDocx(PDF, { config: cfg, pollIntervalMs: 1 })).rejects.toThrow(/bad pdf/);
    });

    it('rejects a completed job whose payload is not a DOCX package', async () => {
        const fetchMock = vi.fn(async (input: any, init?: any) => {
            const url = String(input);
            if (url.endsWith('/token')) return json({ access_token: 'tok' });
            if (url.endsWith('/assets')) return json({ uploadUri: 'https://upload.example/put', assetID: 'a' }, 201);
            if (url === 'https://upload.example/put') return new Response('', { status: 200 });
            if (url.endsWith('/operation/exportpdf')) {
                return new Response('', { status: 201, headers: { location: 'https://pdf.example/jobs/3' } });
            }
            if (url === 'https://pdf.example/jobs/3') return json({ status: 'done', asset: { downloadUri: 'https://dl.example/out.docx' } });
            if (url === 'https://dl.example/out.docx') return new Response('<html>error</html>', { status: 200 });
            throw new Error(`unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(convertPdfToDocx(PDF, { config: cfg, pollIntervalMs: 1 })).rejects.toThrow(/not a valid DOCX/);
    });
});
