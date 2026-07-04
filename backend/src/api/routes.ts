import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import mime from 'mime-types';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { CompressionJobData, ConversionJobData, BatchImageConversionJobData, ConversionResult, ImageFormat, UploadConversionJobData } from '../models/types.js';
import { compressionQueue, conversionQueue, uploadQueue } from '../queue/queues.js';
import { getJobResult, getJobStatus, updateJobStatus } from '../services/job-state.service.js';
import { requestOtpEmail, verifyOtpCode } from '../services/otp-auth.service.js';
import { getUploadMeta, resolveStoragePath, saveUpload, createJobWorkspace, toRelativeStoragePath } from '../services/storage.service.js';
import { validateFile, sanitizeFileName } from '../services/file-validation.service.js';
import { setupRateLimitedRoutes, setSecureCookie, extractAuthToken } from '../middleware/security.middleware.js';
import { tokenService } from '../services/token.service.js';
import { userService } from '../services/user.service.js';
import { jobService } from '../services/job.service.js';
import { auditService } from '../services/audit.service.js';
import { checkDatabaseHealth } from '../db/client.js';
import { 
    generateEmailChangeOtp, 
    verifyEmailChangeOtp, 
    storeProfilePicture, 
    updateUserProfile, 
    getUserProfile 
} from '../services/profile.service.js';
import { parseUploadFile, PUBLIC_TRACKERS } from '../services/upload.service.js';

const ALLOWED_EXTENSIONS = new Set([
    '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.txt', '.pdf', '.upload'
]);

const ConvertSchema = z.object({
    fileId: z.string().min(1),
    outputs: z
        .object({
            images: z.boolean().optional(),
            html: z.boolean().optional(),
            splitPages: z.boolean().optional(),
            imageFormat: z.enum(['png', 'jpg']).optional(),
            dpi: z.number().int().min(72).max(600).optional(),
        })
        .optional(),
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

const OtpRequestSchema = z.object({
    email: z.string().email(),
    name: z.string().trim().min(1).max(120).optional(),
    fullName: z.string().trim().min(1).max(120).optional(),
    mode: z.enum(['login', 'signup']).optional(),
    type: z.enum(['login', 'signup']).optional(),
    purpose: z.enum(['login', 'signup']).optional(),
});

const OtpVerifySchema = z.object({
    email: z.string().email(),
    otp: z.string().trim().min(4).max(12).optional(),
    code: z.string().trim().min(4).max(12).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    fullName: z.string().trim().min(1).max(120).optional(),
    mode: z.enum(['login', 'signup']).optional(),
    type: z.enum(['login', 'signup']).optional(),
    purpose: z.enum(['login', 'signup']).optional(),
});

const BatchImageConversionSchema = z.object({
    imageFileIds: z.array(z.string().min(1)).min(1).max(50),
    outputFileName: z.string().min(1).max(255).optional(),
});

const ChangeEmailRequestSchema = z.object({
    newEmail: z.string().email(),
});

const ChangeEmailVerifySchema = z.object({
    newEmail: z.string().email(),
    otp: z.string().trim().min(4).max(12),
});

const UpdateProfileSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.string().url().optional(),
});

const UploadDownloadSchema = z.object({
    fileFilter: z.array(z.string()).optional(),
});

const toDownloadUrl = (relativePath: string) => `/v1/files/download?path=${encodeURIComponent(relativePath)}`;

