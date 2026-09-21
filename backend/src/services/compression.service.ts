import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { PngOptions } from 'sharp';
import { env } from '../config/env.js';
import { CompressionJobData, CompressionResult } from '../models/types.js';
import { executeCommand } from './command.service.js';
import { analyzeCompressionInput } from './compression-analyzer.service.js';
import { getFileSize, toRelativeStoragePath } from './storage.service.js';

const imageExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp']);
const archiveExt = new Set(['.zip']);
const officeExt = new Set(['.docx', '.pptx', '.xlsx']);

// Formats whose re-encoded bytes are always JPEG — the output file must carry
// a .jpg extension to match the content. WebP is NOT in this set: WebP keeps
// its native alpha-friendly format. TIFF/BMP are handled per-pixel below so
// alpha-capable sources stay alpha-preserving.
const jpegOutputExt = new Set(['.tiff', '.bmp']);

// Target-mode search space. Quality never drops below the readability floor;
// instead we reduce pixel dimensions (images), palette depth (PNG), or image
// DPI (PDF) so the user's requested size is actually achieved.
const MIN_TARGET_QUALITY = 55;
const MAX_TARGET_QUALITY = 95;
const IMAGE_SCALE_TIERS = [1, 0.85, 0.7, 0.6, 0.5, 0.4, 0.35];
const PNG_PALETTE_TIERS = [256, 128, 64];
const PDF_DPI_TIERS = [150, 96, 60, 48];

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

/**
 * Decide the output extension for an image source, preserving alpha.
 * - PNG / WebP keep their native (alpha-safe) formats.
 * - JPEG stays JPEG (no alpha anyway).
 * - TIFF / BMP carry a JPEG only when the source has NO alpha; when it does,
 *   they are emitted as PNG so transparency / stickers survive.
 */
async function determineImageOutputExt(blobOrPath: Buffer | string, ext: string): Promise<string> {
    if (ext === '.png' || ext === '.webp') return ext;
    if (ext === '.jpg' || ext === '.jpeg') return '.jpg';
    try {
        const pipeline = typeof blobOrPath === 'string'
            ? sharp(blobOrPath, { failOn: 'none' })
            : sharp(blobOrPath, { failOn: 'none' });
        const meta = await pipeline.metadata();
        if (meta.hasAlpha) return '.png';
    } catch {
        // Fall through — assume no meaningful alpha and use JPEG.
    }
    return '.jpg';
}

interface CompressImageOptions {
    scale?: number;
    paletteColors?: number;
}

/**
 * Re-encode image bytes to the requested output extension. The format is
 * chosen from the OUTPUT extension, never the source, so an alpha-capable
 * source routed to '.png' stays lossless-and-transparent.
 */
async function compressImageBuffer(blob: Buffer, outExt: string, quality: number, opts: CompressImageOptions = {}): Promise<Buffer> {
    let pipeline = sharp(blob, { failOn: 'none' });
    const scale = opts.scale ?? 1;
    if (scale < 1) {
        const meta = await sharp(blob, { failOn: 'none' }).metadata().catch(() => null);
        const w = meta?.width ? Math.max(1, Math.round(meta.width * scale)) : undefined;
        const h = meta?.height ? Math.max(1, Math.round(meta.height * scale)) : undefined;
        if (w && h) pipeline = pipeline.resize(w, h, { fit: 'inside' });
    }
    if (outExt === '.png') {
        const pngOpts: PngOptions = { compressionLevel: 9 };
        if (opts.paletteColors) {
            pngOpts.palette = true;
            pngOpts.colors = opts.paletteColors;
        }
        return pipeline.png(pngOpts).toBuffer();
    }
    if (outExt === '.webp') {
        return pipeline.webp({ quality }).toBuffer();
    }
    return pipeline.jpeg({ quality: clamp(quality, 35, 92), mozjpeg: true }).toBuffer();
}

