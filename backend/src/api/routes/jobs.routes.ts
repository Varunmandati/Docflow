import { FastifyInstance } from 'fastify';
import { getJobResult, getJobStatus } from '../../services/job-state.service.js';
import { jobService } from '../../services/job.service.js';
import { conversionQueue, compressionQueue } from '../../queue/queues.js';
import { ConversionResult } from '../../models/types.js';
import { extractFirebaseUser, verifyFirebaseToken } from '../../middleware/firebase.middleware.js';

// Ownership guard: a job is only accessible to its owner (or anonymous jobs
// which are only reachable via their bearer session). Uses RLS-scoped lookup
// so one user can never read another user's job status, result, or preview.
async function requireOwnedJob(app: FastifyInstance, request: any, reply: any, jobId: string): Promise<boolean> {
    const user = await extractFirebaseUser(request);
    const userId = user?.uid || null;

    if (!userId) {
        reply.code(401).send({ message: 'Authentication required to access jobs.' });
        return false;
    }

    const job = await jobService.getJob(jobId, userId);
    if (!job) {
        reply.code(404).send({ message: 'Job not found.' });
        return false;
    }

    return true;
}

export async function jobsRoutes(app: FastifyInstance) {
    app.get('/v1/jobs', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const user = await extractFirebaseUser(request as any);
        const userId = user?.uid || null;

        if (!userId) {
            return reply.code(401).send({ message: 'Authentication required to view job history.' });
        }

        const query = request.query as { limit?: string; offset?: string; status?: string; search?: string };
        
        // Global Pagination Strategy
        const limit = Math.min(Math.max(1, parseInt(query.limit || '20', 10)), 100); // max 100 per page
        const offset = Math.max(0, parseInt(query.offset || '0', 10));

        try {
            const history = await jobService.getUserHistory(userId, {
                limit,
                offset,
                status: query.status,
                search: query.search
            });

            return reply.send({
                success: true,
                data: history.jobs,
                meta: {
                    total: history.total,
                    limit,
                    offset,
                    hasMore: history.total > offset + limit
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch job history.';
            return reply.code(500).send({ success: false, message });
        }
    });

    app.get('/v1/jobs/:jobId', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const params = request.params as { jobId: string };
        const owned = await requireOwnedJob(app, request as any, reply, params.jobId);
        if (!owned) return reply;

        const [status, conversionJob, compressionJob] = await Promise.all([
            getJobStatus(params.jobId),
            conversionQueue.getJob(params.jobId),
            compressionQueue.getJob(params.jobId),
        ]);

        const queueJob = conversionJob ?? compressionJob;

        if (!status && !queueJob) {
            return reply.code(404).send({ message: 'Job not found.' });
        }

        const queueState = queueJob ? await (queueJob as any).getState() : 'unknown';

        return {
            ...status,
            queueState,
        };
    });

    app.get('/v1/jobs/:jobId/result', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const params = request.params as { jobId: string };
        const owned = await requireOwnedJob(app, request as any, reply, params.jobId);
        if (!owned) return reply;

        const [status, result] = await Promise.all([
            getJobStatus(params.jobId),
            getJobResult(params.jobId),
        ]);

        if (!status) {
            return reply.code(404).send({ message: 'Job not found.' });
        }

        if (status.status !== 'completed') {
            return reply.code(409).send({ message: 'Job is not completed yet.', status });
        }

        if (!result) {
            return reply.code(404).send({ message: 'Result not found.' });
        }

        return result;
    });

    app.get('/v1/previews/:jobId', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const params = request.params as { jobId: string };
        const owned = await requireOwnedJob(app, request as any, reply, params.jobId);
        if (!owned) return reply;

        const result = await getJobResult(params.jobId);

        if (!result) {
            return reply.code(404).send({ message: 'Result not found.' });
        }

        if (!(result.outputs as ConversionResult['outputs']).primary) {
            return reply.code(404).send({ message: 'Primary output is not available for this job.' });
        }

        const conversionResult = result as ConversionResult;

        return {
            jobId: params.jobId,
            preview: conversionResult.outputs.primary,
            pdf: conversionResult.outputs.primary,
        };
    });
}
