import path from 'path';
import fs from 'fs/promises';
import sharp, { FormatEnum } from 'sharp';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { logger } from '../../config/logger.js';

type SharpFormat = keyof FormatEnum;

/**
 * Decodes HEIC/HEIF (HEVC-coded, e.g. iPhone photos) to raw RGBA via the
 * WASM libheif build in `heic-decode`, then re-encodes with sharp.
 *
 * The prebuilt native sharp on this machine has no x265 plugin, so it cannot
 * decode real HEVC HEIC files ("No decoding plugin installed"). heic-decode
 * ships libheif with x265 compiled to WASM, which decodes them fine.
 */
export class HeicEngine implements ConverterEngine {
    name = 'HEIC (WASM libheif)';

    private supportedSources = new Set(['heic', 'heif']);
    private supportedTargets = new Set(['png', 'jpg', 'jpeg', 'webp']);

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        return this.supportedSources.has(sourceFormat) && this.supportedTargets.has(targetFormat);
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

        const { default: heicDecode } = await import('heic-decode');
        const buffer = await fs.readFile(inputPath);
        const { width, height, data } = await heicDecode({ buffer });

        const normalized = targetFormat === 'jpg' ? 'jpeg' : targetFormat;
        const sharpFormat = normalized as SharpFormat;

        const formatOptions: any = {};
        if (options?.quality) {
            formatOptions.quality = options.quality;
        }

        await sharp(data, { raw: { width, height, channels: 4 } })
            .toFormat(sharpFormat, formatOptions)
            .toFile(expectedOutputPath);

        try {
            const stats = await fs.stat(expectedOutputPath);
            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } catch (error) {
            throw new Error(`HEIC conversion produced no output at ${expectedOutputPath}`);
        }
    }
}
