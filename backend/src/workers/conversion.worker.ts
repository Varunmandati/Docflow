import { Worker } from '../queue/fake-bullmq.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ConversionJobData, ConversionResult } from '../models/types.js';
import { CONVERSION_QUEUE_NAME } from '../queue/queues.js';
import { redisConnection } from '../queue/connection.js';
import { getFileSize, createJobWorkspace, copyInputToWorkspace, toRelativeStoragePath } from '../services/storage.service.js';
import { updateJobStatus, setJobResult } from '../services/job-state.service.js';
import { convertOfficeToPdf } from '../services/libreoffice.service.js';
import { convertPdfToImages, getPdfPageCount, splitPdfByPage } from '../services/pdf.service.js';
import { generateHtmlPreviewFromPdf } from '../services/html-preview.service.js';
import { jobService } from '../services/job.service.js';
import { auditService } from '../services/audit.service.js';
import crypto from 'crypto';
import path from 'path';

const toDownloadUrl = (relativePath: string) => `/v1/files/download?path=${encodeURIComponent(relativePath)}`;

export function startConversionWorker(): Worker<ConversionJobData> {
    const worker = new Worker<ConversionJobData>(
        CONVERSION_QUEUE_NAME,
        async (job) => {
            const { jobId, fileId, inputPath, inputName, outputs } = job.data;

            await updateJobStatus(jobId, {
                status: 'in_progress',
                stage: 'validating',
                progress: 5,
                message: 'Preparing conversion workspace.',
            });

            // Update Postgres started_at status
            await jobService.updateJobStatus(jobId, {
                status: 'processing',
                progress: 5,
                startedAt: true,
            });

            const workspace = await createJobWorkspace(jobId);
            const jobInputPath = await copyInputToWorkspace(inputPath, workspace.inputDir, inputName);

            await updateJobStatus(jobId, {
                stage: 'converting_to_pdf',
                progress: 25,
                message: 'Converting source document to PDF using LibreOffice.',
            });

            const pdfPath = await convertOfficeToPdf(jobInputPath, workspace.outputDir);
            const pdfPageCount = await getPdfPageCount(pdfPath);

            const pdfRelativePath = toRelativeStoragePath(pdfPath);
            const pdfSize = await getFileSize(pdfPath);

            const result: ConversionResult = {
                jobId,
                fileId,
                outputs: {
                    pdf: {
                        relativePath: pdfRelativePath,
                        downloadUrl: toDownloadUrl(pdfRelativePath),
                        size: pdfSize,
                        pageCount: pdfPageCount,
                    },
                },
                completedAt: new Date().toISOString(),
            };

            if (outputs.splitPages) {
                await updateJobStatus(jobId, {
                    stage: 'splitting_pdf',
                    progress: 55,
                    message: 'Splitting PDF into individual pages.',
                });

                const pageFiles = await splitPdfByPage(pdfPath, workspace.pagesDir);
                result.outputs.splitPages = await Promise.all(
                    pageFiles.map(async (pageFile) => {
                        const relativePath = toRelativeStoragePath(pageFile);
                        return {
                            relativePath,
                            downloadUrl: toDownloadUrl(relativePath),
                            size: await getFileSize(pageFile),
                        };
                    })
                );
            }

            if (outputs.images) {
                await updateJobStatus(jobId, {
                    stage: 'converting_pdf_to_images',
                    progress: 70,
                    message: 'Converting PDF pages to images.',
                });

                const imageFiles = await convertPdfToImages(pdfPath, workspace.imagesDir, outputs.imageFormat, outputs.dpi);
                result.outputs.images = await Promise.all(
                    imageFiles.map(async (imagePath) => {
                        const relativePath = toRelativeStoragePath(imagePath);
                        return {
                            relativePath,
                            downloadUrl: toDownloadUrl(relativePath),
                            size: await getFileSize(imagePath),
                        };
                    })
                );
            }

            if (outputs.html) {
                await updateJobStatus(jobId, {
                    stage: 'generating_html_preview',
                    progress: 85,
                    message: 'Generating HTML preview from PDF.',
                });

                const htmlPreview = await generateHtmlPreviewFromPdf(
                    pdfPath,
                    workspace.htmlDir,
                    toDownloadUrl(pdfRelativePath)
                );

                const htmlRelativePath = toRelativeStoragePath(htmlPreview.htmlPath);
                result.outputs.html = {
                    relativePath: htmlRelativePath,
                    downloadUrl: toDownloadUrl(htmlRelativePath),
                    size: await getFileSize(htmlPreview.htmlPath),
                    mode: htmlPreview.mode,
                };
            }

            await updateJobStatus(jobId, {
                stage: 'finalizing',
                progress: 95,
                message: 'Finalizing conversion artifacts.',
            });

            await setJobResult(jobId, result);

            await updateJobStatus(jobId, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                message: 'Conversion completed successfully.',
            });

            // Persist final completed job in Postgres
            const downloadToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
            await jobService.updateJobStatus(jobId, {
                status: 'completed',
                progress: 100,
                outputFilename: path.basename(pdfPath),
                outputSizeBytes: pdfSize,
                storagePath: pdfRelativePath,
                downloadToken,
                completedAt: true,
                expiresAt,
            });

            auditService.log({
                eventType: 'job.completed',
                severity: 'info',
                resourceId: jobId,
                metadata: { inputName, outputFilename: path.basename(pdfPath) }
            }, 'worker');

            return result;
        },
        {
            connection: redisConnection,
            concurrency: env.WORKER_CONCURRENCY,
        }
    );

    worker.on('completed', (job) => {
        logger.info({ jobId: job.id }, 'Conversion job completed');
    });

    worker.on('failed', async (job, error) => {
        const jobId = String(job?.id ?? 'unknown');
        await updateJobStatus(jobId, {
            status: 'failed',
            stage: 'failed',
            progress: 100,
            error: error.message,
            message: 'Conversion failed.',
        });

        // Persist final failed job in Postgres
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

        logger.error({ jobId, err: error }, 'Conversion job failed');
    });

    return worker;
}
