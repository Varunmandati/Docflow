import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { CompressionJobData, CompressionResult } from '../models/types.js';
import { executeCommand } from './command.service.js';
import { analyzeCompressionInput } from './compression-analyzer.service.js';
import { getFileSize, toRelativeStoragePath } from './storage.service.js';

const imageExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp']);
const archiveExt = new Set(['.zip']);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const chooseQuality = (job: CompressionJobData, detectedType: string): number => {
    if (job.options.preset === 'print') return 92;
    if (job.options.preset === 'web') return 72;
    if (job.options.preset === 'email') return 68;
    if (job.options.preset === 'whatsapp') return 60;
    if (job.options.preset === 'optimize') {
        if (detectedType === 'text') return 85;
        if (detectedType === 'scanned') return 70;
        return 78;
    }
    return clamp(job.options.quality ?? 78, 30, 95);
};

async function compressImage(inputPath: string, outputPath: string, quality: number): Promise<void> {
    const ext = path.extname(inputPath).toLowerCase();
    const pipeline = sharp(inputPath, { failOn: 'none' });

    if (ext === '.png') {
        await pipeline.png({ compressionLevel: 9, quality: clamp(quality, 40, 100) }).toFile(outputPath);
        return;
    }

    if (ext === '.webp') {
        await pipeline.webp({ quality }).toFile(outputPath);
        return;
    }

    await pipeline.jpeg({ quality, mozjpeg: true }).toFile(outputPath);
}

async function compressPdf(inputPath: string, outputPath: string, quality: number): Promise<void> {
    const args = [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        // Instead of /screen which rasterizes text, we explicitly downsample images
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        `-dColorImageResolution=${quality >= 90 ? 300 : quality >= 78 ? 150 : 72}`,
        `-dGrayImageResolution=${quality >= 90 ? 300 : quality >= 78 ? 150 : 72}`,
        `-dMonoImageResolution=${quality >= 90 ? 300 : quality >= 78 ? 150 : 72}`,
        // Preserve vectors/text
        '-dCompressFonts=true',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        `-sOutputFile=${outputPath}`,
        inputPath,
    ];

    const result = await executeCommand('gs', args, env.CONVERSION_TIMEOUT_MS);
    if (result.code !== 0) {
        await fs.copyFile(inputPath, outputPath);
    }
}

async function compressZip(inputPath: string, outputPath: string, quality: number): Promise<void> {
    const raw = await fs.readFile(inputPath);
    const zip = await JSZip.loadAsync(raw);
    const outZip = new JSZip();

    const entries = Object.values(zip.files);
    for (const entry of entries) {
        if (entry.dir) continue;
        const ext = path.extname(entry.name).toLowerCase();

        if (imageExt.has(ext)) {
            const blob = await entry.async('nodebuffer');
            const transformed = await sharp(blob).jpeg({ quality: clamp(quality, 35, 92), mozjpeg: true }).toBuffer();
            const nextName = entry.name.replace(/\.(png|jpe?g|webp|bmp|tiff)$/i, '.jpg');
            outZip.file(nextName, transformed);
        } else {
            outZip.file(entry.name, await entry.async('nodebuffer'));
        }
    }

    const outputBuffer = await outZip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
    });

    await fs.writeFile(outputPath, outputBuffer);
}

/**
 * Find optimal quality level to achieve target file size using binary search.
 * Quality is clamped to a readability floor — we never destroy a document to
 * hit the size target; if the target can't be reached at the floor we accept
 * the larger (but still readable) output and report the achieved size.
 */
