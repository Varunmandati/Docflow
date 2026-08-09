import path from 'path';
import fs from 'fs/promises';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';
import crypto from 'crypto';
import os from 'os';

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
        options?: EngineOptions
    ): Promise<EngineConversionResult> {
        const startTime = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath).startsWith('.tar') ? '.tar.gz' : path.extname(inputPath));
        const expectedOutputPath = path.join(outputDir, `${baseName}.${targetFormat}`);

        // Create a temporary directory for extraction
        const tempExtractionDir = path.join(os.tmpdir(), `extract-${crypto.randomBytes(8).toString('hex')}`);
        await fs.mkdir(tempExtractionDir, { recursive: true });

        try {
            // Unpack
            // Note: In a production Linux environment, '7z' or 'bsdtar' would be used.
            // Using 7z for universal extraction
            await SandboxRunner.execute('7z', ['x', inputPath, `-o${tempExtractionDir}`, '-y'], {
                timeoutMs: 120000,
            });

            // Pack
            let packArgs: string[] = [];
            if (targetFormat === 'tar.gz') {
                // 7z needs to pack tar first, then gzip. It's easier to use 'tar' command directly if available.
                // We'll assume 'tar' is available for tar/tar.gz
                packArgs = ['-czf', expectedOutputPath, '-C', tempExtractionDir, '.'];
                await SandboxRunner.execute('tar', packArgs, { timeoutMs: 120000 });
            } else if (targetFormat === 'tar') {
                packArgs = ['-cf', expectedOutputPath, '-C', tempExtractionDir, '.'];
                await SandboxRunner.execute('tar', packArgs, { timeoutMs: 120000 });
            } else {
                // For zip and 7z
                packArgs = ['a', expectedOutputPath, path.join(tempExtractionDir, '*'), '-r', '-y'];
                await SandboxRunner.execute('7z', packArgs, { timeoutMs: 120000 });
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
