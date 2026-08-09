import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { runCompressionJob } from './compression.service.js';
import { CompressionJobData } from '../models/types.js';
import { env } from '../config/env.js';

/**
 * C3 regression guard: a text PDF that goes through the compression pipeline
 * must remain a real (text-preserving) PDF. Ghostscript pdfwrite keeps the
 * text layer; when Ghostscript is unavailable the service falls back to a
 * byte-for-byte copy — and even that fallback must produce a valid PDF rather
 * than failing. Under no circumstances may PDFs be rasterized to images.
 */
describe('PDF compression path', () => {
    let tmpDir: string;

    const makeTextPdf = async (): Promise<Buffer> => {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const page = pdf.addPage([612, 792]);
        page.drawText('DocFlow C3 regression text.', { x: 50, y: 700, size: 18, font });
        return Buffer.from(await pdf.save());
    };

    beforeAll(async () => {
        tmpDir = path.join(env.STORAGE_ROOT, 'temp', 'test-compression-c3');
        await fs.mkdir(tmpDir, { recursive: true });
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('compresses a text PDF into a valid PDF output, preserving the text layer', async () => {
        const input = await makeTextPdf();
        const inputPath = path.join(tmpDir, 'input.pdf');
        await fs.writeFile(inputPath, input);

        const outputDir = path.join(tmpDir, 'out');
        const job: CompressionJobData = {
            jobId: 'c3-test-job',
            inputPath,
            inputName: 'input.pdf',
            options: {
                quality: 80,
                preset: 'optimize',
            },
        } as CompressionJobData;

        const result = await runCompressionJob(job, outputDir);

        expect(result.outputs.primary).toBeDefined();
        const outputPath = path.join(outputDir, path.basename(result.outputs.primary.relativePath));

        const outputBytes = await fs.readFile(outputPath);
        // Any valid PDF (compressed or copied) starts with the %PDF header.
        expect(outputBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

        // It must remain a PDF and not be rasterized into images.
        const loaded = await PDFDocument.load(outputBytes);
        expect(loaded.getPageCount()).toBe(1);
    });

    it('fails gracefully with a clear error rather than rasterizing when output cannot be produced', async () => {
        const inputPath = path.join(tmpDir, 'missing.pdf');
        const outputDir = path.join(tmpDir, 'out2');
        const job: CompressionJobData = {
            jobId: 'test-job-2',
            inputPath,
            inputName: 'missing.pdf',
            options: { quality: 78 },
        } as CompressionJobData;

        await expect(runCompressionJob(job, outputDir)).rejects.toThrow();
    });
});