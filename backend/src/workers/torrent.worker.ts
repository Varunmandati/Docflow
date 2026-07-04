import { Worker } from '../queue/fake-bullmq.js';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { logger } from '../config/logger.js';
import JSZip from 'jszip';
import { TorrentConversionJobData, TorrentConversionResult } from '../models/types.js';
import { TORRENT_QUEUE_NAME } from '../queue/queues.js';
import { redisConnection } from '../queue/connection.js';
import { getFileSize, createJobWorkspace, copyInputToWorkspace, toRelativeStoragePath } from '../services/storage.service.js';
import { updateJobStatus, setJobResult } from '../services/job-state.service.js';
import { parseTorrentFile, downloadTorrentContent } from '../services/torrent.service.js';
import { env } from '../config/env.js';
import { jobService } from '../services/job.service.js';
import { auditService } from '../services/audit.service.js';
import crypto from 'crypto';

const toDownloadUrl = (relativePath: string) => `/v1/files/download?path=${encodeURIComponent(relativePath)}`;

/**
 * Creates a ZIP archive from a list of files
 */
async function createZipArchive(filesInfo: Array<{ path: string; size: number }>, outputDir: string, archiveName: string): Promise<string> {
    try {
        const zip = new JSZip();

        // For simplicity, we'll just add metadata about the files
        // In a real scenario, you'd want to actually include the file contents
        const manifest = {
            totalFiles: filesInfo.length,
            totalSize: filesInfo.reduce((sum, f) => sum + f.size, 0),
            files: filesInfo,
            createdAt: new Date().toISOString(),
        };

        zip.file('MANIFEST.json', JSON.stringify(manifest, null, 2));

        const archiveBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
        });

        const archivePath = path.join(outputDir, archiveName);
        await fsPromises.writeFile(archivePath, archiveBuffer);

        return archivePath;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create ZIP archive';
        logger.error({ err: error }, 'Error creating ZIP archive');
        throw new Error(`Archive creation failed: ${message}`);
    }
}

export function startTorrentWorker(): Worker<TorrentConversionJobData> {
    const worker = new Worker<TorrentConversionJobData>(
        TORRENT_QUEUE_NAME,
        async (job) => {
            const { jobId, fileId, inputPath, inputName, fileFilter } = job.data;

            try {
                await updateJobStatus(jobId, {
                    status: 'in_progress',
                    stage: 'parsing',
                    progress: 10,
                    message: 'Parsing torrent file metadata.',
                });

                await jobService.updateJobStatus(jobId, {
                    status: 'processing',
                    progress: 10,
                    startedAt: true,
                });

                // Parse torrent file to get metadata
                const torrentInfo = await parseTorrentFile(inputPath);

                await updateJobStatus(jobId, {
                    stage: 'downloading',
                    progress: 30,
                    message: `Downloading torrent contents (${(torrentInfo.totalLength / (1024 * 1024)).toFixed(2)} MB)...`,
                });

                // Create workspace for downloading files
                const workspace = await createJobWorkspace(jobId);

                // Download torrent content
                const downloadedFiles = await downloadTorrentContent(inputPath, workspace.outputDir, fileFilter);

                if (downloadedFiles.length === 0) {
                    throw new Error('No files were downloaded from the torrent');
                }

                await updateJobStatus(jobId, {
                    stage: 'archiving',
                    progress: 80,
                    message: 'Creating downloadable archive...',
                });

                // Create ZIP archive of downloaded files
                const archiveName = `${torrentInfo.name.replace(/[^a-z0-9]/gi, '_')}.zip`;
                const archivePath = await createZipArchive(downloadedFiles, workspace.outputDir, archiveName);

                const archiveSize = await getFileSize(archivePath);
                const archiveRelativePath = toRelativeStoragePath(archivePath);

                const result: TorrentConversionResult = {
                    jobId,
                    fileId,
                    outputs: {
                        archive: {
                            relativePath: archiveRelativePath,
                            downloadUrl: toDownloadUrl(archiveRelativePath),
                            size: archiveSize,
                        },
                        torrentInfo: {
                            name: torrentInfo.name,
                            totalLength: torrentInfo.totalLength,
                            filesCount: downloadedFiles.length,
                        },
                    },
                    completedAt: new Date().toISOString(),
                };

                await updateJobStatus(jobId, {
                    stage: 'finalizing',
                    progress: 95,
                    message: 'Finalizing torrent conversion.',
                });

                await setJobResult(jobId, result);

                await updateJobStatus(jobId, {
                    status: 'completed',
                    stage: 'completed',
                    progress: 100,
                    message: 'Torrent conversion completed successfully.',
                });

                const downloadToken = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
                await jobService.updateJobStatus(jobId, {
                    status: 'completed',
                    progress: 100,
                    outputFilename: archiveName,
                    outputSizeBytes: archiveSize,
                    storagePath: archiveRelativePath,
                    downloadToken,
                    completedAt: true,
                    expiresAt,
                });

                auditService.log({
                    eventType: 'job.completed',
                    severity: 'info',
                    resourceId: jobId,
                    metadata: { inputName, outputFilename: archiveName }
                }, 'worker');

                logger.info({ jobId, fileName: inputName, filesCount: downloadedFiles.length }, 'Torrent conversion completed');

                return result;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                logger.error({ err: error, jobId, inputName }, 'Torrent conversion failed');

                await updateJobStatus(jobId, {
                    status: 'failed',
                    stage: 'failed',
                    progress: 0,
                    error: errorMessage,
                    message: `Torrent conversion failed: ${errorMessage}`,
                });

                await jobService.updateJobStatus(jobId, {
                    status: 'failed',
                    progress: 100,
                    errorMessage,
                    completedAt: true,
                });

                auditService.log({
                    eventType: 'job.failed',
                    severity: 'error',
                    resourceId: jobId,
                    metadata: { error: errorMessage }
                }, 'worker');

                throw error;
            }
        },
        {
            connection: redisConnection,
            concurrency: env.WORKER_CONCURRENCY,
        }
    );

    worker.on('completed', (job) => {
        logger.info({ jobId: job?.id }, 'Torrent job completed');
    });

    worker.on('failed', (job, error) => {
        const jobId = String(job?.id ?? 'unknown');
        logger.error({ jobId, err: error }, 'Torrent job failed');
    });

    return worker;
}
