import path from 'path';
import fs from 'fs/promises';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';

export class LibreOfficeEngine implements ConverterEngine {
    name = 'LibreOffice';

    // Formats supported by LibreOffice for converting to PDF
    private supportedSources = new Set([
        'doc', 'docx', 'odt', 'rtf', 'txt', 'html',
        'xls', 'xlsx', 'ods', 'csv', 'tsv',
        'ppt', 'pptx', 'odp'
    ]);

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        return this.supportedSources.has(sourceFormat) && targetFormat === 'pdf';
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        options?: EngineOptions
    ): Promise<EngineConversionResult> {
        if (targetFormat !== 'pdf') {
            throw new Error(`LibreOfficeEngine only supports PDF output, requested: ${targetFormat}`);
        }

        const startTime = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const expectedOutputPath = path.join(outputDir, `${baseName}.pdf`);

        // Execute LibreOffice headless
        // e.g. soffice --headless --convert-to pdf --outdir /output /input/file.docx
        const args = [
            '--headless',
            '--invisible',
            '--nologo',
            '--nodefault',
            '--nofirststartwizard',
            '--convert-to',
            'pdf',
            '--outdir',
            outputDir,
            inputPath
        ];

        // Ensure we're using a sandboxed execution
        await SandboxRunner.execute('soffice', args, {
            timeoutMs: 120000, // 2 minutes max for LibreOffice
        });

        // Verify output exists and get its size
        try {
            const stats = await fs.stat(expectedOutputPath);
            
            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } catch (error) {
            throw new Error(`Conversion completed but output file was not found at ${expectedOutputPath}`);
        }
    }
}
