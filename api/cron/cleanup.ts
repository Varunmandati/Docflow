/**
 * Vercel Cron: hourly expired-artifact + OTP cleanup.
 *
 * Long-running deployments run the same sweeps from the worker process
 * (cleanup.worker.ts setInterval); serverless has no setInterval, so the
 * schedule lives in vercel.json `crons` and lands here. Requires CRON_SECRET
 * (Vercel sends it as `Authorization: Bearer <CRON_SECRET>`).
 */
import { sendJson, BareResponse } from '../../backend/dist/serverless/http.js';
import { cleanupExpiredJobs, cleanupExpiredOtps } from '../../backend/dist/workers/cleanup.worker.js';
import { env } from '../../backend/dist/config/env.js';

export default async function handler(req: any, res: BareResponse): Promise<void> {
    const expected = env.CRON_SECRET?.trim();
    const auth = req.headers?.authorization ?? '';
    if (!expected || auth !== `Bearer ${expected}`) {
        return sendJson(res, 401, { message: 'Unauthorized' });
    }

    await cleanupExpiredOtps();
    await cleanupExpiredJobs();

    return sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
}
