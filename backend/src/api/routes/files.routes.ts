import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import mime from 'mime-types';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { CompressionJobData, ConversionJobData, BatchImageConversionJobData, ImageFormat } from '../../models/types.js';
import { compressionQueue, conversionQueue } from '../../queue/queues.js';
import { getUploadMetaForUser, resolveStoragePath, saveUpload } from '../../services/storage.service.js';
import { validateFile, sanitizeFileName } from '../../services/file-validation.service.js';
import { extractFirebaseUser, verifyFirebaseToken } from '../../middleware/firebase.middleware.js';
import { jobService } from '../../services/job.service.js';
import { auditService } from '../../services/audit.service.js';
import { getUserProfile, updateUserProfile, ensureUserExists } from '../../services/profile.service.js';
import { updateJobStatus } from '../../services/job-state.service.js';

// Content-Disposition filenames are user-controlled (original upload names /
// artifact names). Strip characters that could break out of the header value.
const safeHeaderFilename = (name: string): string =>
    String(name).replace(/[\r\n"]/g, '_').replace(/\\/g, '/').slice(0, 255) || 'file';

// Artifact paths live under {STORAGE_ROOT}/jobs/{jobId}/... — the first path
// segment must be `jobs` and the second the jobId, so ownership can be proven
// by looking up the job for the current user. Anything else is rejected.
async function assertArtifactOwned(userId: string | null, relativePath: string): Promise<boolean> {
    if (!userId) return false;
    const segments = relativePath.split('/');
    if (segments.length < 2 || segments[0] !== 'jobs') return false;
    const jobId = segments[1];
    const job = await jobService.getJob(jobId, userId);
    return !!job;
}

const ConvertSchema = z.object({
    fileId: z.string().min(1),
    sourceFormat: z.string().min(1),
    targetFormat: z.string().min(1),
    options: z.record(z.any()).optional(),
});

const CompressSchema = z.object({
    fileId: z.string().min(1),
    options: z
        .object({
            quality: z.number().int().min(20).max(100).optional(),
            targetBytes: z.number().int().positive().optional(),
            preset: z.enum(['optimize', 'web', 'email', 'whatsapp', 'print']).optional(),
            lockQuality: z.boolean().optional(),
        })
        .optional(),
});

const BatchImageConversionSchema = z.object({
    imageFileIds: z.array(z.string().min(1)).min(1).max(50),
    outputFileName: z.string().min(1).max(255).optional(),
});

export async function filesRoutes(app: FastifyInstance) {
    const enqueue = async (queue: any, jobName: string, jobId: string, jobData: any, opts: any) => {
        try {
            await queue.add(jobName, jobData, opts);
        } catch (err) {
            // A failed enqueue leaves the DB row stuck in 'queued' forever unless
            // we compensate. Mark it failed so clients get a terminal state.
            const message = err instanceof Error ? err.message : 'Failed to enqueue job';
            await updateJobStatus(jobId, {
                status: 'failed',
                stage: 'failed',
                progress: 100,
                error: message,
                message: 'Job could not be queued.',
                completedAt: true,
            }).catch(() => {});
            throw err;
        }
    };

    app.post('/v1/files/upload', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const file = await request.file();
        if (!file) {
            return reply.code(400).send({ message: 'File is required.' });
        }

        try {
            const user = await extractFirebaseUser(request);
            const userId = user?.uid ?? undefined;

            // Jobs carry an FK to users; ensure the row exists for this caller
            // so job creation below never fails on a missing user.
            if (userId) {
                await ensureUserExists({ uid: userId, email: user?.email, name: user?.name, avatarUrl: user?.picture });
            }

            // Save to temporary location first
            const tempPath = path.join(env.STORAGE_ROOT, 'temp', `${randomUUID()}-${sanitizeFileName(file.filename)}`);
            await fsPromises.mkdir(path.dirname(tempPath), { recursive: true });

            const buffer = await file.toBuffer();
            await fsPromises.writeFile(tempPath, buffer);

            // Validate file
            const validation = await validateFile(tempPath, file.mimetype, file.filename);
            if (!validation.valid) {
                await fsPromises.unlink(tempPath).catch(() => {}); // Clean up
                return reply.code(400).send({ success: false, message: validation.error });
            }

            // Normalize MIME for uploads browsers report as octet-stream.
            // Torrent files dragged in get `application/octet-stream`; the
            // torrent routes gate on `mimeType.includes('torrent')`, so map a
            // validated .torrent upload to a torrent MIME here.
            let storedMimeType = file.mimetype;
            if (file.filename.toLowerCase().endsWith('.torrent')) {
                storedMimeType = 'application/x-bittorrent';
            }

            // Move to permanent storage (ownership bound to the current user)
            const meta = await saveUpload(file.filename, storedMimeType, buffer, userId);

            // Clean up temp file
            await fsPromises.unlink(tempPath).catch(() => {});

            return {
                fileId: meta.fileId,
                name: meta.originalName,
                size: meta.size,
                mimeType: meta.mimeType,
                createdAt: meta.createdAt,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'File upload failed.';
            return reply.code(500).send({ success: false, message });
        }
    });

    app.post('/v1/convert', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const parsed = ConvertSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                message: 'Invalid conversion payload.',
                details: parsed.error.flatten(),
            });
        }

        const user = await extractFirebaseUser(request);
        const userId = user?.uid ?? null;

        const uploaded = await getUploadMetaForUser(parsed.data.fileId, userId);
        if (!uploaded) {
            return reply.code(404).send({ message: 'Uploaded file not found.' });
        }

        const { sourceFormat, targetFormat, options } = parsed.data;

        const jobId = randomUUID();

        const jobData: ConversionJobData = {
            jobId,
            fileId: uploaded.fileId,
            inputPath: uploaded.path,
            inputName: uploaded.originalName,
            sourceFormat,
            targetFormat,
            options,
            userId: userId ?? undefined,
        };

        // Persistent record in PostgreSQL — the row id matches the BullMQ job id
        await jobService.createJob({
            id: jobId,
            userId: userId ?? undefined,
            bullmqJobId: jobId,
            jobType: 'conversion',
            inputFilename: uploaded.originalName,
            inputSizeBytes: uploaded.size,
            inputFormat: sourceFormat,
            outputFormat: targetFormat,
            conversionType: `${sourceFormat}_to_${targetFormat}`,
            optionsJson: options || {},
        });

        await updateJobStatus(jobId, {
            status: 'queued',
            stage: 'queued',
            progress: 0,
            message: 'Job queued for conversion.',
        });

        try {
            auditService.log({
                userId: userId ?? undefined,
                eventType: 'job.created',
                severity: 'info',
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
                resourceId: jobId,
                metadata: { jobType: 'conversion', inputName: uploaded.originalName }
            });
        } catch { /* audit is best-effort */ }

        await enqueue(conversionQueue, 'convert-document', jobId, jobData, {
            jobId,
            attempts: env.JOB_ATTEMPTS,
            backoff: {
                type: 'exponential',
                delay: env.JOB_BACKOFF_MS,
            },
            removeOnComplete: 500,
            removeOnFail: 2000,
        });

        return {
            jobId,
            statusUrl: `/v1/jobs/${jobId}`,
            resultUrl: `/v1/jobs/${jobId}/result`,
        };
    });

    app.post('/v1/compress', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const parsed = CompressSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                message: 'Invalid compression payload.',
                details: parsed.error.flatten(),
            });
        }

        const user = await extractFirebaseUser(request);
        const userId = user?.uid ?? null;

        const uploaded = await getUploadMetaForUser(parsed.data.fileId, userId);
        if (!uploaded) {
            return reply.code(404).send({ message: 'Uploaded file not found.' });
        }

        const jobId = randomUUID();
        const options = {
            quality: parsed.data.options?.quality ?? 78,
            targetBytes: parsed.data.options?.targetBytes,
            preset: parsed.data.options?.preset,
            lockQuality: parsed.data.options?.lockQuality ?? false,
        };

        const jobData: CompressionJobData = {
            jobId,
            fileId: uploaded.fileId,
            inputPath: uploaded.path,
            inputName: uploaded.originalName,
            options,
            userId: userId ?? undefined,
        };

        // Persistent record in PostgreSQL — the row id matches the BullMQ job id
        await jobService.createJob({
            id: jobId,
            userId: userId ?? undefined,
            bullmqJobId: jobId,
            jobType: 'compression',
            inputFilename: uploaded.originalName,
            inputSizeBytes: uploaded.size,
            inputFormat: path.extname(uploaded.originalName).substring(1),
            outputFormat: path.extname(uploaded.originalName).substring(1),
            conversionType: 'image_compress',
            optionsJson: options,
        });

        await updateJobStatus(jobId, {
            status: 'queued',
            stage: 'queued',
            progress: 0,
            message: 'Job queued for compression.',
        });

        try {
            auditService.log({
                userId: userId ?? undefined,
                eventType: 'job.created',
                severity: 'info',
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
                resourceId: jobId,
                metadata: { jobType: 'compression', inputName: uploaded.originalName }
            });
        } catch { /* audit is best-effort */ }

        await enqueue(compressionQueue, 'compress-document', jobId, jobData, {
            jobId,
            attempts: env.JOB_ATTEMPTS,
            backoff: {
                type: 'exponential',
                delay: env.JOB_BACKOFF_MS,
            },
            removeOnComplete: 500,
            removeOnFail: 2000,
        });

        return {
            jobId,
            statusUrl: `/v1/jobs/${jobId}`,
            resultUrl: `/v1/jobs/${jobId}/result`,
        };
    });

    app.post('/v1/images/combine-to-pdf', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const parsed = BatchImageConversionSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                message: 'Invalid batch image conversion payload.',
                details: parsed.error.flatten(),
            });
        }

        const user = await extractFirebaseUser(request);
        const userId = user?.uid ?? null;

        // Fetch all image file metadata — ownership-scoped so users cannot
        // combine files uploaded by someone else.
        const imageMetas = await Promise.all(
            parsed.data.imageFileIds.map((fileId) => getUploadMetaForUser(fileId, userId))
        );

        // Validate all files exist
        for (let i = 0; i < imageMetas.length; i++) {
            if (!imageMetas[i]) {
                return reply.code(404).send({
                    message: `Image file not found at position ${i + 1}`,
                    fileId: parsed.data.imageFileIds[i],
                });
            }
        }

        // Validate all files are images (jpg, png)
        const supportedImageMimes = new Set(['image/jpeg', 'image/png']);
        for (let i = 0; i < imageMetas.length; i++) {
            const meta = imageMetas[i]!;
            if (!supportedImageMimes.has(meta.mimeType)) {
                return reply.code(400).send({
                    message: `File at position ${i + 1} is not a supported image format. Supported: JPG, PNG`,
                    fileId: parsed.data.imageFileIds[i],
                    mimeType: meta.mimeType,
                });
            }
        }

        const jobId = randomUUID();
        const batchId = randomUUID();
        const outputFileName = parsed.data.outputFileName ?? `images-combined-${Date.now()}.pdf`;

        const jobData: BatchImageConversionJobData = {
            jobId,
            batchId,
            imageFilePaths: imageMetas.map((m) => m!.path),
            imageNames: imageMetas.map((m) => m!.originalName),
            outputFileName,
            userId: userId ?? undefined,
        };

        // Persistent record in PostgreSQL — the row id matches the BullMQ job id
        await jobService.createJob({
            id: jobId,
            userId: userId ?? undefined,
            bullmqJobId: jobId,
            jobType: 'compression',
            inputFilename: outputFileName,
            inputSizeBytes: imageMetas.reduce((sum, m) => sum + (m!.size || 0), 0),
            inputFormat: 'images',
            outputFormat: 'pdf',
            conversionType: 'images_to_pdf',
            optionsJson: { batchId },
        });

        await updateJobStatus(jobId, {
            status: 'queued',
            stage: 'queued',
            progress: 0,
            message: 'Batch image conversion job queued.',
        });

        // Use compression queue for now (reusing existing queue infrastructure)
        await enqueue(compressionQueue, 'batch-combine-images', jobId, jobData, {
            jobId,
            attempts: env.JOB_ATTEMPTS,
            backoff: {
                type: 'exponential',
                delay: env.JOB_BACKOFF_MS,
            },
            removeOnComplete: 500,
            removeOnFail: 2000,
        });

        return {
            jobId,
            batchId,
            statusUrl: `/v1/jobs/${jobId}`,
            resultUrl: `/v1/jobs/${jobId}/result`,
        };
    });

    app.get('/v1/files/:fileId/download', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const user = await extractFirebaseUser(request);
        const uid = user?.uid || null;

        const params = request.params as { fileId: string };
        const meta = await getUploadMetaForUser(params.fileId, uid);

        if (!meta) {
            return reply.code(404).send({ message: 'File not found.' });
        }

        if (uid) {
            const profile = await getUserProfile(uid);
            await updateUserProfile(uid, {
                downloadedBytes: (profile?.downloadedBytes || 0) + meta.size
            });
        }

        const stream = fs.createReadStream(meta.path);
        reply.header('Content-Type', meta.mimeType || 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${safeHeaderFilename(meta.originalName)}"`);
        return reply.send(stream);
    });

    app.get('/v1/files/download', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const query = request.query as { path?: string };
        if (!query.path) {
            return reply.code(400).send({ message: 'Query parameter path is required.' });
        }

        const user = await extractFirebaseUser(request as any);
        const uid = user?.uid || null;

        // Ownership gate: only artifacts under a job owned by this user are
        // downloadable. Prevents any authenticated user reading other users'
        // conversion/compression outputs by guessing storage paths.
        const owned = await assertArtifactOwned(uid, query.path);
        if (!owned) {
            return reply.code(403).send({ message: 'You do not have access to this artifact.' });
        }

        let absolutePath: string;
        try {
            absolutePath = resolveStoragePath(query.path);
            await fsPromises.access(absolutePath);
        } catch {
            return reply.code(404).send({ message: 'Artifact file not found.' });
        }

        const stats = await fsPromises.stat(absolutePath);

        if (uid) {
            const profile = await getUserProfile(uid);
            await updateUserProfile(uid, {
                downloadedBytes: (profile?.downloadedBytes || 0) + stats.size
            });
        }

        const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
        const fileName = path.basename(absolutePath);

        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', `attachment; filename="${safeHeaderFilename(fileName)}"`);
        return reply.send(fs.createReadStream(absolutePath));
    });

    // Download by token (public access for anonymous and auth users)
    app.get('/v1/download/:token', async (request, reply) => {
        const { token } = request.params as { token: string };
        const job = await jobService.getJobByDownloadToken(token);
        if (!job || !job.storage_path) {
            return reply.code(404).send({ message: 'File not found or link expired.' });
        }

        const absolutePath = resolveStoragePath(job.storage_path);
        try {
            await fsPromises.access(absolutePath);
        } catch {
            return reply.code(404).send({ message: 'File not found or link expired.' });
        }
        const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
        const fileName = job.output_filename || path.basename(absolutePath);

        const user = await extractFirebaseUser(request as any);
        if (user?.uid) {
            const profile = await getUserProfile(user.uid);
            const stats = await fsPromises.stat(absolutePath);
            await updateUserProfile(user.uid, {
                downloadedBytes: (profile?.downloadedBytes || 0) + stats.size
            });
        }

        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', `attachment; filename="${safeHeaderFilename(fileName)}"`);
        return reply.send(fs.createReadStream(absolutePath));
    });
}
