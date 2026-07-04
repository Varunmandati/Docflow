import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { env } from '../config/env.js';
import { ImageFormat } from '../models/types.js';
import { executeCommand } from './command.service.js';

const pageFileSort = (a: string, b: string) => {
    const am = a.match(/(\d+)/);
    const bm = b.match(/(\d+)/);
    const av = am ? Number(am[1]) : 0;
    const bv = bm ? Number(bm[1]) : 0;
    return av - bv;
};

export async function getPdfPageCount(pdfPath: string): Promise<number> {
    const bytes = await fs.readFile(pdfPath);
    const pdf = await PDFDocument.load(bytes);
    return pdf.getPageCount();
}

export async function splitPdfByPage(pdfPath: string, outputDir: string): Promise<string[]> {
    await fs.mkdir(outputDir, { recursive: true });

    const sourceBytes = await fs.readFile(pdfPath);
    const sourcePdf = await PDFDocument.load(sourceBytes);
    const pageCount = sourcePdf.getPageCount();
    const outputs: string[] = [];

    for (let index = 0; index < pageCount; index += 1) {
        const single = await PDFDocument.create();
        const [page] = await single.copyPages(sourcePdf, [index]);
        single.addPage(page);

        const bytes = await single.save();
        const targetPath = path.join(outputDir, `page-${String(index + 1).padStart(4, '0')}.pdf`);
        await fs.writeFile(targetPath, bytes);
        outputs.push(targetPath);
    }

    return outputs;
}

export async function convertPdfToImages(
    pdfPath: string,
    outputDir: string,
    format: ImageFormat,
    dpi: number
): Promise<string[]> {
    await fs.mkdir(outputDir, { recursive: true });

    const outputPrefix = path.join(outputDir, 'page');
    const args = [
        '-r',
        String(dpi),
        format === 'png' ? '-png' : '-jpeg',
        pdfPath,
        outputPrefix,
    ];

    const result = await executeCommand(env.PDFTOPPM_BINARY, args, env.CONVERSION_TIMEOUT_MS);
    if (result.code !== 0) {
        throw new Error(`PDF to image conversion failed: ${result.stderr || result.stdout}`);
    }

    const extension = format === 'png' ? '.png' : '.jpg';
    const files = (await fs.readdir(outputDir))
        .filter((name) => name.startsWith('page-') && name.toLowerCase().endsWith(extension))
        .sort(pageFileSort)
        .map((name) => path.join(outputDir, name));

    if (files.length === 0) {
        throw new Error('PDF to image conversion produced no files. Ensure poppler-utils is installed.');
    }

    return files;
}
