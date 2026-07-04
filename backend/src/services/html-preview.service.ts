import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { executeCommand } from './command.service.js';

export interface HtmlPreviewResult {
    htmlPath: string;
    mode: 'pdf2htmlex' | 'fallback';
}

export async function generateHtmlPreviewFromPdf(
    pdfPath: string,
    outputDir: string,
    pdfDownloadUrl: string
): Promise<HtmlPreviewResult> {
    await fs.mkdir(outputDir, { recursive: true });

    const htmlOutputName = 'preview.html';
    const htmlOutputPath = path.join(outputDir, htmlOutputName);

    try {
        const args = [
            '--embed',
            'cfijo',
            '--dest-dir',
            outputDir,
            '--split-pages',
            '0',
            pdfPath,
            htmlOutputName,
        ];

        const result = await executeCommand(env.PDF2HTMLEX_BINARY, args, env.CONVERSION_TIMEOUT_MS);
        if (result.code === 0) {
            await fs.access(htmlOutputPath);
            return {
                htmlPath: htmlOutputPath,
                mode: 'pdf2htmlex',
            };
        }
    } catch {
        // Fallback path below.
    }

    const fallbackHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PDF Preview</title>
  <style>
    html, body { margin: 0; height: 100%; background: #111; }
    iframe { border: 0; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <iframe src="${pdfDownloadUrl}" title="PDF Preview"></iframe>
</body>
</html>`;

    await fs.writeFile(htmlOutputPath, fallbackHtml, 'utf-8');

    return {
        htmlPath: htmlOutputPath,
        mode: 'fallback',
    };
}
