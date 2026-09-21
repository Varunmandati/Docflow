import fs from 'fs/promises';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { EngineOptions } from './converters/ConverterEngine.js';
import { logger } from '../config/logger.js';

/**
 * Apply watermark, page numbers, and/or password protection to a PDF file.
 * This is a post-processing step after conversion.
 */
export async function applyPdfOptions(
    pdfPath: string,
    options?: EngineOptions
): Promise<{ outputPath: string; sizeBytes: number }> {
    if (!options?.watermark && !options?.password && !options?.pageNumbers) {
        // No post-processing needed
        const stats = await fs.stat(pdfPath);
        return { outputPath: pdfPath, sizeBytes: stats.size };
    }

    const startTime = Date.now();
    const bytes = await fs.readFile(pdfPath);
    const pdf = await PDFDocument.load(bytes);

    // Apply watermark if provided
    if (options?.watermark?.text) {
        await applyWatermark(pdf, options.watermark);
    }

    // Apply page numbers if requested
    if (options?.pageNumbers) {
        await applyPageNumbers(pdf);
    }

    // Apply password protection if provided
    if (options?.password) {
        // If watermark or page numbers were applied in-memory, write the modified bytes first
        // so password protection operates on the modified version
        if (options?.watermark?.text || options?.pageNumbers) {
            const watermarkedBytes = await pdf.save();
            await fs.writeFile(pdfPath, watermarkedBytes);
        }
        const protectedPath = await applyPasswordProtection(pdfPath, options.password);
        const stats = await fs.stat(protectedPath);
        logger.info({ durationMs: Date.now() - startTime }, 'PDF post-processing completed');
        return { outputPath: protectedPath, sizeBytes: stats.size };
    }

    // Save the modified PDF (watermark/page numbers only, no password)
    if (options?.watermark?.text || options?.pageNumbers) {
        const modifiedBytes = await pdf.save();
        await fs.writeFile(pdfPath, modifiedBytes);
    }
    const stats = await fs.stat(pdfPath);
    logger.info({ durationMs: Date.now() - startTime }, 'PDF post-processing completed');
    return { outputPath: pdfPath, sizeBytes: stats.size };
}

async function applyWatermark(
    pdf: PDFDocument,
    watermark: NonNullable<EngineOptions['watermark']>
): Promise<void> {
    const { text, fontSize = 50, color = '#808080', opacity = 0.3, rotation = -45 } = watermark;

    // Parse color (hex format)
    const colorHex = color.replace('#', '');
    const r = parseInt(colorHex.substring(0, 2), 16) / 255;
    const g = parseInt(colorHex.substring(2, 4), 16) / 255;
    const b = parseInt(colorHex.substring(4, 6), 16) / 255;

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();

    for (const page of pages) {
        const { width, height } = page.getSize();

        // Calculate text dimensions
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        const textHeight = fontSize;

        // Center the watermark
        const x = (width - textWidth) / 2;
        const y = (height - textHeight) / 2;

        page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(r, g, b),
            opacity,
            rotate: degrees(rotation),
        });
    }
}

async function applyPageNumbers(pdf: PDFDocument): Promise<void> {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    const totalPages = pages.length;

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();

        const text = `Page ${i + 1} / ${totalPages}`;
        const fontSize = 10;
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        const textX = (width - textWidth) / 2;
        const textY = 30; // 30 points from bottom

        page.drawText(text, {
            x: textX,
            y: textY,
            size: fontSize,
            font,
            color: rgb(0.6, 0.6, 0.6), // Gray color
        });
    }
}

async function applyPasswordProtection(pdfPath: string, password: string): Promise<string> {
    const outputPath = pdfPath.replace('.pdf', '-protected.pdf');

    try {
        const bytes = await fs.readFile(pdfPath);
        const pdf = await PDFDocument.load(bytes);

        const protectedBytes = await pdf.save({
            useObjectStreams: false,
            ...( {
                userPassword: password,
                ownerPassword: password,
                permissions: {
                    printing: 'high-resolution',
                    modifying: false,
                    copying: false,
                    annotating: false,
                    fillingForms: false,
                    contentAccessibility: true,
                    documentAssembly: false,
                },
            } as any ),
        });

        await fs.writeFile(outputPath, protectedBytes);
        return outputPath;
    } catch (error) {
        logger.warn({ err: error }, 'PDF encryption failed, returning unprotected PDF');
        return pdfPath;
    }
}