import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { env } from '../config/env.js';

/**
 * Combines multiple image files into a single PDF in the specified order
 * @param imagePaths - Array of absolute paths to image files in order
 * @param outputPath - Path where the PDF should be saved
 * @param pageSize - Page size (default: A4)
 * @returns Promise<void>
 */
export async function combineImagesToSinglePdf(
    imagePaths: string[],
    outputPath: string,
    pageSize: { width: number; height: number } = { width: 595, height: 842 } // A4 in points
): Promise<void> {
    if (!imagePaths || imagePaths.length === 0) {
        throw new Error('No images provided for PDF creation');
    }

    // Validate all files exist
    for (const imagePath of imagePaths) {
        try {
            await fs.access(imagePath);
        } catch {
            throw new Error(`Image file not found: ${imagePath}`);
        }
    }

    // Create PDF document
    const pdfDoc = await PDFDocument.create();

    // Process each image in order
    for (let i = 0; i < imagePaths.length; i++) {
        const imagePath = imagePaths[i];
        const ext = path.extname(imagePath).toLowerCase();

        // Read and embed image
        let imageData: Buffer;
        let imageEmbedResult: any;

        try {
            imageData = await fs.readFile(imagePath);

            // Use sharp to normalize and optimize image
            const metadata = await sharp(imageData).metadata();
            const normalizedImage = await sharp(imageData)
                .rotate() // Auto-rotate based on EXIF
                .toBuffer();

            // Embed image in PDF based on type
            if (ext === '.png') {
                imageEmbedResult = await pdfDoc.embedPng(normalizedImage);
            } else if (ext === '.jpg' || ext === '.jpeg') {
                imageEmbedResult = await pdfDoc.embedJpg(normalizedImage);
            } else {
                throw new Error(`Unsupported image format: ${ext}`);
            }

            // Calculate dimensions to fit page while maintaining aspect ratio
            const { width: imgWidth, height: imgHeight } = imageEmbedResult;
            const pageWidth = pageSize.width;
            const pageHeight = pageSize.height;

            // Calculate scale to fit image on page
            const scaleX = pageWidth / imgWidth;
            const scaleY = pageHeight / imgHeight;
            const scale = Math.min(scaleX, scaleY, 1); // Don't upscale

            const finalWidth = imgWidth * scale;
            const finalHeight = imgHeight * scale;

            // Center image on page
            const x = (pageWidth - finalWidth) / 2;
            const y = (pageHeight - finalHeight) / 2;

            // Add page and embed image
            const page = pdfDoc.addPage([pageSize.width, pageSize.height]);
            page.drawImage(imageEmbedResult, {
                x,
                y,
                width: finalWidth,
                height: finalHeight,
            });
        } catch (error) {
            throw new Error(`Failed to process image ${i + 1} (${imagePath}): ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Save PDF
    const pdfBytes = await pdfDoc.save();
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, pdfBytes);
}

/**
 * Gets image metadata including dimensions
 */
export async function getImageMetadata(
    imagePath: string
): Promise<{ width: number; height: number; format: string }> {
    const imageData = await fs.readFile(imagePath);
    const metadata = await sharp(imageData).metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error(`Could not determine image dimensions for ${imagePath}`);
    }

    return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format || 'unknown',
    };
}

/**
 * Validates if a file is a supported image format
 */
export function isSupportedImageFormat(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.jpg', '.jpeg', '.png'].includes(ext);
}
