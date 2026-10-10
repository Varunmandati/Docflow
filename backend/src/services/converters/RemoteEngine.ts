import fs from 'fs/promises';
import path from 'path';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';

const CONVERTAPI_BASE = 'https://v2.convertapi.com';

/**
 * External conversion engine backed by a ConvertAPI-style provider.
 *
 * Serverless runtimes ship none of the system binaries the local engines need
 * (LibreOffice, ffmpeg, ghostscript, pdftoppm, 7z, pdf2docx). When
 * CONVERTER_PROVIDER=remote, the conversion processor routes every pair that
 * isn't pure-JS/WASM (see LOCAL_SAFE_PAIRS there) through this engine, which
 * makes a single synchronous provider call and pulls the result back into the
 * job workspace.
 *
 * The provider interface is intentionally pluggable: swapping ConvertAPI for
 * CloudConvert/pdf.co is a new provider module + a registry entry, nothing in
 * the processors changes. Free-tier quotas are account-specific — run the
 * smoke tests in SERVERLESS_VERCEL_DEPLOYMENT.md right after signup.
 */
export class RemoteEngine implements ConverterEngine {
    name = 'Remote';

    canHandle(_sourceFormat: string, targetFormat: string): boolean {
        // Activation gate. The processor only consults this engine when
        // CONVERTER_PROVIDER=remote; local engines keep their pairs.
        return env.USE_REMOTE_ENGINE && !!env.CONVERTAPI_SECRET?.trim() && targetFormat !== '';
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        options?: EngineOptions
    ): Promise<EngineConversionResult> {
        return convertViaRemoteApi({ inputPath, outputDir, sourceFormat, targetFormat, options });
    }
}

const REMOTE_TIMEOUT_MS = Math.max(60_000, env.CONVERSION_TIMEOUT_MS || 180_000);

// Provider coverage, verified against ConvertAPI's live /info + canconvert
// endpoints: ConvertAPI has NO audio or video support at all and cannot
// convert between archive formats (only "anything -> zip" and "zip ->
// extract"), while CloudConvert covers audio, video and 7z. Routing by
// category keeps each conversion on the provider that can actually perform
// it, and keeps the (usually more generous) ConvertAPI quota for documents,
// images and PDFs.
const AUDIO_FORMATS = new Set(['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a']);
const VIDEO_FORMATS = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);
const CLOUDCONVERT_FORMATS = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS]);

/**
 * Pure category router — exported so the mapping is unit-testable without
 * network access. 'cloudconvert' handles audio/video and any 7z pair;
 * 'convertapi' handles documents, images, PDFs and zip/tar/tar.gz pairs.
 */
export function selectRemoteProvider(sourceFormat: string, targetFormat: string): 'cloudconvert' | 'convertapi' {
    if (CLOUDCONVERT_FORMATS.has(sourceFormat) || CLOUDCONVERT_FORMATS.has(targetFormat)) {
        return 'cloudconvert';
    }
    if (sourceFormat === '7z' || targetFormat === '7z') {
        return 'cloudconvert';
    }
    return 'convertapi';
}

function requireSecret(): string {
    const secret = env.CONVERTAPI_SECRET?.trim();
    if (!secret) {
        throw new Error('CONVERTER_PROVIDER=remote requires CONVERTAPI_SECRET.');
    }
    return secret;
}

/**
 * Convert a file through the external provider.
 *
 * Multi-page image targets (jpg/png/webp) from a non-PDF source are produced
 * by chaining source -> pdf -> images: the provider returns one file per page
 * in that mode, which is what the on-disk pdftoppm pipeline also produces.
 * All saved paths are returned; `outputPath` is the first page.
 */
