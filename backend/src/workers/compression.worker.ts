import path from 'path';
import { Worker } from '../queue/fake-bullmq.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { CompressionJobData, BatchImageConversionJobData } from '../models/types.js';
import { COMPRESSION_QUEUE_NAME } from '../queue/queues.js';
import { redisConnection } from '../queue/connection.js';
import { updateJobStatus, setJobResult } from '../services/job-state.service.js';
import { runCompressionJob } from '../services/compression.service.js';
import { combineImagesToSinglePdf } from '../services/image-to-pdf.service.js';
import { createJobWorkspace, copyInputToWorkspace, getFileSize, toRelativeStoragePath } from '../services/storage.service.js';
import { jobService } from '../services/job.service.js';
import { auditService } from '../services/audit.service.js';
import crypto from 'crypto';

type CompressionOrImageJobData = CompressionJobData | BatchImageConversionJobData;

function isBatchImageJob(data: CompressionOrImageJobData): data is BatchImageConversionJobData {
    return 'batchId' in data && 'imageFilePaths' in data;
}

export function startCompressionWorker(): Worker<CompressionOrImageJobData> {
    const worker = new Worker<CompressionOrImageJobData>(
        COMPRESSION_QUEUE_NAME,
        async (job) => {
            const data = job.data;

            // Handle batch image conversion
            if (isBatchImageJob(data)) {
                await updateJobStatus(data.jobId, {
                    status: 'in_progress',
                    stage: 'validating',
                    progress: 10,
                    message: 'Validating image files.',
                });

                await jobService.updateJobStatus(data.jobId, {
                    status: 'processing',
                    progress: 10,
                    startedAt: true,
                });

                const workspace = await createJobWorkspace(data.jobId);

                // Copy all images to workspace
                await updateJobStatus(data.jobId, {
                    stage: 'preparing',
                    progress: 25,
                    message: `Preparing ${data.imageFilePaths.length} images for PDF creation.`,
                });

                const copiedImagePaths: string[] = [];
                for (let i = 0; i < data.imageFilePaths.length; i++) {
                    const sourceImagePath = data.imageFilePaths[i];
                    const imageName = data.imageNames[i] || `image-${i + 1}`;
                    const copiedPath = await copyInputToWorkspace(
                        sourceImagePath,
                        workspace.inputDir,
                        imageName
                    );
                    copiedImagePaths.push(copiedPath);

                    // Update progress
                    const progress = 25 + Math.floor((i / data.imageFilePaths.length) * 40);
                    await updateJobStatus(data.jobId, {
                        stage: 'preparing',
                        progress,
                        message: `Prepared image ${i + 1} of ${data.imageFilePaths.length}`,
                    });
                }

                // Combine images into single PDF
                await updateJobStatus(data.jobId, {
                    stage: 'combining',
                    progress: 70,
                    message: `Combining ${copiedImagePaths.length} images into PDF...`,
                });

                const pdfOutputPath = path.join(workspace.outputDir, data.outputFileName);
                await combineImagesToSinglePdf(copiedImagePaths, pdfOutputPath);

                // Get file size and create result
                const pdfSize = await getFileSize(pdfOutputPath);
                const pdfRelativePath = toRelativeStoragePath(pdfOutputPath);

                const toDownloadUrl = (relativePath: string) => `/v1/files/download?path=${encodeURIComponent(relativePath)}`;

                const result = {
                    jobId: data.jobId,
                    batchId: data.batchId,
                    outputs: {
                        pdf: {
                            relativePath: pdfRelativePath,
                            downloadUrl: toDownloadUrl(pdfRelativePath),
                            size: pdfSize,
                            pageCount: copiedImagePaths.length,
                        },
                    },
                    completedAt: new Date().toISOString(),
                };

                await updateJobStatus(data.jobId, {
                    stage: 'finalizing',
                    progress: 95,
                    message: 'Finalizing PDF.',
                });

                await setJobResult(data.jobId, result);

                await updateJobStatus(data.jobId, {
                    status: 'completed',
                    stage: 'completed',
                    progress: 100,
                    message: `Successfully combined ${copiedImagePaths.length} images into PDF.`,
                });

                const downloadToken = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
                await jobService.updateJobStatus(data.jobId, {
                    status: 'completed',
                    progress: 100,
                    outputFilename: data.outputFileName,
                    outputSizeBytes: pdfSize,
                    storagePath: pdfRelativePath,
                    downloadToken,
                    completedAt: true,
                    expiresAt,
                });

                auditService.log({
                    eventType: 'job.completed',
                    severity: 'info',
                    resourceId: data.jobId,
                    metadata: { type: 'batch-combine', outputFilename: data.outputFileName }
                }, 'worker');

                return result;
            }

            // Handle compression job (original logic)
            const compressionData = data as CompressionJobData;

            await updateJobStatus(compressionData.jobId, {
                status: 'in_progress',
                stage: 'validating',
                progress: 5,
                message: 'Preparing compression workspace.',
            });

            await jobService.updateJobStatus(compressionData.jobId, {
                status: 'processing',
                progress: 5,
                startedAt: true,
            });

            const workspace = await createJobWorkspace(compressionData.jobId);
            const inputPath = await copyInputToWorkspace(compressionData.inputPath, workspace.inputDir, compressionData.inputName);

            await updateJobStatus(compressionData.jobId, {
                stage: 'analyzing_content',
                progress: 25,
                message: 'Analyzing content type and compression strategy.',
            });

            const result = await runCompressionJob({ ...compressionData, inputPath }, workspace.outputDir);

            await updateJobStatus(compressionData.jobId, {
                stage: 'finalizing',
                progress: 95,
                message: 'Finalizing compressed artifacts.',
            });

            await setJobResult(compressionData.jobId, result);

            await updateJobStatus(compressionData.jobId, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                message: 'Compression completed successfully.',
            });

            const downloadToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
            await jobService.updateJobStatus(compressionData.jobId, {
                status: 'completed',
                progress: 100,
                outputFilename: result.outputs.compressed.relativePath.split('/').pop(),
                outputSizeBytes: result.outputs.compressed.size,
                storagePath: result.outputs.compressed.relativePath,
                downloadToken,
                completedAt: true,
                expiresAt,
            });

            auditService.log({
                eventType: 'job.completed',
                severity: 'info',
                resourceId: compressionData.jobId,
                metadata: { inputName: compressionData.inputName, size: result.outputs.compressed.size }
            }, 'worker');

            return result;
        },
        {
            connection: redisConnection,
            concurrency: Math.max(1, Math.floor(env.WORKER_CONCURRENCY / 2) || 1),
        }
    );

    worker.on('completed', (job) => {
        logger.info({ jobId: job.id }, 'Compression/Image job completed');
    });

    worker.on('failed', async (job, error) => {
        const jobId = String(job?.id ?? 'unknown');
        await updateJobStatus(jobId, {
            status: 'failed',
            stage: 'failed',
            progress: 100,
            error: error.message,
            message: 'Job failed.',
        });

        await jobService.updateJobStatus(jobId, {
            status: 'failed',
            progress: 100,
            errorMessage: error.message,
            completedAt: true,
        });

        auditService.log({
            eventType: 'job.failed',
            severity: 'error',
            resourceId: jobId,
            metadata: { error: error.message }
        }, 'worker');

        logger.error({ jobId, err: error }, 'Compression/Image job failed');
    });

    return worker;
}
