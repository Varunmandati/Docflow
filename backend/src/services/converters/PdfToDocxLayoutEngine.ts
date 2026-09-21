import path from 'path';
import fs from 'fs/promises';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';
import { env } from '../../config/env.js';

/**
 * Layout-aware PDF → DOCX converter using PyMuPDF + python-docx.
 * Preserves columns, fonts, images, spacing, and page structure.
 */
export class PdfToDocxLayoutEngine implements ConverterEngine {
    name = 'PdfToDocxLayout';

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        return sourceFormat === 'pdf' && targetFormat === 'docx';
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        options?: EngineOptions
    ): Promise<EngineConversionResult> {
        if (sourceFormat !== 'pdf' || targetFormat !== 'docx') {
            throw new Error(`PdfToDocxLayoutEngine: unsupported conversion ${sourceFormat} -> ${targetFormat}`);
        }

        const startTime = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const expectedOutputPath = path.join(outputDir, `${baseName}.docx`);

        // Path to the Python script
        const scriptPath = path.resolve(process.cwd(), 'scripts', 'pdf_to_docx_layout_aware.py');

        // Verify script exists
        try {
            await fs.access(scriptPath);
        } catch {
            throw new Error(`Layout-aware converter script not found at ${scriptPath}`);
        }

        // Execute Python converter
        const args = [
            scriptPath,
            inputPath,
            expectedOutputPath
        ];

        try {
            await SandboxRunner.execute('python', args, {
                timeoutMs: Math.max(env.CONVERSION_TIMEOUT_MS, 300000), // 5 min minimum
                maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large DOCX outputs
            });

            // Verify output
            const stats = await fs.stat(expectedOutputPath);

            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Layout-aware PDF→DOCX conversion failed: ${message}`);
        }
    }
}