async function compressImage(inputPath: string, outputPath: string, quality: number, opts: CompressImageOptions = {}): Promise<void> {
    const inExt = path.extname(inputPath).toLowerCase();
    const outExt = path.extname(outputPath).toLowerCase();
    // The target-size search writes extension-less temp files; use the
    // source's own decided format in that case so the test bytes match the
    // final artifact's encoding.
    const effectiveExt = outExt || await determineImageOutputExt(inputPath, inExt);

    let pipeline = sharp(inputPath, { failOn: 'none' });
    const scale = opts.scale ?? 1;
    if (scale < 1) {
        const meta = await sharp(inputPath, { failOn: 'none' }).metadata().catch(() => null);
        const w = meta?.width ? Math.max(1, Math.round(meta.width * scale)) : undefined;
        const h = meta?.height ? Math.max(1, Math.round(meta.height * scale)) : undefined;
        if (w && h) pipeline = pipeline.resize(w, h, { fit: 'inside' });
    }

    if (effectiveExt === '.png') {
        const pngOpts: PngOptions = { compressionLevel: 9 };
        if (opts.paletteColors) {
            pngOpts.palette = true;
            pngOpts.colors = opts.paletteColors;
        }
        await pipeline.png(pngOpts).toFile(outputPath);
        return;
    }

    if (effectiveExt === '.webp') {
        await pipeline.webp({ quality }).toFile(outputPath);
        return;
    }

    await pipeline.jpeg({ quality: clamp(quality, 35, 92), mozjpeg: true }).toFile(outputPath);
}

