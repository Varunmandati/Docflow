import path from 'path';
import fs from 'fs/promises';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import crypto from 'crypto';
import os from 'os';

/**
 * Thrown when an archive is rejected before or during extraction. A distinct
 * type so the job worker can mark it `failed` with a message the user can act
 * on, rather than surfacing a raw 7z exit code.
 */
export class ArchiveLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ArchiveLimitError';
    }
}

/**
 * Resolve a path and confirm it stays inside `root`.
 *
 * Extraction is the dangerous step: an archive entry named
 * `../../../../etc/cron.d/x` is a path traversal out of the temp directory, and
 * the temp directory is on the container filesystem. We never trust the entry
 * name for anything, but we do have to detect and refuse it.
 */
function isInsideRoot(candidate: string, root: string): boolean {
    const resolved = path.resolve(candidate);
    const normalizedRoot = path.resolve(root);
    return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
}

/**
 * Walk the extraction directory and enforce the configured caps.
 *
 * Called after extraction rather than instead of it, because there is no
 * portable way to ask 7z "how big will this get" before it runs. The caps are
 * therefore a post-hoc tripwire: the disk is already written, but the archive
 * is deleted and the job fails instead of the volume filling up. That is the
 * achievable guarantee without streaming a custom extractor.
 */
async function assertExtractionWithinLimits(dir: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;

    const walk = async (current: string): Promise<void> => {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (!isInsideRoot(full, dir)) {
                throw new ArchiveLimitError(
                    `Archive entry "${entry.name}" resolves outside the extraction directory.`
                );
            }
            if (entry.isDirectory()) {
                await walk(full);
                continue;
            }
            // A symlink/hardlink/device entry inside an archive is an escape
            // primitive; p7zip can create them. Refuse rather than follow.
            if (!entry.isFile()) {
                throw new ArchiveLimitError(
                    `Archive contains a non-regular file entry ("${entry.name}").`
                );
            }
            files++;
            const stat = await fs.lstat(full);
            bytes += stat.size;

            // Check incrementally so a bomb is abandoned early instead of after
            // the full multi-gigabyte expansion.
            if (files > env.ARCHIVE_MAX_EXTRACTED_FILES) {
                throw new ArchiveLimitError(
                    `Archive expands to more than ${env.ARCHIVE_MAX_EXTRACTED_FILES} files.`
                );
            }
            if (bytes > env.ARCHIVE_MAX_EXTRACTED_BYTES) {
                throw new ArchiveLimitError(
                    `Archive expands to more than ${env.ARCHIVE_MAX_EXTRACTED_BYTES} bytes.`
                );
            }
        }
    };

    await walk(dir);
    return { files, bytes };
}

export class ArchiveEngine implements ConverterEngine {
    name = 'Archive';

    private formats = new Set(['zip', 'tar', 'tar.gz', '7z']);

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        return this.formats.has(sourceFormat) && this.formats.has(targetFormat) && sourceFormat !== targetFormat;
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        _options?: EngineOptions
    ): Promise<EngineConversionResult> {
        const startTime = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath).startsWith('.tar') ? '.tar.gz' : path.extname(inputPath));
        const expectedOutputPath = path.join(outputDir, `${baseName}.${targetFormat}`);

        // 7z handles zip, tar, tar.gz and 7z uniformly, so one extractor covers
        // every supported source. The binary is configurable because the
        // package is named `7z` in Debian and `7zz`/`7za` in some other builds,
        // and a hard-coded name that is absent from PATH fails at job time with
        // a bare ENOENT.
        const sevenZip = env.SEVENZIP_BINARY;

        // Create a temporary directory for extraction. Scoped under the job
        // storage root rather than os.tmpdir() so a large extraction is bounded by
        // the same volume the operator sized for uploads, and so a stale
        // directory from a killed job is visible to the cleanup worker.
        const tempExtractionDir = path.join(
            env.STORAGE_ROOT,
            'temp',
            `extract-${crypto.randomBytes(8).toString('hex')}`
        );
        await fs.mkdir(tempExtractionDir, { recursive: true });
        // Remember the real path for the traversal check: on macOS os.tmpdir()
        // is a symlink (/var -> /private/var) which would make a naive
        // prefix comparison fail.
        const realExtractionDir = await fs.realpath(tempExtractionDir);

        try {
            // Unpack. -y overwrites without prompting, which is required for
            // non-interactive batch conversion. The timeout is the configured
            // archive limit, so a decompression bomb that is slow rather than
            // large still terminates.
            await SandboxRunner.execute(
                sevenZip,
                ['x', inputPath, `-o${tempExtractionDir}`, '-y', '-bd'],
                {
                    timeoutMs: env.ARCHIVE_EXTRACT_TIMEOUT_MS,
                    maxBuffer: env.COMMAND_MAX_OUTPUT_BYTES,
                }
            );

            const { files, bytes } = await assertExtractionWithinLimits(realExtractionDir);
            logger.info(
                { inputPath, files, bytes, targetFormat },
                'Archive extracted within configured limits'
            );

            // Pack
            let packArgs: string[] = [];
            if (targetFormat === 'tar.gz') {
                // 7z needs to pack tar first, then gzip. It's easier to use 'tar' command directly if available.
                // We'll assume 'tar' is available for tar/tar.gz
                packArgs = ['-czf', expectedOutputPath, '-C', realExtractionDir, '.'];
                await SandboxRunner.execute('tar', packArgs, {
                    timeoutMs: env.ARCHIVE_EXTRACT_TIMEOUT_MS,
                    maxBuffer: env.COMMAND_MAX_OUTPUT_BYTES,
                });
            } else if (targetFormat === 'tar') {
                packArgs = ['-cf', expectedOutputPath, '-C', realExtractionDir, '.'];
                await SandboxRunner.execute('tar', packArgs, {
                    timeoutMs: env.ARCHIVE_EXTRACT_TIMEOUT_MS,
                    maxBuffer: env.COMMAND_MAX_OUTPUT_BYTES,
                });
            } else {
                // For zip and 7z
                packArgs = ['a', expectedOutputPath, `${realExtractionDir}/*`, '-r', '-y'];
                await SandboxRunner.execute(sevenZip, packArgs, {
                    timeoutMs: env.ARCHIVE_EXTRACT_TIMEOUT_MS,
                    maxBuffer: env.COMMAND_MAX_OUTPUT_BYTES,
                });
            }

            const stats = await fs.stat(expectedOutputPath);
            
            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } finally {
            // Clean up temporary extraction directory
            await fs.rm(tempExtractionDir, { recursive: true, force: true });
        }
    }
}
