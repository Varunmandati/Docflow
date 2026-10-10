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
import { qstashPublish } from '../../queue/qstash.js';

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
        // Queue backend dispatch: BullMQ/Redis for long-running processes,
        // QStash for serverless (the callback lands on /api/jobs/*).
        const publish = env.IS_QSTASH_QUEUE
            ? () => qstashPublish(jobName, jobData)
            : () => queue.add(jobName, jobData, opts);
        try {
            await publish();
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
            const storedMimeType = file.mimetype;

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

    // --- Direct-to-R2 upload flow (serverless deployments) -----------------
    // The browser uploads big files straight to the bucket with a presigned
    // PUT URL, which sidesteps the platform's ~4.5MB request body cap; the API
    // only sees metadata plus a validation pass afterwards. On disk-mode
    // deployments this endpoint answers 501 and the frontend helper falls back
    // to the classic multipart /v1/files/upload above, byte-for-byte.
    const PresignSchema = z.object({
        name: z.string().min(1).max(1024),
        mimeType: z.string().min(1).max(255),
        size: z.number().int().positive(),
    });

    const directUploadDisabled = (reply: any) =>
        reply.code(501).send({
            success: false,
            message: 'Direct-to-storage upload is not enabled on this deployment.',
        });

    app.post('/v1/files/presign', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        if (!env.IS_R2_STORAGE) return directUploadDisabled(reply);

        const parsed = PresignSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ success: false, message: 'Invalid presign payload.', details: parsed.error.flatten() });
        }
        const { name, mimeType, size } = parsed.data;
        if (size > env.MAX_UPLOAD_BYTES) {
            return reply.code(413).send({
                success: false,
                message: `File exceeds the ${Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit.`,
            });
        }

        try {
            const user = await extractFirebaseUser(request);
            const userId = user?.uid ?? undefined;
            if (userId) {
                await ensureUserExists({ uid: userId, email: user?.email, name: user?.name, avatarUrl: user?.picture });
            }

            const r2 = await import('../../services/storage-r2.service.js');
            const fileId = randomUUID();
            const storedName = `${fileId}-${sanitizeFileName(name)}`;
            const r2Key = `uploads/${storedName}`;

            // Pending row: invisible to getUploadMeta until /complete validates
            // the actual bytes, so an unvalidated object can never feed a job.
            await r2.insertPendingUpload({ fileId, userId, fileName: name, mimeType, size, r2Key });

            const expiresIn = 900;
            const uploadUrl = await r2.presignPut(r2Key, mimeType, expiresIn);

            return {
                fileId,
                uploadUrl,
                completeUrl: `/v1/files/${fileId}/complete`,
                expiresInSeconds: expiresIn,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not create upload URL.';
            return reply.code(500).send({ success: false, message });
        }
    });

    app.post('/v1/files/:fileId/complete', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        if (!env.IS_R2_STORAGE) return directUploadDisabled(reply);

        const { fileId } = request.params as { fileId: string };
        const user = await extractFirebaseUser(request);
        const userId = user?.uid ?? null;

        let tempPath: string | null = null;
        try {
            const r2 = await import('../../services/storage-r2.service.js');
            const row = await r2.getUploadRowForUser(fileId, userId);
            if (!row) {
                // Missing and someone-else's are indistinguishable on purpose.
                return reply.code(404).send({ success: false, message: 'Uploaded file not found.' });
            }

            if (row.status === 'ready') {
                const meta = r2.uploadRowToMeta(row);
                return {
                    fileId: meta.fileId,
                    name: meta.originalName,
                    size: meta.size,
                    mimeType: meta.mimeType,
                    createdAt: meta.createdAt,
                };
            }

            // Pull the object back for full validation (magic bytes, size) —
            // the same checks the classic multipart upload runs before saving.
            tempPath = path.join(env.STORAGE_ROOT, 'temp', `${randomUUID()}-${sanitizeFileName(row.original_name)}`);
            await fsPromises.mkdir(path.dirname(tempPath), { recursive: true });
            await r2.downloadKeyToLocal(row.r2_key, tempPath);

            const actualSize = (await fsPromises.stat(tempPath)).size;
            const validation = await validateFile(tempPath, row.mime_type, row.original_name);
            if (!validation.valid) {
                await r2.deleteKey(row.r2_key);
                await r2.deleteUploadRow(fileId);
                return reply.code(400).send({ success: false, message: validation.error });
            }

            const meta = await r2.finalizeUploadRow(fileId, actualSize);
            if (!meta) {
                return reply.code(404).send({ success: false, message: 'Uploaded file not found.' });
            }

            return {
                fileId: meta.fileId,
                name: meta.originalName,
                size: meta.size,
                mimeType: meta.mimeType,
                createdAt: meta.createdAt,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload completion failed.';
            return reply.code(500).send({ success: false, message });
        } finally {
            if (tempPath) await fsPromises.unlink(tempPath).catch(() => {});
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

        reply.header('Content-Type', meta.mimeType || 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${safeHeaderFilename(meta.originalName)}"`);

        if (meta.path.startsWith('r2://')) {
            const { getObjectStream, r2UriToKey } = await import('../../services/storage-r2.service.js');
            const { stream } = await getObjectStream(r2UriToKey(meta.path));
            return reply.send(stream);
        }

        const stream = fs.createReadStream(meta.path);
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

        let contentType: string;
        let fileName: string;

        if (env.IS_R2_STORAGE) {
            // Logical path == R2 key (`jobs/{jobId}/...`).
            const { getObjectStream, headSize } = await import('../../services/storage-r2.service.js');
            const size = await headSize(query.path);
            if (size === null) {
                return reply.code(404).send({ message: 'Artifact file not found.' });
            }

            if (uid) {
                const profile = await getUserProfile(uid);
                await updateUserProfile(uid, {
                    downloadedBytes: (profile?.downloadedBytes || 0) + size
                });
            }

            contentType = mime.lookup(query.path) || 'application/octet-stream';
            fileName = path.basename(query.path);
            reply.header('Content-Type', contentType);
            reply.header('Content-Disposition', `attachment; filename="${safeHeaderFilename(fileName)}"`);
            const { stream } = await getObjectStream(query.path);
            return reply.send(stream);
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

        contentType = mime.lookup(absolutePath) || 'application/octet-stream';
        fileName = path.basename(absolutePath);

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

        const user = await extractFirebaseUser(request as any);

        if (env.IS_R2_STORAGE) {
            const { getObjectStream, headSize } = await import('../../services/storage-r2.service.js');
            const size = await headSize(job.storage_path);
            if (size === null) {
                return reply.code(404).send({ message: 'File not found or link expired.' });
            }

            if (user?.uid) {
                const profile = await getUserProfile(user.uid);
                await updateUserProfile(user.uid, {
                    downloadedBytes: (profile?.downloadedBytes || 0) + size
                });
            }

            const contentType = mime.lookup(job.storage_path) || 'application/octet-stream';
            const fileName = job.output_filename || path.basename(job.storage_path);
            reply.header('Content-Type', contentType);
            reply.header('Content-Disposition', `attachment; filename="${safeHeaderFilename(fileName)}"`);
            const { stream } = await getObjectStream(job.storage_path);
            return reply.send(stream);
        }

        const absolutePath = resolveStoragePath(job.storage_path);
        try {
            await fsPromises.access(absolutePath);
        } catch {
            return reply.code(404).send({ message: 'File not found or link expired.' });
        }
        const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
        const fileName = job.output_filename || path.basename(absolutePath);

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
