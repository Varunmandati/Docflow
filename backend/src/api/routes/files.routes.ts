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
import { getUploadMeta, resolveStoragePath, saveUpload } from '../../services/storage.service.js';
import { validateFile, sanitizeFileName } from '../../services/file-validation.service.js';
import { extractFirebaseUser, verifyFirebaseToken } from '../../middleware/firebase.middleware.js';
import { jobService } from '../../services/job.service.js';
import { auditService } from '../../services/audit.service.js';
import { getUserProfile, updateUserProfile } from '../../services/profile.service.js';
import { updateJobStatus } from '../../services/job-state.service.js';

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
            // Upload files dragged in get `application/octet-stream`; the
            // upload routes gate on `mimeType.includes('upload')`, so map a
            // validated .upload upload to a upload MIME here.
            let storedMimeType = file.mimetype;
            if (file.filename.toLowerCase().endsWith('.upload')) {
                storedMimeType = 'application/x-binary-transfer';
            }

            // Move to permanent storage
            const meta = await saveUpload(file.filename, storedMimeType, buffer);

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

        const uploaded = await getUploadMeta(parsed.data.fileId);
        if (!uploaded) {
            return reply.code(404).send({ message: 'Uploaded file not found.' });
        }

        const { sourceFormat, targetFormat, options } = parsed.data;

        const jobId = randomUUID();

        const user = await extractFirebaseUser(request as any);
        const userId = user?.uid;

        const jobData: ConversionJobData = {
            jobId,
            fileId: uploaded.fileId,
            inputPath: uploaded.path,
            inputName: uploaded.originalName,
            sourceFormat,
            targetFormat,
            options,
            userId,
        };

        // Persistent record in PostgreSQL — the row id matches the BullMQ job id
        await jobService.createJob({
            id: jobId,
            userId,
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
                userId,
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

        const uploaded = await getUploadMeta(parsed.data.fileId);
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

        const user = await extractFirebaseUser(request as any);
        const userId = user?.uid;

        const jobData: CompressionJobData = {
            jobId,
            fileId: uploaded.fileId,
            inputPath: uploaded.path,
            inputName: uploaded.originalName,
            options,
            userId,
        };

        // Persistent record in PostgreSQL — the row id matches the BullMQ job id
        await jobService.createJob({
            id: jobId,
            userId,
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
                userId,
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

        // Fetch all image file metadata
        const imageMetas = await Promise.all(
            parsed.data.imageFileIds.map((fileId) => getUploadMeta(fileId))
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

        const user = await extractFirebaseUser(request as any);
        const userId = user?.uid;

        const jobData: BatchImageConversionJobData = {
            jobId,
            batchId,
            imageFilePaths: imageMetas.map((m) => m!.path),
            imageNames: imageMetas.map((m) => m!.originalName),
            outputFileName,
            userId,
        };

        // Persistent record in PostgreSQL — the row id matches the BullMQ job id
        await jobService.createJob({
            id: jobId,
            userId,
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
        const user = await extractFirebaseUser(request as any);
        const uid = user?.uid || null;

        const params = request.params as { fileId: string };
        const meta = await getUploadMeta(params.fileId);

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
        reply.header('Content-Disposition', `attachment; filename="${meta.originalName}"`);
        return reply.send(stream);
    });

    app.get('/v1/files/download', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const query = request.query as { path?: string };
        if (!query.path) {
            return reply.code(400).send({ message: 'Query parameter path is required.' });
        }

        const user = await extractFirebaseUser(request as any);
        const uid = user?.uid || null;

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
        reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
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
        reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
        return reply.send(fs.createReadStream(absolutePath));
    });
}
