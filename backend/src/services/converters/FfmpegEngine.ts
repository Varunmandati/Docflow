import path from 'path';
import fs from 'fs/promises';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';

export class FfmpegEngine implements ConverterEngine {
    name = 'FFmpeg';

    private audioFormats = new Set(['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a']);
    private videoFormats = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);
    private extraTargets = new Set(['gif']);

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        const isAudioSource = this.audioFormats.has(sourceFormat);
        const isVideoSource = this.videoFormats.has(sourceFormat);
        
        const isAudioTarget = this.audioFormats.has(targetFormat);
        const isVideoTarget = this.videoFormats.has(targetFormat);
        const isExtraTarget = this.extraTargets.has(targetFormat);

        if (isAudioSource && isAudioTarget) return true;
        if (isVideoSource && (isVideoTarget || isAudioTarget || isExtraTarget)) return true;
        
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

        const args = ['-y', '-i', inputPath];

        // Apply quality/bitrate options if provided
        if (options?.quality) {
            // Very simplified mapping; in production you'd map to specific audio/video bitrates
            if (this.audioFormats.has(targetFormat)) {
                args.push('-b:a', options.quality > 80 ? '320k' : '128k');
            } else if (this.videoFormats.has(targetFormat)) {
                args.push('-crf', options.quality > 80 ? '18' : '23');
            }
        }

        // Add destination
        args.push(expectedOutputPath);

        // Execute FFmpeg
        await SandboxRunner.execute('ffmpeg', args, {
            timeoutMs: 300000, // 5 minutes max for media conversion
        });

        try {
            const stats = await fs.stat(expectedOutputPath);
            
            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } catch (error) {
            throw new Error(`FFmpeg conversion completed but output file was not found at ${expectedOutputPath}`);
        }
    }
}
