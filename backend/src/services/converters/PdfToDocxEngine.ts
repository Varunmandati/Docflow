import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import crypto from 'crypto';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';
import { executeCommand } from '../command.service.js';
import { fixDocxAnchorOrigins } from '../docx-postprocess.service.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

// ────────────────────────────────────────────────────────────────────────────
// Limits (this pair only — never touches global worker concurrency)
// ────────────────────────────────────────────────────────────────────────────
const PDF_DOCX_MAX_PAGES  = parseInt(process.env.PDF_DOCX_MAX_PAGES  ?? '500', 10);
const PDF_DOCX_MAX_BYTES  = parseInt(process.env.PDF_DOCX_MAX_BYTES  ?? String(200 * 1024 * 1024), 10); // 200 MB
const PDF_DOCX_TIMEOUT_MS = parseInt(process.env.PDF_DOCX_TIMEOUT_MS ?? '600000', 10); // 10 min

// Paths to external tools — all overridable by env
const PYTHON_BIN   = process.env.PDF_DOCX_PYTHON   ?? 'python3';
const OCRMYPDF_BIN = process.env.PDF_DOCX_OCRMYPDF ?? 'ocrmypdf';

/**
 * toFileUri — reused from LibreOfficeEngine (not imported to avoid coupling).
 * Converts an OS path to a file:/// URI that soffice accepts.
 */
function toFileUri(p: string): string {
    const joined = p
        .replace(/\\/g, '/')
        .split('/')
        .map(encodeURIComponent)
        .join('/')
        .replace(/^C%3A/, 'C:');
    return `file:///${joined}`;
}

/**
 * Child environment for the pdf2docx interpreter.
 *
 * SandboxRunner strips the environment down to PATH + HOME, which on Windows
 * hides APPDATA — so Python can't find its user site-packages (where
 * `pip install --user pdf2docx` lands) and has no temp directory. Re-adding the
 * non-secret path variables makes `import pdf2docx` work inside the sandbox
 * without leaking credentials; on Linux these keys are absent and the env stays
 * exactly as SandboxRunner builds it today.
 */
function pythonChildEnv(): Record<string, string> {
    const childEnv: Record<string, string> = {};
    if (process.env.PATH) childEnv['PATH'] = process.env.PATH;
    childEnv['HOME'] = process.env.HOME || '/tmp';
    for (const key of ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
        const value = process.env[key];
        if (value) childEnv[key] = value;
    }
    return childEnv;
}

/**
 * PdfToDocxEngine — primary PDF → DOCX conversion engine (Phase 1).
 *
 * Strategy:
 *  1. Detect scanned vs text PDF (via pdftotext, read-only reuse of existing logic).
 *  2. Scanned → run ocrmypdf --skip-text --deskew first to embed a text layer.
 *  3. Primary converter: pdf2docx (Python subprocess inside venv).
 *  4. Fallback: LibreOffice with --infilter="writer_pdf_import" (Writer mode).
 *  5. Fidelity check: compare page count + extracted-text similarity; log the score.
 *
 * Registered ONLY for the pdf → docx pair, behind PDF_DOCX_ENGINE=legacy|auto.
 * When set to "legacy", the old PdfToDocxLayoutEngine is used unchanged.
 */
export class PdfToDocxEngine implements ConverterEngine {
    name = 'PdfToDocx';

