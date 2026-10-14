/**
 * POST /api/pdf-to-docx/init
 *
 * Reserves a PDF -> DOCX job and returns a presigned R2 upload URL.
 * Authenticated (Firebase ID token). See backend/dist/serverless/pdf-docx.ts.
 */
import { handleInit } from '../../backend/dist/serverless/pdf-docx.js';
import type { BareResponse } from '../../backend/dist/serverless/http.js';

export default async function handler(req: any, res: BareResponse): Promise<void> {
    return handleInit(req, res);
}
