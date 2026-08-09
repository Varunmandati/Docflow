import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ConversionJobData, ConversionResult } from '../models/types.js';
import { CONVERSION_QUEUE_NAME } from '../queue/queues.js';
import { redisConnection } from '../queue/connection.js';
import { createJobWorkspace, toRelativeStoragePath } from '../services/storage.service.js';
import { updateJobStatus, setJobResult } from '../services/job-state.service.js';
import { auditService } from '../services/audit.service.js';
import crypto from 'crypto';
import path from 'path';

// Import Engines
import { LibreOfficeEngine } from '../services/converters/LibreOfficeEngine.js';
import { SharpEngine } from '../services/converters/SharpEngine.js';
import { FfmpegEngine } from '../services/converters/FfmpegEngine.js';
import { PdfEngine } from '../services/converters/PdfEngine.js';
import { ArchiveEngine } from '../services/converters/ArchiveEngine.js';
import { ConverterEngine } from '../services/converters/ConverterEngine.js';

const toDownloadUrl = (relativePath: string) => `/v1/files/download?path=${encodeURIComponent(relativePath)}`;

const ENGINES: ConverterEngine[] = [
    new LibreOfficeEngine(),
    new SharpEngine(),
    new FfmpegEngine(),
    new PdfEngine(),
    new ArchiveEngine()
];

export function startConversionWorker(): Worker<ConversionJobData> {
    const worker = new Worker<ConversionJobData>(
        CONVERSION_QUEUE_NAME,
        async (job: Job<ConversionJobData>) => {
            const { jobId, fileId, inputPath, inputName, sourceFormat, targetFormat, options } = job.data;

            // Only stamp startedAt on the first attempt so retries don't reset the duration.
            const firstAttempt = job.attemptsMade === 0;

            await updateJobStatus(jobId, {
                status: 'in_progress',
                stage: 'validating',
                progress: 5,
                message: 'Preparing conversion workspace.',
                startedAt: firstAttempt,
            });

            // Determine appropriate engine
            const engine = ENGINES.find(e => e.canHandle(sourceFormat, targetFormat));
            if (!engine) {
                throw new Error(`No conversion engine available to convert ${sourceFormat} to ${targetFormat}`);
            }

            const workspace = await createJobWorkspace(jobId);

            await updateJobStatus(jobId, {
                stage: 'converting',
                progress: 25,
                message: `Converting using ${engine.name}.`,
            });

            const resultInfo = await engine.convert(
                inputPath,
                workspace.outputDir,
                sourceFormat,
                targetFormat,
                options
            );

            const relativePath = toRelativeStoragePath(resultInfo.outputPath);

            const result: ConversionResult = {
                jobId,
                fileId,
                outputs: {
                    primary: {
                        relativePath,
                        downloadUrl: toDownloadUrl(relativePath),
                        size: resultInfo.sizeBytes,
                        pageCount: resultInfo.pages,
                    },
                },
                completedAt: new Date().toISOString(),
            };

            await updateJobStatus(jobId, {
                stage: 'finalizing',
                progress: 95,
                message: 'Finalizing conversion artifacts.',
            });

            await setJobResult(jobId, result);

            const downloadToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            await updateJobStatus(jobId, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                message: 'Conversion completed successfully.',
                outputFilename: path.basename(resultInfo.outputPath),
                outputSizeBytes: resultInfo.sizeBytes,
                storagePath: relativePath,
                downloadToken,
                completedAt: true,
                expiresAt,
            });

            auditService.log({
                userId: job.data.userId,
                eventType: 'job.completed',
                severity: 'info',
                resourceId: jobId,
                metadata: { inputName, outputFilename: path.basename(resultInfo.outputPath), engine: engine.name }
            });

            return result;
        },
        {
            connection: redisConnection,
            concurrency: env.WORKER_CONCURRENCY,
        }
    );

    worker.on('completed', (job: Job<ConversionJobData>, result) => {
        logger.info({ jobId: job.id }, 'Conversion job completed');
    });

    worker.on('failed', async (job: Job<ConversionJobData> | undefined, failedReason) => {
        const jobId = job?.data.jobId ?? String(job?.id ?? 'unknown');
        const message = typeof failedReason === 'string' ? failedReason : failedReason instanceof Error ? failedReason.message : 'Conversion failed.';

        // BullMQ's `failed` event fires after EVERY attempt, not just the final
        // one. Only persist failure state when no retries remain; otherwise the
        // DB status would flap failed -> in_progress on retried jobs.
        const attempts = job?.opts.attempts ?? 1;
        const isFinal = (job?.attemptsMade ?? 0) >= attempts;

        try {
            if (isFinal) {
                await updateJobStatus(jobId, {
                    status: 'failed',
                    stage: 'failed',
                    progress: 100,
                    error: message,
                    message: 'Conversion failed.',
                    completedAt: true,
                });
            }

            auditService.log({
                userId: job?.data.userId,
                eventType: 'job.failed',
                severity: 'error',
                resourceId: jobId,
                metadata: { error: message }
            });

            logger.error({ jobId, err: message }, 'Conversion job failed');
        } catch (err) {
            // A DB write failure here must never crash the process out from
            // under BullMQ; log and move on.
            logger.error({ jobId, err }, 'Failed to persist conversion failure state');
        }
    });

    return worker;
}