export async function convertViaRemoteApi(args: {
    inputPath: string;
    outputDir: string;
    sourceFormat: string;
    targetFormat: string;
    options?: EngineOptions;
}): Promise<EngineConversionResult & { imagePaths?: string[] }> {
    const startedAt = Date.now();
    const { inputPath, outputDir, sourceFormat, targetFormat, options } = args;

    // tsv has no ConvertAPI converter (canconvert tsv/to/pdf is a 404), but
    // csv is fully supported — and TSV is just CSV with tabs. Convert the
    // delimiter locally (RFC4180 quoting), then run the csv->pdf conversion.
    if (sourceFormat === 'tsv' && targetFormat === 'pdf') {
        const csv = tsvToCsv(await fs.readFile(inputPath, 'utf8'));
        const csvPath = path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.csv`);
        await fs.writeFile(csvPath, csv);
        try {
            return await convertViaRemoteApi({ ...args, inputPath: csvPath, sourceFormat: 'csv' });
        } finally {
            await fs.rm(csvPath, { force: true }).catch(() => {});
        }
    }

    // avif has no ConvertAPI converter at all, but sharp decodes it locally
    // and png->pdf IS supported — so rasterize locally, then convert.
    if (sourceFormat === 'avif' && targetFormat === 'pdf') {
        const { default: sharp } = await import('sharp');
        const pngPath = path.join(path.dirname(inputPath), `${path.basename(inputPath, '.avif')}.png`);
        await sharp(inputPath).png().toFile(pngPath);
        try {
            return await convertViaRemoteApi({ ...args, inputPath: pngPath, sourceFormat: 'png' });
        } finally {
            await fs.rm(pngPath, { force: true }).catch(() => {});
        }
    }

    if (selectRemoteProvider(sourceFormat, targetFormat) === 'cloudconvert') {
        const { convertViaCloudConvert } = await import('./CloudConvertEngine.js');
        return convertViaCloudConvert({ inputPath, outputDir, sourceFormat, targetFormat, options });
    }

    const IMAGE_TARGETS = new Set(['jpg', 'jpeg', 'png', 'webp']);
    // Sources with a DIRECT ConvertAPI converter for image targets: calling
    // them directly is one billable conversion instead of source->pdf->image
    // (two). The remaining sources (office, epub, tsv-derived csv...) chain.
    const DIRECT_IMAGE_SOURCES = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif', 'ico']);
    if (IMAGE_TARGETS.has(targetFormat) && !DIRECT_IMAGE_SOURCES.has(sourceFormat)) {
        const pdfStep = await convertViaRemoteApi({
            inputPath,
            outputDir,
            sourceFormat,
            targetFormat: 'pdf',
            options,
        });
        try {
            return await convertViaRemoteApi({
                inputPath: pdfStep.outputPath,
                outputDir,
                sourceFormat: 'pdf',
                targetFormat,
                options,
            });
        } finally {
            await fs.rm(pdfStep.outputPath, { force: true }).catch(() => {});
        }
    }

    const secret = requireSecret();

    const form = new FormData();
    const fileBytes = await fs.readFile(inputPath);
    const inputName = path.basename(inputPath);
    form.append('File', new Blob([new Uint8Array(fileBytes)]), inputName);
    // StoreFile keeps the result on the provider's storage and returns a
    // download URL — far more size-tolerant than base64 in JSON.
    form.append('StoreFile', 'true');
    if (options?.password) {
        form.append('Password', String(options.password));
    }
    if (targetFormat === 'pdf') {
        form.append('ImageResolution', String((options?.dpi as number) || 150));
    }

    const url = `${CONVERTAPI_BASE}/convert/${encodeURIComponent(sourceFormat)}/to/${encodeURIComponent(targetFormat)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            Accept: 'application/json',
        },
        body: form,
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
            `Remote conversion ${sourceFormat}->${targetFormat} failed (${res.status}): ${detail.slice(0, 400)}`
        );
    }

    const data = (await res.json()) as { Files?: Array<{ FileName?: string; Url?: string; FileSize?: number }> };
    const files = Array.isArray(data.Files) ? data.Files : [];
    if (files.length === 0) {
        throw new Error(`Remote conversion ${sourceFormat}->${targetFormat} returned no files.`);
    }

    const baseName = path.basename(inputPath, path.extname(inputPath));
    const saved: string[] = [];
    let firstSize = 0;
    for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        if (!entry.Url) {
            throw new Error(`Remote conversion ${sourceFormat}->${targetFormat}: file entry is missing a download URL.`);
        }
        const dl = await fetch(entry.Url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
        if (!dl.ok) {
            throw new Error(`Remote conversion result download failed (${dl.status}).`);
        }
        const bytes = Buffer.from(await dl.arrayBuffer());
        if (i === 0) firstSize = bytes.length;
        const ext = (entry.FileName || `output.${targetFormat}`).split('.').pop() || targetFormat;
        const outPath = files.length === 1
            ? path.join(outputDir, `${baseName}.${ext}`)
            : path.join(outputDir, `${baseName}-page-${i + 1}.${ext}`);
        await fs.writeFile(outPath, bytes);
        saved.push(outPath);
    }

    logger.info(
        { sourceFormat, targetFormat, files: files.length, durationMs: Date.now() - startedAt },
        'Remote conversion completed'
    );

    const result: EngineConversionResult & { imagePaths?: string[] } = {
        outputPath: saved[0],
        sizeBytes: firstSize,
        pages: files.length > 1 ? files.length : undefined,
        durationMs: Date.now() - startedAt,
    };
    if (files.length > 1) {
        result.imagePaths = saved;
    }
    return result;
}

