/**
 * GET|POST /api/pdf-to-docx/status
 *
 * Returns job state and, once complete, a short-lived presigned download URL.
 * Authenticated. See backend/dist/serverless/pdf-docx.ts.
 */
import { handleStatus } from '../../backend/dist/serverless/pdf-docx.js';
import type { BareResponse } from '../../backend/dist/serverless/http.js';

export default async function handler(req: any, res: BareResponse): Promise<void> {
    return handleStatus(req, res);
}
