import path from 'path';
import fs from 'fs/promises';
import sharp, { FormatEnum } from 'sharp';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { logger } from '../../config/logger.js';

type SharpFormat = keyof FormatEnum;

export class SharpEngine implements ConverterEngine {
    name = 'Sharp';

    // Raster image formats supported by Sharp (svg is rasterized on input via librsvg)
    private supportedFormats = new Set([
        'png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'heic', 'heif', 'avif', 'svg'
    ]);

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        // SVG is not natively converted *by* sharp in all builds (depends on librsvg),
        // but we excluded SVG to vector output. We support raster->raster.
        return this.supportedFormats.has(sourceFormat) && this.supportedFormats.has(targetFormat);
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

        // Normalize target format for Sharp
        const normalized = targetFormat === 'jpg' ? 'jpeg' : targetFormat;
        const sharpFormat = normalized as SharpFormat;

        try {
            let pipeline = sharp(inputPath, { animated: sourceFormat === 'gif' || sourceFormat === 'webp' });

            // Example mapping of generic options to Sharp options
            const formatOptions: any = {};
            if (options?.quality) {
                formatOptions.quality = options.quality;
            }

            pipeline = pipeline.toFormat(sharpFormat, formatOptions);

            // Execute the pipeline
            await pipeline.toFile(expectedOutputPath);

            const stats = await fs.stat(expectedOutputPath);
            
            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } catch (error: any) {
            logger.error({ error, inputPath, targetFormat }, 'Sharp conversion failed');
            throw new Error(`Sharp image conversion failed: ${error.message}`);
        }
    }
}