async function compressPdf(inputPath: string, outputPath: string, quality: number, dpiOverride?: number, jpegQ?: number): Promise<void> {
    const dpi = dpiOverride ?? (quality >= 90 ? 300 : quality >= 78 ? 150 : 72);
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
        `-dColorImageResolution=${dpi}`,
        `-dGrayImageResolution=${dpi}`,
        `-dMonoImageResolution=${dpi}`,
        // Preserve vectors/text
        '-dCompressFonts=true',
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=true',
        ...(jpegQ ? [`-dJPEGQ=${jpegQ}`] : []),
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
            // Keep alpha-capable formats (PNG/WebP) native; JPEG only for
            // opaque sources. This is what keeps stickers/overlays intact.
            const outExt = await determineImageOutputExt(blob, ext);
            const transformed = await compressImageBuffer(blob, outExt, quality);
            const nextName = entry.name.replace(/\.(png|jpe?g|webp|bmp|tiff)$/i, outExt);
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
 * Compress DOCX / PPTX / XLSX (OOXML packages are zips). Media entries are
 * re-encoded *in place* — same entry name, same image format — so the internal
 * rels/document.xml references continue to resolve. PNG/WebP are kept in their
 * native alpha-preserving formats; JPEGs are re-encoded with the target
 * quality; alpha-capable TIFF/BMP are kept transparent (PNG) while opaque ones
 * become JPEG.
 */
async function compressOffice(inputPath: string, outputPath: string, quality: number): Promise<void> {
    const raw = await fs.readFile(inputPath);
    const zip = await JSZip.loadAsync(raw);
    const outZip = new JSZip();

    const entries = Object.values(zip.files);
    for (const entry of entries) {
        if (entry.dir) continue;
        const ext = path.extname(entry.name).toLowerCase();

        if (imageExt.has(ext)) {
            const blob = await entry.async('nodebuffer');
            const outExt = await determineImageOutputExt(blob, ext);
            const transformed = await compressImageBuffer(blob, outExt, quality);
            const nextName = outExt === ext
                ? entry.name
                : entry.name.replace(/\.(png|jpe?g|webp|bmp|tiff)$/i, outExt);
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

interface TargetSearchResult {
    quality: number;
    scale: number;
    paletteColors?: number;
    outExt?: string;
    dpi?: number;
    achievedSize: number;
    floored: boolean;
}

const tempDirOf = (inputPath: string) => path.join(os.tmpdir(), 'docflow-compress-test');

/** Binary search the highest quality whose output fits the target (with tolerance). */
async function binarySearchQuality(
    probe: (quality: number) => Promise<number>,
    targetBytes: number,
    toleranceBytes: number,
    minQuality: number = MIN_TARGET_QUALITY,
    maxQuality: number = MAX_TARGET_QUALITY,
): Promise<{ quality: number; size: number } | null> {
    let low = minQuality;
    let high = maxQuality;
    let best: { quality: number; size: number } | null = null;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const size = await probe(mid);
        if (size <= targetBytes + toleranceBytes) {
            // Fits — remember it and try to push quality higher.
            best = { quality: mid, size };
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return best;
}

/**
 * Find optimal compression parameters to achieve a target file size.
 * - Images: binary search quality at full resolution; if the readability floor
 *   is hit, reduce pixel dimensions (scale tiers) — quality stays readable.
 * - PNG: lossless re-encode at decreasing scale, then palette quantization,
 *   then (last resort) alpha-flattened JPEG so very small targets are met.
 * - PDF: downsample embedded images at decreasing DPI, then raise JPEG
 *   quality inside each DPI tier so the largest readable DPI wins.
 * - Archives / office: binary search quality only (structure must be kept).
 * When the target is physically unreachable the smallest readable result is
 * returned with `floored: true` so the caller can report it honestly.
 */
export async function findOptimalQualityForTarget(
    inputPath: string,
    targetBytes: number,
    fileType: string,
): Promise<TargetSearchResult> {
    const toleranceBytes = targetBytes * 0.05;
    const tempParent = tempDirOf(inputPath);
    await fs.mkdir(tempParent, { recursive: true });
    const tempDir = await fs.mkdtemp(path.join(tempParent, 'probe-'));
    let smallest: TargetSearchResult | null = null;

    const track = (candidate: TargetSearchResult): TargetSearchResult => {
        if (!smallest || candidate.achievedSize < smallest.achievedSize) smallest = candidate;
        return candidate;
    };

    try {
        if (fileType === 'image') {
            const inExt = path.extname(inputPath).toLowerCase();
            const sourceExt = await determineImageOutputExt(inputPath, inExt);
            const isPngSource = sourceExt === '.png';

            // 1) Lossless-capable formats (PNG): scale reduction first — the
            //    quality knob does not apply to lossless PNG bytes.
            if (isPngSource) {
                for (const scale of IMAGE_SCALE_TIERS) {
                    const probePath = path.join(tempDir, `png_s${scale}.png`);
                    await compressImage(inputPath, probePath, 95, { scale });
                    const size = await getFileSize(probePath);
                    await fs.unlink(probePath).catch(() => {});
                    if (size <= targetBytes + toleranceBytes) {
                        return track({ quality: 95, scale, achievedSize: size, floored: false });
                    }
                }

                // 2) Palette quantization (keeps PNG + alpha) at full size,
                //    then at reduced scales.
                for (const scale of IMAGE_SCALE_TIERS) {
                    for (const colors of PNG_PALETTE_TIERS) {
                        const probePath = path.join(tempDir, `png_p${colors}_s${scale}.png`);
                        await compressImage(inputPath, probePath, 95, { scale, paletteColors: colors });
                        const size = await getFileSize(probePath);
                        await fs.unlink(probePath).catch(() => {});
                        if (size <= targetBytes + toleranceBytes) {
                            return track({ quality: 95, scale, paletteColors: colors, achievedSize: size, floored: false });
                        }
                    }
                }

                // 3) Last resort: flatten alpha and re-encode as JPEG at the
                //    highest quality that fits (extension changes to .jpg).
                const flattenProbe = async (quality: number, scale: number): Promise<number> => {
                    const probePath = path.join(tempDir, `jpg_q${quality}_s${scale}.jpg`);
                    await compressImage(inputPath, probePath, quality, { scale });
                    const size = await getFileSize(probePath);
                    await fs.unlink(probePath).catch(() => {});
                    return size;
                };
                for (const scale of IMAGE_SCALE_TIERS) {
                    const found = await binarySearchQuality(
                        (q) => flattenProbe(q, scale),
                        targetBytes,
                        toleranceBytes,
                    );
                    if (found) {
                        return track({ quality: found.quality, scale, outExt: '.jpg', achievedSize: found.size, floored: false });
                    }
                }
            } else {
                // 3) JPEG / WebP / opaque TIFF-BMP: quality search at full
                //    resolution, then scale reduction when the floor is hit.
                for (const scale of IMAGE_SCALE_TIERS) {
                    const probe = async (quality: number): Promise<number> => {
                        const probePath = path.join(tempDir, `q${quality}_s${scale}.${sourceExt === '.webp' ? 'webp' : 'jpg'}`);
                        await compressImage(inputPath, probePath, quality, { scale });
                        const size = await getFileSize(probePath);
                        await fs.unlink(probePath).catch(() => {});
                        return size;
                    };
                    const found = await binarySearchQuality(
                        probe,
                        targetBytes,
                        toleranceBytes,
                    );
                    if (found) {
                        return track({ quality: found.quality, scale, achievedSize: found.size, floored: false });
                    }
                }
            }
        } else if (fileType === 'pdf') {
            // Highest DPI tier that can reach the target wins; inside a tier
            // we raise the embedded-image JPEG quality as high as it fits.
            const probe = async (dpi: number, jpegQ: number): Promise<number> => {
                const probePath = path.join(tempDir, `pdf_d${dpi}_q${jpegQ}`);
                await compressPdf(inputPath, probePath, 92, dpi, jpegQ);
                const size = await getFileSize(probePath);
                await fs.unlink(probePath).catch(() => {});
                return size;
            };
            for (const dpi of PDF_DPI_TIERS) {
                const found = await binarySearchQuality(
                    (q) => probe(dpi, q),
                    targetBytes,
                    toleranceBytes,
                );
                if (found) {
                    return track({ quality: found.quality, scale: 1, dpi, achievedSize: found.size, floored: false });
                }
            }
        } else if (fileType === 'archive') {
            const probe = async (quality: number): Promise<number> => {
                const probePath = path.join(tempDir, `zip_q${quality}`);
                await compressZip(inputPath, probePath, quality);
                const size = await getFileSize(probePath);
                await fs.unlink(probePath).catch(() => {});
                return size;
            };
            const found = await binarySearchQuality(probe, targetBytes, toleranceBytes);
            if (found) {
                return track({ quality: found.quality, scale: 1, achievedSize: found.size, floored: false });
            }
        }

        // Target unreachable — return the smallest readable candidate.
        const fallback = smallest ?? { quality: MIN_TARGET_QUALITY, scale: 1, achievedSize: 0, floored: true };
        return { ...fallback, floored: true };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        await fs.rm(tempParent, { recursive: true, force: true }).catch(() => {});
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
    const isRar = ext === '.rar';
    const sourceExt = isRar ? '.rar'
        : imageExt.has(ext) ? await determineImageOutputExt(job.inputPath, ext)
        : jpegOutputExt.has(ext) ? '.jpg'
        : ext;
    const outputExt = isRar ? '.rar' : sourceExt;
    const outputPath = path.join(outputDir, `${base}_compressed${outputExt}`);

    // Quality-preserving sibling: re-encode at a high fidelity floor so the
    // user always receives a near-lossless variant alongside the
    // criteria-matched file.
    const qualityOutputPath = path.join(outputDir, `${base}_quality_preserved${sourceExt}`);
    const QUALITY_PRESERVE_QUALITY = 92;

    let quality = job.options.lockQuality
        ? clamp(job.options.quality ?? 78, 30, 95)
        : chooseQuality(job, detectedType);
    let usedTargetBytes = false;
    let qualityFloored = false;
    let search: TargetSearchResult | undefined;

    // If targetBytes is specified and not locked to a specific quality, find optimal quality
    if (job.options.targetBytes && !job.options.lockQuality) {
        let fileType = 'other';
        if (imageExt.has(ext)) {
            fileType = 'image';
        } else if (ext === '.pdf') {
            fileType = 'pdf';
        } else if (archiveExt.has(ext) || ext === '.rar' || officeExt.has(ext)) {
            fileType = 'archive';
        }

        if (fileType !== 'other') {
            try {
                search = await findOptimalQualityForTarget(
                    job.inputPath,
                    job.options.targetBytes,
                    fileType,
                );
                quality = search.quality;
                usedTargetBytes = true;
                qualityFloored = search.floored;
            } catch (error) {
                // If iterative compression fails, fall back to default quality
                console.warn('Target-based compression failed, using default quality:', error);
            }
        }
    }

    const finalOutputExt = search?.outExt || outputExt;
    const finalOutputPath = search?.outExt && search.outExt !== outputExt
        ? path.join(outputDir, `${base}_compressed${search.outExt}`)
        : outputPath;

    // Perform final compression with chosen quality
    if (isRar) {
        // RAR is a proprietary container JSZip cannot unpack; preserve the
        // bytes so the user never loses data.
        await fs.copyFile(job.inputPath, finalOutputPath);
        await fs.copyFile(job.inputPath, qualityOutputPath);
    } else if (imageExt.has(ext)) {
        await compressImage(job.inputPath, finalOutputPath, quality, { scale: search?.scale ?? 1, paletteColors: search?.paletteColors });
    } else if (ext === '.pdf') {
        await compressPdf(job.inputPath, finalOutputPath, quality, search?.dpi, search ? quality : undefined);
    } else if (archiveExt.has(ext)) {
        await compressZip(job.inputPath, finalOutputPath, quality);
    } else if (officeExt.has(ext)) {
        await compressOffice(job.inputPath, finalOutputPath, quality);
    } else {
        await fs.copyFile(job.inputPath, finalOutputPath);
    }

    // Quality-preserving variant: same pipeline, high fidelity floor. When the
    // user already asked for a high-quality result (quality >= floor) the two
    // files converge — that is expected and both stay downloadable.
    if (!isRar) {
        if (imageExt.has(ext)) {
            await compressImage(job.inputPath, qualityOutputPath, QUALITY_PRESERVE_QUALITY);
        } else if (ext === '.pdf') {
            await compressPdf(job.inputPath, qualityOutputPath, QUALITY_PRESERVE_QUALITY);
        } else if (archiveExt.has(ext)) {
            await compressZip(job.inputPath, qualityOutputPath, QUALITY_PRESERVE_QUALITY);
        } else if (officeExt.has(ext)) {
            await compressOffice(job.inputPath, qualityOutputPath, QUALITY_PRESERVE_QUALITY);
        } else {
            await fs.copyFile(job.inputPath, qualityOutputPath);
        }
    }

    const compressedSize = await getFileSize(finalOutputPath);
    const qualityOutputSize = await getFileSize(qualityOutputPath);
    const savingsPercent = originalSize > 0 ? Math.max(0, ((originalSize - compressedSize) / originalSize) * 100) : 0;

    const relativePath = toRelativeStoragePath(finalOutputPath);
    const qualityRelativePath = toRelativeStoragePath(qualityOutputPath);

    const suggestions = [...inputAnalysis.suggestions];
    if (isRar) {
        suggestions.unshift('RAR archives are preserved as-is (proprietary container). Convert to ZIP first for recompression.');
    } else if (usedTargetBytes) {
        const targetPercent = job.options.targetBytes ? Math.round((job.options.targetBytes / originalSize) * 100) : 0;
        const achievedPercent = Math.round((compressedSize / originalSize) * 100);
        const detailParts: string[] = [];
        if (search?.scale && search.scale < 1) detailParts.push(`resized to ${Math.round(search.scale * 100)}%`);
        if (search?.paletteColors) detailParts.push(`palette ${search.paletteColors} colors`);
        if (search?.dpi) detailParts.push(`images ${search.dpi} DPI`);
        const detail = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : '';
        if (qualityFloored) {
            suggestions.unshift(
                `Target ${Math.round(job.options.targetBytes! / 1024)}KB not reachable at readable quality${detail} — smallest result kept: ${Math.round(compressedSize / 1024)}KB (${achievedPercent}% of original)`
            );
        } else {
            suggestions.unshift(
                `Target: ${Math.round(job.options.targetBytes! / 1024)}KB | Achieved: ${Math.round(compressedSize / 1024)}KB${detail}`
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
            quality: {
                relativePath: qualityRelativePath,
                downloadUrl: `/v1/files/download?path=${encodeURIComponent(qualityRelativePath)}`,
                size: qualityOutputSize,
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
            scaleUsed: search?.scale ?? 1,
            dpiUsed: search?.dpi,
        },
        completedAt: new Date().toISOString(),
    };
}