import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { executeCommand } from './command.service.js';

const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

export async function convertOfficeToPdf(inputPath: string, outputDir: string): Promise<string> {
    await fs.mkdir(outputDir, { recursive: true });

    const args = [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nofirststartwizard',
        '--invisible',
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        outputDir,
        inputPath,
    ];

    const result = await executeCommand(env.SOFFICE_BINARY, args, env.CONVERSION_TIMEOUT_MS);

    if (result.code !== 0) {
        throw new Error(`LibreOffice conversion failed: ${result.stderr || result.stdout}`);
    }

    const expectedName = `${path.basename(inputPath, path.extname(inputPath))}.pdf`;
    const expectedPath = path.join(outputDir, expectedName);

    if (await fileExists(expectedPath)) {
        return expectedPath;
    }

    const pdfCandidates = (await fs.readdir(outputDir))
        .filter((name) => name.toLowerCase().endsWith('.pdf'))
        .map((name) => path.join(outputDir, name));

    if (pdfCandidates.length === 0) {
        throw new Error('LibreOffice completed but PDF output was not found.');
    }

    return pdfCandidates[0];
}
