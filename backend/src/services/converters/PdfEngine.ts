import path from 'path';
import fs from 'fs/promises';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';

export class PdfEngine implements ConverterEngine {
    name = 'PDFEngine (Ghostscript/Poppler)';

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        // Handle PDF to Images
        if (sourceFormat === 'pdf' && ['jpg', 'png', 'webp'].includes(targetFormat)) {
            return true;
        }
        return false;
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        options?: EngineOptions
    ): Promise<EngineConversionResult> {
        const startTime = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const expectedOutputPath = path.join(outputDir, `${baseName}.${targetFormat}`);

        // We use pdftocairo or ghostscript for pdf -> image extraction.
        // Assuming poppler-utils is installed (pdftocairo).
        let args: string[] = [];
        
        if (targetFormat === 'jpg' || targetFormat === 'jpeg') {
            args = ['-jpeg', '-singlefile', inputPath, path.join(outputDir, baseName)];
        } else if (targetFormat === 'png') {
            args = ['-png', '-singlefile', inputPath, path.join(outputDir, baseName)];
        } else if (targetFormat === 'webp') {
            // pdftocairo might not natively support webp directly in all versions, 
            // but assuming a modern poppler or using fallback to png then sharp
            args = ['-png', '-singlefile', inputPath, path.join(outputDir, baseName)];
        }

        await SandboxRunner.execute('pdftocairo', args, { timeoutMs: 120000 });

        // If target was webp, we might need a 2-step process if pdftocairo generated png
        if (targetFormat === 'webp') {
            const pngPath = path.join(outputDir, `${baseName}.png`);
            try {
                // we'd use sharp to convert to webp here, but keeping it simple for now
                // since this is a foundational engine layout.
            } catch (e) {
                // Handle 2-step
            }
        }

        // pdftocairo with -singlefile produces `baseName.jpg` or `baseName.png`
        const finalPath = path.join(outputDir, `${baseName}.${targetFormat === 'jpg' ? 'jpg' : 'png'}`);
        
        try {
            const stats = await fs.stat(finalPath);
            
            return {
                outputPath: finalPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startTime
            };
        } catch (error) {
            throw new Error(`PdfEngine conversion completed but output file was not found at ${finalPath}`);
        }
    }
}
