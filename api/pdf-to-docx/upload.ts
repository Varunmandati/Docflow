/**
 * POST /api/pdf-to-docx/upload?jobId=<id>
 *
 * Same-origin upload fallback for the PDF -> DOCX pipeline, used when the
 * browser cannot PUT to the presigned R2 URL (no bucket CORS). The raw request
 * body is the PDF; this function writes it to R2 server-to-server.
 *
 * Body parsing is disabled so the PDF bytes arrive untouched. Authenticated
 * (Firebase ID token). See backend/dist/serverless/pdf-docx.ts.
 */
import { handleUpload } from '../../backend/dist/serverless/pdf-docx.js';
import type { BareResponse } from '../../backend/dist/serverless/http.js';

export const config = { api: { bodyParser: false } };

async function readRaw(req: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    }
    return Buffer.concat(chunks);
}

export default async function handler(req: any, res: BareResponse): Promise<void> {
    try {
        const body = await readRaw(req);
        return handleUpload(req, res, body);
    } catch {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: 'Could not read the uploaded PDF.' }));
    }
}
