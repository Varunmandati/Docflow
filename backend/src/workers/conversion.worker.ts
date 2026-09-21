import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ConversionJobData, ConversionResult, OutputFileRef } from '../models/types.js';
import { CONVERSION_QUEUE_NAME } from '../queue/queues.js';
import { redisConnection } from '../queue/connection.js';
import { createJobWorkspace, toRelativeStoragePath } from '../services/storage.service.js';
import { updateJobStatus, setJobResult } from '../services/job-state.service.js';
import { auditService } from '../services/audit.service.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

// Import Engines
import { LibreOfficeEngine, prewarmLibreOfficeProfiles } from '../services/converters/LibreOfficeEngine.js';
import { SharpEngine } from '../services/converters/SharpEngine.js';
import { FfmpegEngine } from '../services/converters/FfmpegEngine.js';
import { PdfEngine } from '../services/converters/PdfEngine.js';
import { ArchiveEngine } from '../services/converters/ArchiveEngine.js';
import { IcoEngine } from '../services/converters/IcoEngine.js';
import { HeicEngine } from '../services/converters/HeicEngine.js';
import { PdfToDocxLayoutEngine } from '../services/converters/PdfToDocxLayoutEngine.js';
import { PdfToDocxEngine } from '../services/converters/PdfToDocxEngine.js';
import { ConverterEngine, EngineConversionResult } from '../services/converters/ConverterEngine.js';
import { applyPdfOptions } from '../services/pdf-postprocess.service.js';
import { SandboxRunner } from '../utils/sandboxRunner.js';

const toDownloadUrl = (relativePath: string) => `/v1/files/download?path=${encodeURIComponent(relativePath)}`;

const OFFICE_FORMATS = new Set(['doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'md', 'epub', 'xls', 'xlsx', 'ods', 'csv', 'tsv', 'ppt', 'pptx', 'odp']);
// Raster sources Sharp cannot read natively (no libvips loader): these are
// rasterized via LibreOffice -> PDF, then PDF -> images.
const LO_RASTER_SOURCES = new Set(['bmp']);

const ENGINES: ConverterEngine[] = [
    // Conditionally load the PDF->DOCX engine based on feature flag
    (process.env.PDF_DOCX_ENGINE === 'legacy' ? new PdfToDocxLayoutEngine() : new PdfToDocxEngine()),
    new LibreOfficeEngine(),
    new IcoEngine(),
    new HeicEngine(),
    new SharpEngine(),
    new FfmpegEngine(),
    new PdfEngine(),
    new ArchiveEngine()
];

/**
 * Convert a PDF to per-page images using pdftoppm (poppler-utils).
 * Returns the list of generated image paths (in page order).
 */
async function convertPdfToImages(
    pdfPath: string,
    outputDir: string,
    imageFormat: 'jpg' | 'png',
    dpi: number
): Promise<string[]> {
    const baseName = path.basename(pdfPath, '.pdf');
    const prefix = path.join(outputDir, `${baseName}-img`);

    const popplerFlag = imageFormat === 'png' ? '-png' : '-jpeg';
    await SandboxRunner.execute(
        env.PDFTOPPM_BINARY,
        ['-r', String(Math.max(50, Math.min(400, dpi || 150))), popplerFlag, pdfPath, prefix],
        { timeoutMs: 120000 }
    );

    const dirEntries = await fs.readdir(outputDir);
    const ext = imageFormat === 'png' ? 'png' : 'jpg';
    const pageFiles = dirEntries
        .filter((name) => name.startsWith(`${baseName}-img-`) && name.endsWith(`.${ext}`))
        .sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
            const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
            return numA - numB;
        })
        .map((name) => path.join(outputDir, name));

    if (pageFiles.length === 0) {
        throw new Error('PDF to image conversion produced no page images.');
    }

    return pageFiles;
}

async function statSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
}