    /** Cached result of resolvePythonBin() — probing per job would be wasted work. */
    private resolvedPythonBin: string | null = null;

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
            throw new Error(`PdfToDocxEngine: unsupported pair ${sourceFormat} → ${targetFormat}`);
        }

        const startTime = Date.now();
        const baseName  = path.basename(inputPath, path.extname(inputPath));
        const expectedOutput = path.join(outputDir, `${baseName}.docx`);

        // Per-job temp directory — cleaned up in `finally`
        const tmpDir = path.join(os.tmpdir(), `docflow-pd2dx-${crypto.randomBytes(6).toString('hex')}`);

        try {
            await fs.mkdir(tmpDir, { recursive: true });

            // ─── 0. Input validation ──────────────────────────────────────
            const inputStat = await fs.stat(inputPath);
            if (inputStat.size > PDF_DOCX_MAX_BYTES) {
                throw new Error(
                    `PDF exceeds maximum size for DOCX conversion (${(inputStat.size / 1024 / 1024).toFixed(1)} MB > ${(PDF_DOCX_MAX_BYTES / 1024 / 1024).toFixed(0)} MB limit)`
                );
            }

            // Quick page-count check via pdfinfo (poppler-utils)
            const inputPages = await this.countPages(inputPath);
            if (inputPages > PDF_DOCX_MAX_PAGES) {
                throw new Error(
                    `PDF has ${inputPages} pages, exceeding the ${PDF_DOCX_MAX_PAGES}-page limit for DOCX conversion`
                );
            }

            // ─── 1. Scanned-PDF detection (read-only reuse of pdftotext) ──
            const pdfType = await this.detectPdfType(inputPath);
            let workingPdf = inputPath;

            const ocrEnabled = (process.env.PDF_DOCX_OCR ?? env.PDF_DOCX_OCR ?? 'on').toLowerCase() !== 'off';

            if (pdfType === 'scanned') {
                if (ocrEnabled) {
                    logger.info({ inputPath }, 'PdfToDocxEngine: scanned PDF detected — running ocrmypdf');
                    workingPdf = await this.runOcr(inputPath, tmpDir);
                } else {
                    logger.info({ inputPath }, 'PdfToDocxEngine: scanned PDF detected but OCR is disabled (PDF_DOCX_OCR=off)');
                }
            }

            // ─── 2. Primary: pdf2docx ─────────────────────────────────────
            let usedStrategy = 'pdf2docx';
            let succeeded    = false;

            try {
                await this.runPdf2docx(workingPdf, expectedOutput);
                const stats = await fs.stat(expectedOutput).catch(() => null);
                if (stats && stats.size > 0) {
                    succeeded = true;
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn({ inputPath, err: msg }, 'PdfToDocxEngine: pdf2docx failed — trying LibreOffice fallback');
            }

            // ─── 3. Fallback: LibreOffice writer_pdf_import ───────────────
            if (!succeeded) {
                usedStrategy = 'libreoffice-writer';
                // Remove any partial output from the failed primary attempt
                await fs.rm(expectedOutput, { force: true }).catch(() => {});
                await this.runLibreOfficeFallback(workingPdf, outputDir, tmpDir);

                const stats = await fs.stat(expectedOutput).catch(() => null);
                if (!stats || stats.size === 0) {
                    if (pdfType === 'scanned' && !ocrEnabled) {
                        throw new Error('Both pdf2docx and LibreOffice fallback produced no output: scanned PDF has no text layer and OCR is disabled (PDF_DOCX_OCR=off)');
                    }
                    throw new Error('Both pdf2docx and LibreOffice fallback produced no output');
                }

                // LibreOffice labels page-relative shape offsets as column- and
                // paragraph-relative, which shifts every page by the section
                // margin (~1 cm on the left/top). Fix the anchors, but never
                // fail a conversion that already produced a file.
                try {
                    await fixDocxAnchorOrigins(expectedOutput);
                } catch (err) {
                    logger.warn({ err, expectedOutput }, 'PdfToDocxEngine: DOCX anchor position fix skipped');
                }
            }

            // ─── 4. Fidelity check (non-blocking — log only) ──────────────
            try {
                await this.fidelityCheck(inputPath, expectedOutput, inputPages);
            } catch (err) {
                // Never fail the job because of the fidelity check
                logger.warn({ err }, 'PdfToDocxEngine: fidelity check skipped');
            }

            const outputStat = await fs.stat(expectedOutput);
            const duration   = Date.now() - startTime;

            logger.info({
                inputPath,
                strategy: usedStrategy,
                pdfType,
                durationMs: duration,
                pages: inputPages,
                outputBytes: outputStat.size,
            }, 'PdfToDocxEngine: conversion complete');

            return {
                outputPath: expectedOutput,
                sizeBytes: outputStat.size,
                pages: inputPages > 0 ? inputPages : undefined,
                durationMs: duration,
            };
        } finally {
            // Clean up per-job temp directory
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    /** Count PDF pages via pdfinfo (poppler-utils). */
    private async countPages(pdfPath: string): Promise<number> {
        try {
            const result = await executeCommand(
                'pdfinfo', [pdfPath],
                Math.min(env.CONVERSION_TIMEOUT_MS, 30000),
            );
            const match = result.stdout.match(/Pages:\s+(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        } catch {
            return 0; // Don't block conversion on a missing pdfinfo binary
        }
    }

    /**
     * Lightweight scanned-vs-text detection.
     * Mirrors the logic in compression-analyzer.service.ts (read-only reuse).
     */
    private async detectPdfType(pdfPath: string): Promise<'scanned' | 'text' | 'mixed'> {
        try {
            const result = await executeCommand(
                env.PDFTOTEXT_BINARY,
                ['-q', '-f', '1', '-l', '5', pdfPath, '-'],
                Math.min(env.CONVERSION_TIMEOUT_MS, 60000),
            );
            const text = `${result.stdout || ''}`.trim();
            if (text.length < 40) return 'scanned';
            const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
            const ratio = alphaCount / Math.max(text.length, 1);
            return ratio > 0.45 ? 'text' : 'mixed';
        } catch {
            return 'mixed';
        }
    }

    /** Run ocrmypdf to add a text layer to a scanned PDF. */
    private async runOcr(inputPath: string, tmpDir: string): Promise<string> {
        const ocrOutput = path.join(tmpDir, 'ocr-output.pdf');
        await SandboxRunner.execute(OCRMYPDF_BIN, [
            '--skip-text',
            '--deskew',
            '--jobs', '2',
            inputPath,
            ocrOutput,
        ], {
            timeoutMs: PDF_DOCX_TIMEOUT_MS,
            maxBuffer: 50 * 1024 * 1024,
        });
        // Verify the OCR output exists; fall back to original if it doesn't
        const stats = await fs.stat(ocrOutput).catch(() => null);
        if (!stats || stats.size === 0) {
            logger.warn({ inputPath }, 'PdfToDocxEngine: ocrmypdf produced no output — using original PDF');
            return inputPath;
        }
        return ocrOutput;
    }

    /** Run the pdf2docx Python script as a subprocess. */
    private async runPdf2docx(inputPath: string, outputPath: string): Promise<void> {
        const candidates = [
            path.resolve(process.cwd(), 'scripts', 'pdf_to_docx_v2.py'),
            path.resolve(process.cwd(), 'backend', 'scripts', 'pdf_to_docx_v2.py'),
            path.resolve(__dirname, '../../scripts/pdf_to_docx_v2.py'),
        ];
        let scriptPath: string | null = null;
        for (const candidate of candidates) {
            try {
                await fs.access(candidate);
                scriptPath = candidate;
                break;
            } catch {
                // continue to next candidate
            }
        }

        if (!scriptPath) {
            throw new Error(`pdf2docx converter script not found in [${candidates.join(', ')}]`);
        }

        const pythonBin = await this.resolvePythonBin();

        await SandboxRunner.execute(pythonBin, [
            scriptPath,
            inputPath,
            outputPath,
        ], {
            timeoutMs: PDF_DOCX_TIMEOUT_MS,
            maxBuffer: 50 * 1024 * 1024,
            env: pythonChildEnv(),
        });
    }

    /**
     * Pick an interpreter that can actually import pdf2docx.
     *
     * Probes `PDF_DOCX_PYTHON`, then `python3`, then `python` — on Windows the
     * only interpreter on PATH is often a plain `python`, while Linux images set
     * `PDF_DOCX_PYTHON=/opt/pdf2docx-venv/bin/python3`. The first interpreter
     * that imports the library wins and is cached for the worker's lifetime; if
     * none can, the configured/default binary is still returned so the
     * conversion attempt runs and falls back to LibreOffice exactly as before.
     */
    private async resolvePythonBin(): Promise<string> {
        if (this.resolvedPythonBin) return this.resolvedPythonBin;

        const configured = process.env.PDF_DOCX_PYTHON;
        const candidates = [...new Set(
            [configured, 'python3', 'python'].filter((c): c is string => Boolean(c))
        )];

        for (const bin of candidates) {
            try {
                const probe = await executeCommand(
                    bin,
                    ['-c', 'import pdf2docx; print("PDF2DOCX_OK")'],
                    30000,
                );
                if (probe.code === 0 && (probe.stdout || '').includes('PDF2DOCX_OK')) {
                    this.resolvedPythonBin = bin;
                    if (bin !== PYTHON_BIN) {
                        logger.info({ pythonBin: bin }, 'PdfToDocxEngine: interpreter with pdf2docx found');
                    }
                    return bin;
                }
            } catch {
                // Probe timed out or was killed — try the next candidate.
            }
        }

        this.resolvedPythonBin = PYTHON_BIN;
        return this.resolvedPythonBin;
    }

    /**
     * LibreOffice fallback: force Writer mode via --infilter="writer_pdf_import".
     * Uses a unique -env:UserInstallation profile per job to avoid lock collisions.
     */
    private async runLibreOfficeFallback(inputPath: string, outputDir: string, tmpDir: string): Promise<void> {
        const profileDir = path.join(tmpDir, 'lo-profile');
        await fs.mkdir(profileDir, { recursive: true });

        const args = [
            '--headless',
            '--invisible',
            '--nologo',
            '--nodefault',
            '--nofirststartwizard',
            `--infilter=writer_pdf_import`,
            `-env:UserInstallation=${toFileUri(profileDir)}`,
            '--convert-to', 'docx',
            '--outdir', outputDir,
            inputPath,
        ];

        await SandboxRunner.execute(env.SOFFICE_BINARY, args, {
            timeoutMs: PDF_DOCX_TIMEOUT_MS,
        });
    }

    /**
     * Non-blocking fidelity check: compare page count and extracted-text
     * similarity between the input PDF and the produced DOCX.
     * Logs the score — never fails the job.
     */
    private async fidelityCheck(
        inputPdf: string,
        outputDocx: string,
        inputPages: number,
    ): Promise<void> {
        // Extract text from original PDF (first 20 pages max)
        const pdfTextResult = await executeCommand(
            env.PDFTOTEXT_BINARY,
            ['-q', '-f', '1', '-l', '20', inputPdf, '-'],
            30000,
        );
        const pdfText = (pdfTextResult.stdout || '').trim();

        if (pdfText.length < 20) {
            logger.info({ inputPdf, score: 'n/a', reason: 'too-little-text' },
                'PdfToDocxEngine fidelity: insufficient text to compare');
            return;
        }

        // Extract text from DOCX by reading the word/document.xml inside the ZIP.
        // We don't import python-docx here; just pull raw text from the XML.
        let docxText = '';
        try {
            const result = await executeCommand(
                await this.resolvePythonBin(),
                ['-c', `
import zipfile, sys, re
with zipfile.ZipFile(sys.argv[1]) as z:
    with z.open('word/document.xml') as f:
        xml = f.read().decode('utf-8', errors='replace')
        texts = re.findall(r'<w:t[^>]*>([^<]+)</w:t>', xml)
        print(' '.join(texts))
`, outputDocx],
                30000,
            );
            docxText = (result.stdout || '').trim();
        } catch {
            logger.info({ inputPdf }, 'PdfToDocxEngine fidelity: could not extract DOCX text');
            return;
        }

        // Simple word-overlap similarity (Jaccard on word sets)
        const pdfWords  = new Set(pdfText.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const docxWords = new Set(docxText.toLowerCase().split(/\s+/).filter(w => w.length > 2));

        if (pdfWords.size === 0) {
            logger.info({ inputPdf, score: 'n/a' }, 'PdfToDocxEngine fidelity: no words in PDF');
            return;
        }

        let intersection = 0;
        for (const w of pdfWords) {
            if (docxWords.has(w)) intersection++;
        }
        const union = new Set([...pdfWords, ...docxWords]).size;
        const similarity = union > 0 ? intersection / union : 0;

        logger.info({
            inputPdf,
            pdfWordCount: pdfWords.size,
            docxWordCount: docxWords.size,
            similarity: Math.round(similarity * 100),
            inputPages,
        }, `PdfToDocxEngine fidelity: ${Math.round(similarity * 100)}% word overlap`);
    }
}
