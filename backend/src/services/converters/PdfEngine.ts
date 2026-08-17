import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';

export class PdfEngine implements ConverterEngine {
    name = 'PDFEngine (Poppler + Sharp)';

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        // Handle PDF to Images
        if (sourceFormat === 'pdf' && ['jpg', 'png', 'webp'].includes(targetFormat)) {
            return true;
        }
        return false;
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        options?: EngineOptions
    ): Promise<EngineConversionResult> {
        const startTime = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const expectedOutputPath = path.join(outputDir, `${baseName}.${targetFormat}`);

        // We use pdftocairo (poppler-utils) to rasterize the first page of the
        // PDF, then optionally re-encode with sharp (webp) or resize (jpg/png).
        let args: string[] = [];

        if (targetFormat === 'jpg' || targetFormat === 'jpeg') {
            args = ['-jpeg', '-singlefile', inputPath, path.join(outputDir, baseName)];
            await SandboxRunner.execute('pdftocairo', args, { timeoutMs: 120000 });
        } else {
            // png (native) or webp (png then sharp re-encode)
            args = ['-png', '-singlefile', inputPath, path.join(outputDir, baseName)];
            await SandboxRunner.execute('pdftocairo', args, { timeoutMs: 120000 });
        }

        if (targetFormat === 'webp') {
            const pngPath = path.join(outputDir, `${baseName}.png`);
            await sharp(pngPath).webp({ quality: options?.quality ?? 82 }).toFile(expectedOutputPath);
            await fs.rm(pngPath, { force: true });
        }

        try {
            const stats = await fs.stat(expectedOutputPath);
            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } catch (error) {
            throw new Error(`PdfEngine conversion completed but output file was not found at ${expectedOutputPath}`);
        }
    }
}
