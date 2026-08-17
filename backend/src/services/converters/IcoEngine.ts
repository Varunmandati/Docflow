import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';
import { env } from '../../config/env.js';
import { libreOfficeProfilePool, libreOfficeToFileUri } from './LibreOfficeEngine.js';

/**
 * ICO/ICUR is a container format: each directory entry holds either a
 * PNG-compressed image (modern icons) or an uncompressed BMP-style DIB
 * (legacy icons). LibreOffice on this machine has no ICO importer, so we
 * parse the container ourselves, extract the embedded image, and convert it.
 */
export class IcoEngine implements ConverterEngine {
    name = 'Ico';

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        return sourceFormat === 'ico' && ['png', 'jpg', 'webp', 'pdf'].includes(targetFormat);
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        options?: EngineOptions
    ): Promise<EngineConversionResult> {
        if (sourceFormat !== 'ico') {
            throw new Error(`IcoEngine only supports ICO input, requested: ${sourceFormat}`);
        }

        const startTime = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const buffer = await fs.readFile(inputPath);

        // ICO header: reserved(2) | type(2) | count(2)
        if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
            throw new Error('Invalid ICO container header.');
        }
        const count = buffer.readUInt16LE(4);
        if (count === 0) {
            throw new Error('ICO contains no images.');
        }

        // Each entry: width(1) height(1) colors(1) reserved(1) planes(2) bpp(2) size(4) offset(4)
        let best = -1;
        let bestArea = -1;
        for (let i = 0; i < count; i++) {
            const off = 6 + i * 16;
            if (off + 16 > buffer.length) break;
            const width = buffer[off] === 0 ? 256 : buffer[off];
            const height = buffer[off + 1] === 0 ? 256 : buffer[off + 1];
            const size = buffer.readUInt32LE(off + 8);
            const area = width * height;
            if (size > 0 && area > bestArea) {
                bestArea = area;
                best = i;
            }
        }
        if (best === -1) {
            throw new Error('ICO contains no readable image entries.');
        }

        const entryOffset = 6 + best * 16;
        const dataOffset = buffer.readUInt32LE(entryOffset + 12);
        const dataSize = buffer.readUInt32LE(entryOffset + 8);
        if (dataOffset + dataSize > buffer.length) {
            throw new Error('ICO image data exceeds file bounds.');
        }
        const imageData = buffer.subarray(dataOffset, dataOffset + dataSize);

        // PNG-compressed icon -> hand straight to sharp.
        if (imageData.length >= 8 && imageData[0] === 0x89 && imageData[1] === 0x50 && imageData[2] === 0x4e && imageData[3] === 0x47) {
            const outputPath = path.join(outputDir, `${baseName}.${targetFormat === 'pdf' ? 'png' : targetFormat}`);
            if (targetFormat === 'pdf') {
                const pngPath = path.join(outputDir, `${baseName}.png`);
                await fs.writeFile(pngPath, imageData);
                await this.pngToPdf(pngPath, outputDir);
                const pdfPath = path.join(outputDir, `${baseName}.pdf`);
                if (!(await fs.stat(pdfPath).catch(() => null))) {
                    throw new Error('ICO to PDF conversion produced no output.');
                }
                await fs.rm(pngPath, { force: true }).catch(() => {});
                return {
                    outputPath: pdfPath,
                    sizeBytes: (await fs.stat(pdfPath)).size,
                    durationMs: Date.now() - startTime,
                };
            } else {
                const pipeline = sharp(imageData);
                if (targetFormat === 'jpg') {
                    pipeline.jpeg({ quality: options?.quality ?? 82 });
                } else if (targetFormat === 'webp') {
                    pipeline.webp({ quality: options?.quality ?? 82 });
                } else {
                    pipeline.png();
                }
                await pipeline.toFile(outputPath);
            }
            return {
                outputPath,
                sizeBytes: (await fs.stat(outputPath)).size,
                durationMs: Date.now() - startTime,
            };
        }

        // Legacy BMP-style DIB. Reconstruct a standalone BMP file so LibreOffice
        // (which imports BMP but not ICO) can rasterize it to PDF.
        const bmpPath = path.join(outputDir, `${baseName}.bmp`);
        await fs.writeFile(bmpPath, this.dibToBmp(imageData));
        const pdfPath = path.join(outputDir, `${baseName}.pdf`);
        await this.bmpToPdf(bmpPath, outputDir);
        if (!(await fs.stat(pdfPath).catch(() => null))) {
            throw new Error('ICO (BMP) to PDF conversion produced no output.');
        }
        await fs.rm(bmpPath, { force: true }).catch(() => {});

        if (targetFormat === 'pdf') {
            return {
                outputPath: pdfPath,
                sizeBytes: (await fs.stat(pdfPath)).size,
                durationMs: Date.now() - startTime,
            };
        }

        const pdfEngine = new (await import('./PdfEngine.js')).PdfEngine();
        const result = await pdfEngine.convert(pdfPath, outputDir, 'pdf', targetFormat, options);
        await fs.rm(pdfPath, { force: true }).catch(() => {});
        return result;
    }

    /**
     * Convert an ICO DIB (BITMAPINFOHEADER + pixel data [+ AND mask]) into a
     * standalone BMP file by prepending a BITMAPFILEHEADER and dropping the
     * AND mask (the DIB's height field includes the mask rows).
     */
    private dibToBmp(dib: Buffer): Buffer {
        if (dib.length < 40) {
            throw new Error('ICO embedded DIB is too small.');
        }
        const headerSize = dib.readUInt32LE(0);
        const width = dib.readInt32LE(4);
        const storedHeight = dib.readInt32LE(8);
        const bpp = dib.readUInt16LE(14);
        if (headerSize < 40 || width <= 0 || storedHeight === 0 || bpp === 0) {
            throw new Error('ICO embedded DIB has unsupported geometry.');
        }

        // ICO DIBs double the height (image rows + AND mask rows). The sign
        // encodes the orientation (negative = top-down). Keep the sign but
        // halve the magnitude so the mask rows are dropped.
        const absHeight = Math.abs(storedHeight);
        const maskRows = Math.floor(absHeight / 2);
        const imageHeight = absHeight - maskRows;
        const signedHeight = (storedHeight < 0 ? -1 : 1) * Math.max(1, imageHeight);

        const rowSize = Math.ceil((width * bpp) / 32) * 4;
        const pixelBytes = rowSize * imageHeight;
        const headerEnd = headerSize;

        // Build BITMAPFILEHEADER + header + pixel rows (mask not copied).
        const bfOffBits = 14 + headerSize;
        const fileSize = bfOffBits + pixelBytes;
        const out = Buffer.alloc(fileSize);
        out.write('BM', 0, 'ascii');
        out.writeUInt32LE(fileSize, 2);
        out.writeUInt32LE(bfOffBits, 10);

        const bytesToCopy = Math.min(headerSize, dib.length);
        dib.copy(out, 14, 0, bytesToCopy);

        // Patch biHeight to the image-only (signed) height.
        out.writeInt32LE(signedHeight, 14 + 8);

        // Pixel rows immediately follow the header (before the AND mask).
        const pixelSource = dib.subarray(headerEnd);
        const copy = Math.min(pixelBytes, pixelSource.length);
        pixelSource.copy(out, bfOffBits, 0, copy);

        return out;
    }

    private async pngToPdf(pngPath: string, outputDir: string): Promise<void> {
        const profile = await libreOfficeProfilePool.acquire();
        try {
            await SandboxRunner.execute(env.SOFFICE_BINARY, [
                '--headless', '--invisible', '--nologo', '--nodefault', '--nofirststartwizard',
                `-env:UserInstallation=${libreOfficeToFileUri(profile.dir)}`,
                '--convert-to', 'pdf', '--outdir', outputDir, pngPath,
            ], { timeoutMs: 60000 });
        } finally {
            profile.release();
        }
    }

    private async bmpToPdf(bmpPath: string, outputDir: string): Promise<void> {
        const profile = await libreOfficeProfilePool.acquire();
        try {
            await SandboxRunner.execute(env.SOFFICE_BINARY, [
                '--headless', '--invisible', '--nologo', '--nodefault', '--nofirststartwizard',
                `-env:UserInstallation=${libreOfficeToFileUri(profile.dir)}`,
                '--convert-to', 'pdf', '--outdir', outputDir, bmpPath,
            ], { timeoutMs: 60000 });
        } finally {
            profile.release();
        }
    }
}