async function findOptimalQualityForTarget(
    inputPath: string,
    targetBytes: number,
    fileType: string,
    tolerance: number = 0.05 // 5% tolerance
): Promise<{ quality: number; achievedSize: number; qualityFloored: boolean }> {
    // Never go below this quality: below it text/images become unreadable.
    const MIN_QUALITY = 55;
    const tolerance_bytes = targetBytes * tolerance;
    let low = MIN_QUALITY;
    let high = 95;
    let bestQuality = MIN_QUALITY;
    let bestSize = 0;
    let iterations = 0;
    const maxIterations = 15;
    let qualityFloored = false;

    // Create temp directory for testing
    const tempDir = path.join(path.dirname(inputPath), '.temp-compression-test');
    await fs.mkdir(tempDir, { recursive: true });

    try {
        while (low <= high && iterations < maxIterations) {
            iterations++;
            const mid = Math.floor((low + high) / 2);
            const testOutputPath = path.join(tempDir, `test_q${mid}`);

            if (fileType === 'image') {
                await compressImage(inputPath, testOutputPath, mid);
            } else if (fileType === 'pdf') {
                await compressPdf(inputPath, testOutputPath, mid);
            } else if (fileType === 'archive') {
                await compressZip(inputPath, testOutputPath, mid);
            } else {
                break;
            }

            const size = await getFileSize(testOutputPath);
            bestSize = size;
            bestQuality = mid;
            qualityFloored = mid <= MIN_QUALITY;

            // Clean up test file
            await fs.unlink(testOutputPath).catch(() => {});

            if (size <= targetBytes + tolerance_bytes && size >= targetBytes - tolerance_bytes) {
                // Within tolerance, we can stop
                break;
            } else if (size > targetBytes + tolerance_bytes) {
                // Too large, reduce quality (but never below the readability floor)
                high = mid - 1;
                if (high < MIN_QUALITY) break;
            } else {
                // Too small, increase quality
                low = mid + 1;
            }
        }

        // If we hit the readability floor without reaching the target, prefer the
        // largest readable size we managed (bestSize) — quality preservation wins.
        if (qualityFloored && bestSize > targetBytes) {
            // Re-enforce the floor on the returned quality.
            return { quality: Math.max(bestQuality, MIN_QUALITY), achievedSize: bestSize, qualityFloored: true };
        }

        return { quality: bestQuality, achievedSize: bestSize, qualityFloored };
    } finally {
        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

export async function runCompressionJob(job: CompressionJobData, outputDir: string): Promise<CompressionResult> {
    await fs.mkdir(outputDir, { recursive: true });

    const originalSize = await getFileSize(job.inputPath);
    const inputAnalysis = await analyzeCompressionInput(job.inputPath, originalSize);
    const detectedType = inputAnalysis.detectedType;
    const appliedPreset = job.options.preset ?? inputAnalysis.recommendedPreset;

    const ext = path.extname(job.inputPath).toLowerCase();
    const base = path.basename(job.inputName, ext) || 'compressed';
    const outputExt = ext === '.rar' ? '.zip' : ext;
    const outputPath = path.join(outputDir, `${base}_compressed${outputExt}`);

    let quality = job.options.lockQuality
        ? clamp(job.options.quality ?? 78, 30, 95)
        : chooseQuality(job, detectedType);
    let usedTargetBytes = false;
    let qualityFloored = false;

    // If targetBytes is specified and not locked to a specific quality, find optimal quality
    if (job.options.targetBytes && !job.options.lockQuality) {
        let fileType = 'other';
        if (imageExt.has(ext)) {
            fileType = 'image';
        } else if (ext === '.pdf') {
            fileType = 'pdf';
        } else if (archiveExt.has(ext) || ext === '.rar') {
            fileType = 'archive';
        }

        if (fileType !== 'other') {
            try {
                const optimal = await findOptimalQualityForTarget(
                    job.inputPath,
                    job.options.targetBytes,
                    fileType,
                    0.05 // 5% tolerance
                );
                quality = optimal.quality;
                usedTargetBytes = true;
                qualityFloored = optimal.qualityFloored;
            } catch (error) {
                // If iterative compression fails, fall back to default quality
                console.warn('Target-based compression failed, using default quality:', error);
            }
        }
    }

    // Perform final compression with chosen quality
    if (imageExt.has(ext)) {
        await compressImage(job.inputPath, outputPath, quality);
    } else if (ext === '.pdf') {
        await compressPdf(job.inputPath, outputPath, quality);
    } else if (archiveExt.has(ext) || ext === '.rar') {
        await compressZip(job.inputPath, outputPath, quality);
    } else {
        await fs.copyFile(job.inputPath, outputPath);
    }

    const compressedSize = await getFileSize(outputPath);
    const savingsPercent = originalSize > 0 ? Math.max(0, ((originalSize - compressedSize) / originalSize) * 100) : 0;

    const relativePath = toRelativeStoragePath(outputPath);

    const suggestions = [...inputAnalysis.suggestions];
    if (usedTargetBytes) {
        const targetPercent = job.options.targetBytes ? Math.round((job.options.targetBytes / originalSize) * 100) : 0;
        const achievedPercent = Math.round((compressedSize / originalSize) * 100);
        if (qualityFloored) {
            suggestions.unshift(
                `Target ${Math.round(job.options.targetBytes! / 1024)}KB unreachable without losing readability — kept quality at ${quality}% (achieved ${Math.round(compressedSize / 1024)}KB)`
            );
        } else {
            suggestions.unshift(
                `Target: ${Math.round(job.options.targetBytes! / 1024)}KB | Achieved: ${Math.round(compressedSize / 1024)}KB`
            );
        }
    } else if (savingsPercent < 5) {
        suggestions.unshift('Minimal savings detected. Try web or email preset for stronger reduction.');
    }

    return {
        jobId: job.jobId,
        fileId: job.fileId,
        outputs: {
            primary: {
                relativePath,
                downloadUrl: `/v1/files/download?path=${encodeURIComponent(relativePath)}`,
                size: compressedSize,
            },
        },
        analysis: {
            detectedType,
            originalSize,
            compressedSize,
            savingsPercent,
            breakdownBytes: inputAnalysis.breakdownBytes,
            suggestions,
            recommendedPreset: inputAnalysis.recommendedPreset,
            appliedPreset,
            qualityUsed: quality,
        },
        completedAt: new Date().toISOString(),
    };
}
