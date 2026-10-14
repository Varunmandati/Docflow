/**
 * GET|POST /api/pdf-to-docx/download?jobId=<id>
 *
 * Same-origin download fallback for a finished PDF -> DOCX artifact, used when
 * the browser cannot read the presigned R2 GET (no bucket CORS). Streams the
 * DOCX with an attachment disposition. Authenticated (Firebase ID token).
 */
import { handleDownload } from '../../backend/dist/serverless/pdf-docx.js';
import type { BareResponse } from '../../backend/dist/serverless/http.js';

export default async function handler(req: any, res: BareResponse): Promise<void> {
    return handleDownload(req, res);
}