/**
 * TSV -> CSV delimiter transform with RFC4180 quoting. Exported for tests —
 * this is the local pre-step that makes tsv->pdf possible (ConvertAPI has
 * no tsv converter).
 */
export function tsvToCsv(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((line, i, arr) => !(i === arr.length - 1 && line === ''))
        .map((line) =>
            line
                .split('\t')
                .map((field) => (/[",\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field))
                .join(',')
        )
        .join('\r\n');
}

/**
 * Compress a non-image file through the external provider.
 *
 * Image/zip/office compression is pure JS (sharp/JSZip) and stays local; only
 * PDF compression needs a real renderer, which serverless runtimes lack (no
 * ghostscript). Maps our quality knob onto the provider's ImageResolution the
 * same way the local gs pipeline does.
 */
export async function compressViaRemoteApi(
    inputPath: string,
    outputDir: string,
    quality: number
): Promise<string> {
    const startedAt = Date.now();
    const secret = requireSecret();
    const ext = path.extname(inputPath).replace('.', '').toLowerCase();

    const dpi = quality >= 90 ? 300 : quality >= 78 ? 150 : 72;

    const form = new FormData();
    const fileBytes = await fs.readFile(inputPath);
    form.append('File', new Blob([new Uint8Array(fileBytes)]), path.basename(inputPath));
    form.append('StoreFile', 'true');
    // ConvertAPI's compress tool lives at /convert/{ext}/to/compress (not
    // /compress/{ext}) and takes ImageResolution/ImageQuality — verified
    // against the live OpenAPI schema.
    form.append('ImageResolution', String(dpi));
    form.append('ImageQuality', String(Math.max(10, Math.min(100, quality))));

    const url = `${CONVERTAPI_BASE}/convert/${encodeURIComponent(ext)}/to/compress`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            Accept: 'application/json',
        },
        body: form,
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Remote compress ${ext} failed (${res.status}): ${detail.slice(0, 400)}`);
    }

    const data = (await res.json()) as { Files?: Array<{ FileName?: string; Url?: string }> };
    const files = Array.isArray(data.Files) ? data.Files : [];
    if (files.length === 0 || !files[0].Url) {
        throw new Error(`Remote compress ${ext} returned no files.`);
    }

    const dl = await fetch(files[0].Url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
    if (!dl.ok) {
        throw new Error(`Remote compress result download failed (${dl.status}).`);
    }
    const bytes = Buffer.from(await dl.arrayBuffer());
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outExt = (files[0].FileName || `compressed.${ext}`).split('.').pop() || ext;
    const outPath = path.join(outputDir, `${baseName}_compressed.${outExt}`);
    await fs.writeFile(outPath, bytes);

    logger.info({ ext, quality, dpi, durationMs: Date.now() - startedAt }, 'Remote compression completed');
    return outPath;
}
