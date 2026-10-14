/**
 * POST /api/pdf-to-docx/start
 *
 * Runs the Adobe PDF Services conversion for a reserved job (after the browser
 * has PUT the PDF to the presigned URL). Authenticated. See
 * backend/dist/serverless/pdf-docx.ts.
 */
import { handleStart } from '../../backend/dist/serverless/pdf-docx.js';
import type { BareResponse } from '../../backend/dist/serverless/http.js';

export default async function handler(req: any, res: BareResponse): Promise<void> {
    return handleStart(req, res);
}