export async function registerRoutes(app: FastifyInstance): Promise<void> {
    app.get('/v1/health', async (request, reply) => {
        const [dbHealthy, redisHealthy] = await Promise.all([
            checkDatabaseHealth(),
            Promise.resolve(true),
        ]);

        const status = dbHealthy && redisHealthy ? 'ok' : 'degraded';
        return {
            status,
            timestamp: new Date().toISOString(),
            services: {
                database: dbHealthy ? 'ok' : 'error',
                redis: redisHealthy ? 'ok' : 'error',
            },
        };
    });

    // Setup rate limiting
    setupRateLimitedRoutes(app);

    const otpRequestHandler = async (request: any, reply: any) => {
        const parsed = OtpRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid OTP request payload.',
                details: parsed.error.flatten(),
            });
        }

        const mode = parsed.data.mode || parsed.data.type || parsed.data.purpose || 'login';
        const name = parsed.data.fullName || parsed.data.name;

        try {
            const result = await requestOtpEmail({
                email: parsed.data.email,
                name,
                mode,
            });
            return reply.send(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to send OTP.';
            return reply.code(500).send({ success: false, message });
        }
    };

    const otpVerifyHandler = async (request: any, reply: any) => {
        const parsed = OtpVerifySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid OTP verification payload.',
                details: parsed.error.flatten(),
            });
        }

        const mode = parsed.data.mode || parsed.data.type || parsed.data.purpose || 'login';
        const otp = parsed.data.otp || parsed.data.code;
        if (!otp) {
            return reply.code(400).send({
                success: false,
                message: 'OTP code is required.',
            });
        }

        try {
            const result = await verifyOtpCode({
                email: parsed.data.email,
                otp,
                name: parsed.data.fullName || parsed.data.name,
                mode,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
            });
            
            // Set httpOnly cookies for tokens
            setSecureCookie(reply, 'accessToken', result.accessToken, result.accessTokenExpiry - Math.floor(Date.now() / 1000), true);
            setSecureCookie(reply, 'refreshToken', result.refreshToken, result.refreshTokenExpiry - Math.floor(Date.now() / 1000), true);
            
            return reply.send({
                success: true,
                message: result.message,
                user: result.user,
                accessTokenExpiry: result.accessTokenExpiry,
                refreshTokenExpiry: result.refreshTokenExpiry,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'OTP verification failed.';
            return reply.code(401).send({ success: false, message });
        }
    };

    app.post('/auth/otp/request', otpRequestHandler);
    app.post('/auth/request-otp', otpRequestHandler);
    app.post('/otp/request', otpRequestHandler);
    app.post('/api/auth/otp/request', otpRequestHandler);
    app.post('/api/auth/request-otp', otpRequestHandler);
    app.post('/api/otp/request', otpRequestHandler);

    app.post('/auth/otp/verify', otpVerifyHandler);
    app.post('/auth/verify-otp', otpVerifyHandler);
    app.post('/otp/verify', otpVerifyHandler);
    app.post('/api/auth/otp/verify', otpVerifyHandler);
    app.post('/api/auth/verify-otp', otpVerifyHandler);
    app.post('/api/otp/verify', otpVerifyHandler);

    // Logout endpoint - invalidate tokens
    app.post('/auth/logout', async (request, reply) => {
        const token = extractAuthToken(request);
        if (!token) {
            return reply.code(401).send({ success: false, message: 'No token provided.' });
        }

        const payload = tokenService.verifyAccessToken(token);
        if (!payload) {
            return reply.code(401).send({ success: false, message: 'Invalid token.' });
        }

        // Revoke the refresh token if available
        const refreshToken = request.cookies.refreshToken || request.headers['x-refresh-token'];
        if (refreshToken) {
            await tokenService.revokeRefreshToken(refreshToken as string);
        }

        auditService.log({
            userId: payload.sub,
            eventType: 'auth.logout',
            severity: 'info',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            metadata: { email: payload.email }
        });

        // Clear cookies
        reply.clearCookie('accessToken');
        reply.clearCookie('refreshToken');

        return reply.send({ success: true, message: 'Logged out successfully.' });
    });

    // Refresh access token
    app.post('/auth/refresh', async (request, reply) => {
        const refreshToken = request.cookies.refreshToken || request.headers['x-refresh-token'];
        if (!refreshToken) {
            return reply.code(401).send({ success: false, message: 'Refresh token required.' });
        }

        const result = await tokenService.verifyAndRotateRefreshToken(
            refreshToken as string,
            request.ip,
            request.headers['user-agent']
        );

        if (!result) {
            auditService.log({
                eventType: 'security.invalid_token',
                severity: 'warn',
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
                metadata: { reason: 'Refresh token rotation failed' }
            });
            return reply.code(401).send({ success: false, message: 'Invalid or expired refresh token.' });
        }

        setSecureCookie(reply, 'accessToken', result.accessToken, 24 * 3600, true);
        setSecureCookie(reply, 'refreshToken', result.newRefreshToken, 7 * 24 * 3600, true);

        auditService.log({
            userId: result.userId,
            eventType: 'auth.token_refreshed',
            severity: 'info',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent']
        });

        return reply.send({
            success: true,
            message: 'Access token refreshed.',
            accessToken: result.accessToken,
            accessTokenExpiry: Math.floor(Date.now() / 1000) + 24 * 3600,
            refreshTokenExpiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        });
    });
    app.post('/v1/files/upload', async (request, reply) => {
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

            // Move to permanent storage
            const meta = await saveUpload(file.filename, file.mimetype, buffer);

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
    app.post('/v1/convert', async (request, reply) => {
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

        const outputs = {
            images: parsed.data.outputs?.images ?? false,
            html: parsed.data.outputs?.html ?? false,
            splitPages: parsed.data.outputs?.splitPages ?? false,
            imageFormat: (parsed.data.outputs?.imageFormat ?? 'png') as ImageFormat,
            dpi: parsed.data.outputs?.dpi ?? 144,
        };

        const jobId = randomUUID();

        const token = extractAuthToken(request);
        let userId: string | undefined = undefined;
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userId = payload.sub;
            }
        }

        const jobData: ConversionJobData = {
            jobId,
            fileId: uploaded.fileId,
            inputPath: uploaded.path,
            inputName: uploaded.originalName,
            outputs,
        };

        await updateJobStatus(jobId, {
            status: 'queued',
            stage: 'queued',
            progress: 0,
            message: 'Job queued for conversion.',
        });

        // Persistent record in PostgreSQL
        await jobService.createJob({
            userId,
            bullmqJobId: jobId,
            jobType: 'conversion',
            inputFilename: uploaded.originalName,
            inputSizeBytes: uploaded.size,
            inputFormat: path.extname(uploaded.originalName).substring(1),
            outputFormat: outputs.images ? (outputs.imageFormat || 'png') : 'pdf',
            conversionType: 'docx_to_pdf',
            optionsJson: outputs,
        });

        auditService.log({
            userId,
            eventType: 'job.created',
            severity: 'info',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            resourceId: jobId,
            metadata: { jobType: 'conversion', inputName: uploaded.originalName }
        });

        await conversionQueue.add('convert-document', jobData, {
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
    app.post('/v1/compress', async (request, reply) => {
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

        const token = extractAuthToken(request);
        let userId: string | undefined = undefined;
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userId = payload.sub;
            }
        }

        const jobData: CompressionJobData = {
            jobId,
            fileId: uploaded.fileId,
            inputPath: uploaded.path,
            inputName: uploaded.originalName,
            options,
        };

        await updateJobStatus(jobId, {
            status: 'queued',
            stage: 'queued',
            progress: 0,
            message: 'Job queued for compression.',
        });

        // Persistent record in PostgreSQL
        await jobService.createJob({
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

        auditService.log({
            userId,
            eventType: 'job.created',
            severity: 'info',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            resourceId: jobId,
            metadata: { jobType: 'compression', inputName: uploaded.originalName }
        });

        await compressionQueue.add('compress-document', jobData, {
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

    app.post('/v1/images/combine-to-pdf', async (request, reply) => {
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

        const jobData: BatchImageConversionJobData = {
            jobId,
            batchId,
            imageFilePaths: imageMetas.map((m) => m!.path),
            imageNames: imageMetas.map((m) => m!.originalName),
            outputFileName,
        };

        await updateJobStatus(jobId, {
            status: 'queued',
            stage: 'queued',
            progress: 0,
            message: 'Batch image conversion job queued.',
        });

        // Use compression queue for now (reusing existing queue infrastructure)
        await compressionQueue.add('batch-combine-images', jobData, {
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

    app.get('/v1/jobs/:jobId', async (request, reply) => {
        const params = request.params as { jobId: string };
        const [status, conversionJob, compressionJob] = await Promise.all([
            getJobStatus(params.jobId),
            conversionQueue.getJob(params.jobId),
            compressionQueue.getJob(params.jobId),
        ]);

        const queueJob = conversionJob ?? compressionJob;

        if (!status && !queueJob) {
            return reply.code(404).send({ message: 'Job not found.' });
        }

        const queueState = queueJob ? await queueJob.getState() : 'unknown';

        return {
            ...status,
            queueState,
        };
    });

    app.get('/v1/jobs/:jobId/result', async (request, reply) => {
        const params = request.params as { jobId: string };
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

    app.get('/v1/previews/:jobId', async (request, reply) => {
        const params = request.params as { jobId: string };
        const result = await getJobResult(params.jobId);

        if (!result) {
            return reply.code(404).send({ message: 'Result not found.' });
        }

        if (!(result.outputs as ConversionResult['outputs']).pdf) {
            return reply.code(404).send({ message: 'HTML preview is available only for conversion jobs.' });
        }

        const conversionResult = result as ConversionResult;

        if (!conversionResult.outputs.html) {
            return reply.code(404).send({ message: 'HTML preview was not generated for this job.' });
        }

        return {
            jobId: params.jobId,
            preview: conversionResult.outputs.html,
            pdf: conversionResult.outputs.pdf,
        };
    });

    app.get('/v1/files/:fileId/download', async (request, reply) => {
        const token = extractAuthToken(request);
        let userEmail: string | null = null;
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        const params = request.params as { fileId: string };
        const meta = await getUploadMeta(params.fileId);

        if (!meta) {
            return reply.code(404).send({ message: 'File not found.' });
        }

        if (userEmail) {
            const profile = await getUserProfile(userEmail);
            await updateUserProfile(userEmail, {
                downloadedBytes: (profile?.downloadedBytes || 0) + meta.size
            });
        }

        const stream = fs.createReadStream(meta.path);
        reply.header('Content-Type', meta.mimeType || 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${meta.originalName}"`);
        return reply.send(stream);
    });

    app.get('/v1/files/download', async (request, reply) => {
        const query = request.query as { path?: string };
        if (!query.path) {
            return reply.code(400).send({ message: 'Query parameter path is required.' });
        }

        const token = extractAuthToken(request);
        let userEmail: string | null = null;
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        let absolutePath: string;
        try {
            absolutePath = resolveStoragePath(query.path);
            await fsPromises.access(absolutePath);
        } catch {
            return reply.code(404).send({ message: 'Artifact file not found.' });
        }

        const stats = await fsPromises.stat(absolutePath);

        if (userEmail) {
            const profile = await getUserProfile(userEmail);
            await updateUserProfile(userEmail, {
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

        // Track download stats if user is authenticated
        const authToken = extractAuthToken(request);
        if (authToken) {
            const payload = tokenService.verifyAccessToken(authToken);
            if (payload) {
                const profile = await getUserProfile(payload.email);
                const stats = await fsPromises.stat(absolutePath);
                await updateUserProfile(payload.email, {
                    downloadedBytes: (profile?.downloadedBytes || 0) + stats.size
                });
            }
        }

        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
        return reply.send(fs.createReadStream(absolutePath));
    });

    // ===== UPLOAD ENDPOINTS =====
    app.get('/v1/upload/:fileId/info', async (request, reply) => {
        try {
            const { fileId } = request.params as { fileId: string };
            
            const uploaded = await getUploadMeta(fileId);
            if (!uploaded) {
                return reply.code(404).send({ message: 'Upload file not found.' });
            }

            if (!uploaded.mimeType.includes('upload')) {
                return reply.code(400).send({ 
                    message: 'File is not a valid upload file.',
                    mimeType: uploaded.mimeType 
                });
            }

            const uploadInfo = await parseUploadFile(uploaded.path);

            return {
                fileId,
                fileName: uploaded.originalName,
                upload: {
                    name: uploadInfo.name,
                    infoHash: uploadInfo.infoHash,
                    files: uploadInfo.files,
                    totalLength: uploadInfo.totalLength,
                    announce: uploadInfo.announce,
                    created: uploadInfo.created,
                    comment: uploadInfo.comment,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to parse upload file';
            logger.error({ err: error, fileId: (request.params as any).fileId }, 'Upload info request failed');
            return reply.code(400).send({ success: false, message });
        }
    });

    app.post('/v1/upload/:fileId/download', async (request, reply) => {
        try {
            const { fileId } = request.params as { fileId: string };
            const parsed = UploadDownloadSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: 'Invalid upload download payload.',
                    details: parsed.error.flatten(),
                });
            }

            const uploaded = await getUploadMeta(fileId);
            if (!uploaded) {
                return reply.code(404).send({ message: 'Upload file not found.' });
            }

            if (!uploaded.mimeType.includes('upload')) {
                return reply.code(400).send({ 
                    message: 'File is not a valid upload file.',
                    mimeType: uploaded.mimeType 
                });
            }

            // Validate upload before queuing job
            const uploadInfo = await parseUploadFile(uploaded.path);
            if (!uploadInfo.files || uploadInfo.files.length === 0) {
                return reply.code(400).send({ 
                    message: 'Upload file contains no files to download.',
                });
            }

            const jobId = randomUUID();

            const token = extractAuthToken(request);
            let userId: string | undefined = undefined;
            if (token) {
                const payload = tokenService.verifyAccessToken(token);
                if (payload) {
                    userId = payload.sub;
                }
            }

            const jobData: UploadConversionJobData = {
                jobId,
                fileId,
                inputPath: uploaded.path,
                inputName: uploaded.originalName,
                fileFilter: parsed.data.fileFilter,
            };

            await updateJobStatus(jobId, {
                status: 'queued',
                stage: 'queued',
                progress: 0,
                message: 'Upload download job queued.',
            });

            // Persistent record in PostgreSQL
            await jobService.createJob({
                userId,
                bullmqJobId: jobId,
                jobType: 'upload',
                inputFilename: uploaded.originalName,
                inputSizeBytes: uploaded.size,
                inputFormat: 'upload',
                conversionType: 'upload_download',
                optionsJson: parsed.data.fileFilter ? { fileFilter: parsed.data.fileFilter } : undefined,
            });

            auditService.log({
                userId,
                eventType: 'job.created',
                severity: 'info',
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
                resourceId: jobId,
                metadata: { jobType: 'upload', inputName: uploaded.originalName }
            });

            await uploadQueue.add('download-upload', jobData, {
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
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to process upload download';
            logger.error({ err: error, fileId: (request.params as any).fileId }, 'Upload download request failed');
            return reply.code(500).send({ success: false, message });
        }
    });

    // Direct upload stream download (for large files)
    app.get('/v1/upload/:fileId/stream', async (request, reply) => {
        const token = extractAuthToken(request);
        let userEmail: string | null = null;
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        try {
            const { fileId } = request.params as { fileId: string };
            const uploaded = await getUploadMeta(fileId);
            
            if (!uploaded) {
                return reply.code(404).send({ message: 'Upload file not found.' });
            }

            if (!uploaded.mimeType.includes('upload')) {
                return reply.code(400).send({ message: 'File is not a valid upload file.' });
            }

            // Import legacy-stream dynamically
            const uploadStream = (await import('legacy-stream')).default;
            
            try {
                // Create engine from upload file
                const engine = uploadStream(uploaded.path, {
                    connections: 500,
                    uploads: 10,
                    trackers: PUBLIC_TRACKERS,
                });

                await new Promise<void>((resolve, reject) => {
                    engine.on('ready', () => {
                        // Get the largest file or first file from upload
                        const files = engine.files;
                        if (!files || files.length === 0) {
                            engine.destroy();
                            return reject(new Error('No files in upload'));
                        }

                        // Select the largest file for download
                        let selectedFile = files[0];
                        for (const file of files) {
                            if ((file as any).length > (selectedFile as any).length) {
                                selectedFile = file;
                            }
                        }

                        if (userEmail) {
                            getUserProfile(userEmail).then(profile => {
                                return updateUserProfile(userEmail as string, {
                                    downloadedBytes: (profile?.downloadedBytes || 0) + (selectedFile as any).length
                                });
                            }).catch(err => {
                                logger.error({ err }, 'Failed to update downloaded bytes for stream');
                            });
                        }

                        // Set response headers
                        reply.header('Content-Type', 'application/octet-stream');
                        reply.header('Content-Length', (selectedFile as any).length);
                        reply.header('Content-Disposition', `attachment; filename="${(selectedFile as any).name}"`);

                        // Stream the file
                        const stream = selectedFile.createReadStream();
                        stream.on('end', () => {
                            engine.destroy();
                            resolve();
                        });
                        stream.on('error', (err: Error) => {
                            engine.destroy();
                            reject(err);
                        });

                        reply.send(stream);
                    });

                    engine.on('error', (err: Error) => {
                        engine.destroy();
                        reject(err);
                    });

                    setTimeout(() => {
                        engine.destroy();
                        reject(new Error('Upload engine timeout'));
                    }, 600000); // 10 minute timeout
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to download upload';
                logger.error({ err: error, fileId }, 'Upload stream failed');
                return reply.code(500).send({ success: false, message });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to stream upload';
            logger.error({ err: error }, 'Upload stream request failed');
            return reply.code(500).send({ success: false, message });
        }
    });

    // ===== PROFILE ENDPOINTS =====

    // Request OTP for email change
    app.post('/v1/profile/change-email/request-otp', async (request, reply) => {
        let userEmail = 'alex.doe@example.com'; // Default test email
        
        // Try to get email from auth token if available
        const token = extractAuthToken(request);
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        console.log(`[Route] POST /v1/profile/change-email/request-otp - userEmail: ${userEmail}, hasToken: ${!!token}, body:`, request.body);

        const parsed = ChangeEmailRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            console.log('[Route] ChangeEmailRequestSchema validation failed:', parsed.error.flatten());
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
            });
        }

        try {
            const result = await generateEmailChangeOtp(userEmail, parsed.data.newEmail);
            return reply.send(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to generate OTP.';
            console.error('[Route] generateEmailChangeOtp error:', message);
            return reply.code(400).send({ success: false, message });
        }
    });

    // Verify OTP and change email
    app.post('/v1/profile/change-email/verify-otp', async (request, reply) => {
        let userEmail = 'alex.doe@example.com'; // Default test email
        
        // Try to get email from auth token if available
        const token = extractAuthToken(request);
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        console.log(`[Route] POST /v1/profile/change-email/verify-otp - userEmail: ${userEmail}, hasToken: ${!!token}`);

        const parsed = ChangeEmailVerifySchema.safeParse(request.body);
        if (!parsed.success) {
            console.log('[Route] ChangeEmailVerifySchema validation failed:', parsed.error.flatten());
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
            });
        }

        try {
            const result = await verifyEmailChangeOtp(userEmail, parsed.data.newEmail, parsed.data.otp);

            return reply.send({
                success: true,
                message: result.message,
                newEmail: parsed.data.newEmail,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Email verification failed.';
            console.error(`[Route] ❌ POST /v1/profile/change-email/verify-otp failed:`, error);
            return reply.code(400).send({ success: false, message });
        }
    });

    // Upload and store profile picture
    app.post('/v1/profile/upload-picture', async (request, reply) => {
        let userEmail = 'alex.doe@example.com'; // Default test email
        
        // Try to get email from auth token if available
        const token = extractAuthToken(request);
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        const file = await request.file();
        if (!file) {
            return reply.code(400).send({ success: false, message: 'Image file is required.' });
        }

        try {
            // Validate image file
            if (!file.mimetype.startsWith('image/')) {
                return reply.code(400).send({ success: false, message: 'Only image files are allowed.' });
            }

            // Get file buffer
            const buffer = await file.toBuffer();
            const dataUrl = `data:${file.mimetype};base64,${buffer.toString('base64')}`;

            // Store temporarily in Redis
            const result = await storeProfilePicture(userEmail, dataUrl, 3600); // 1 hour TTL

            return reply.send({
                success: true,
                message: 'Picture uploaded successfully.',
                pictureId: result.pictureId,
                dataUrl, // Return data URL for preview
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Picture upload failed.';
            return reply.code(500).send({ success: false, message });
        }
    });

    // Get user profile
    app.get('/v1/profile', async (request, reply) => {
        let userEmail = 'alex.doe@example.com'; // Default test email
        
        // Try to get email from auth token if available
        const token = extractAuthToken(request);
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        try {
            const profile = await getUserProfile(userEmail);
            return reply.send({
                success: true,
                profile: profile || { email: userEmail },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch profile.';
            return reply.code(500).send({ success: false, message });
        }
    });

    // Update user profile
    app.put('/v1/profile', async (request, reply) => {
        let userEmail = 'alex.doe@example.com'; // Default test email
        
        // Try to get email from auth token if available
        const token = extractAuthToken(request);
        if (token) {
            const payload = tokenService.verifyAccessToken(token);
            if (payload) {
                userEmail = payload.email;
            }
        }

        const parsed = UpdateProfileSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
            });
        }

        try {
            await updateUserProfile(userEmail, parsed.data);
            const updated = await getUserProfile(userEmail);

            return reply.send({
                success: true,
                message: 'Profile updated successfully.',
                profile: updated,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Profile update failed.';
            return reply.code(500).send({ success: false, message });
        }
    });

    app.setErrorHandler((error, request, reply) => {
        logger.error({ err: error, method: request.method, url: request.url }, 'API error');
        reply.code(500).send({ message: 'Internal server error.' });
    });
}