export function startConversionWorker(): Worker<ConversionJobData> {
    // Pre-warm LibreOffice profiles in the background so the first conversions
    // after a boot don't each pay ~15s of profile cold-start. Never blocks boot.
    prewarmLibreOfficeProfiles().catch(() => {});

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

            const workspace = await createJobWorkspace(jobId);

            await updateJobStatus(jobId, {
                stage: 'converting',
                progress: 25,
                message: `Converting using backend conversion engine.`,
            });

            // Engine selection. Office documents convert to PDF via LibreOffice;
            // PDF/image conversions use their dedicated engines. Office->image
            // is chained (office->pdf then pdf->images).
            let resultInfo: EngineConversionResult | null = null;
            let imagePaths: string[] | null = null;

            if ((OFFICE_FORMATS.has(sourceFormat) || LO_RASTER_SOURCES.has(sourceFormat)) && ['jpg', 'png'].includes(targetFormat)) {
                const libreOffice = new LibreOfficeEngine();
                const pdfResult = await libreOffice.convert(inputPath, workspace.outputDir, sourceFormat, 'pdf', options);
                imagePaths = await convertPdfToImages(
                    pdfResult.outputPath,
                    workspace.outputDir,
                    targetFormat as 'jpg' | 'png',
                    (options?.dpi as number) || 150
                );
            } else if (LO_RASTER_SOURCES.has(sourceFormat) && targetFormat === 'webp') {
                // bmp/ico -> pdf via LibreOffice, then pdf -> webp via PdfEngine.
                const libreOffice = new LibreOfficeEngine();
                const pdfResult = await libreOffice.convert(inputPath, workspace.outputDir, sourceFormat, 'pdf', options);
                const pdfEngine = new PdfEngine();
                resultInfo = await pdfEngine.convert(pdfResult.outputPath, workspace.outputDir, 'pdf', 'webp', options);
            } else if (['avif', 'heic', 'heif'].includes(sourceFormat) && targetFormat === 'pdf') {
                // LibreOffice cannot load AVIF/HEIC/HEIF. Rasterize to PNG first
                // (sharp reads AVIF; the WASM HeicEngine reads real HEVC HEIC),
                // then PNG -> PDF via LO.
                const pngEngine = sourceFormat === 'avif' ? new SharpEngine() : new HeicEngine();
                const pngResult = await pngEngine.convert(inputPath, workspace.outputDir, sourceFormat, 'png', options);
                const libreOffice = new LibreOfficeEngine();
                resultInfo = await libreOffice.convert(pngResult.outputPath, workspace.outputDir, 'png', 'pdf', options);
                await fs.rm(pngResult.outputPath, { force: true }).catch(() => {});
            } else {
                const engine = ENGINES.find(e => e.canHandle(sourceFormat, targetFormat));
                if (!engine) {
                    throw new Error(`No conversion engine available to convert ${sourceFormat} to ${targetFormat}`);
                }
                await updateJobStatus(jobId, {
                    stage: 'converting',
                    progress: 25,
                    message: `Converting using ${engine.name}.`,
                });
                resultInfo = await engine.convert(inputPath, workspace.outputDir, sourceFormat, targetFormat, options);
            }

            const buildRef = async (filePath: string, pageCount?: number): Promise<OutputFileRef & { pageCount?: number }> => {
                const relativePath = toRelativeStoragePath(filePath);
                return {
                    relativePath,
                    downloadUrl: toDownloadUrl(relativePath),
                    size: await statSize(filePath),
                    pageCount,
                };
            };

            let primaryRef: OutputFileRef & { pageCount?: number };
            let pdfRef: (OutputFileRef & { pageCount?: number }) | undefined;
            let imageRefs: OutputFileRef[] | undefined;

            if (imagePaths) {
                const refs: (OutputFileRef & { pageCount?: number })[] = [];
                for (const imagePath of imagePaths) {
                    refs.push(await buildRef(imagePath));
                }
                primaryRef = refs[0];
                imageRefs = refs;
            } else if (resultInfo) {
                primaryRef = await buildRef(resultInfo.outputPath, resultInfo.pages);
                if (targetFormat === 'pdf') {
                    // Apply watermark and/or password protection to PDF outputs
                    if (options?.watermark || options?.password) {
                        await updateJobStatus(jobId, {
                            stage: 'post-processing',
                            progress: 90,
                            message: 'Applying watermark and protection to PDF.',
                        });
                        const pdfResult = await applyPdfOptions(resultInfo.outputPath, options);
                        primaryRef = await buildRef(pdfResult.outputPath, resultInfo.pages);
                    }
                    pdfRef = primaryRef;
                } else if (['jpg', 'png'].includes(targetFormat)) {
                    imageRefs = [primaryRef];
                }
            } else {
                throw new Error('Conversion produced no output.');
            }

            const result: ConversionResult = {
                jobId,
                fileId,
                outputs: {
                    primary: primaryRef,
                    pdf: pdfRef,
                    images: imageRefs,
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
                outputFilename: path.basename(primaryRef.relativePath),
                outputSizeBytes: primaryRef.size,
                storagePath: primaryRef.relativePath,
                downloadToken,
                completedAt: true,
                expiresAt,
            });

            auditService.log({
                userId: job.data.userId,
                eventType: 'job.completed',
                severity: 'info',
                resourceId: jobId,
                metadata: { inputName, outputFilename: path.basename(primaryRef.relativePath), outputCount: (imageRefs?.length ?? 1) }
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
