import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { SandboxRunner } from '../../utils/sandboxRunner.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

/**
 * Build a single self-contained HTML document from an EPUB (a ZIP of XHTML
 * chapters). This LO build has no EPUB import filter, so we flatten the book
 * into one HTML file and let LibreOffice convert HTML -> PDF.
 */
async function epubToHtml(inputPath: string, outputDir: string): Promise<string> {
    const raw = await fs.readFile(inputPath);
    const zip = await JSZip.loadAsync(raw);

    // container.xml -> first rootfile -> the OPF package document.
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) {
        throw new Error('EPUB has no META-INF/container.xml.');
    }
    const container = new XMLParser({ ignoreAttributes: false }).parse(containerXml);
    const rootfile = container?.container?.rootfiles?.rootfile;
    const opfPath = Array.isArray(rootfile)
        ? rootfile[0]?.['@_full-path']
        : rootfile?.['@_full-path'];
    if (!opfPath) {
        throw new Error('EPUB container.xml has no rootfile.');
    }

    const opfRaw = await zip.file(opfPath)?.async('string');
    if (!opfRaw) {
        throw new Error(`EPUB package file not found: ${opfPath}`);
    }
    const opf = new XMLParser({ ignoreAttributes: false }).parse(opfRaw);
    const opfDir = path.posix.dirname(opfPath.replace(/\\/g, '/'));

    // manifest: id -> href
    const manifest = opf?.package?.manifest?.item ?? [];
    const manifestList = Array.isArray(manifest) ? manifest : [manifest];
    const idToHref = new Map<string, string>();
    for (const item of manifestList) {
        const id = item?.['@_id'];
        const href = item?.['@_href'];
        if (id && href) {
            idToHref.set(id, href);
        }
    }

    // spine: ordered list of content ids (resolve over the manifest)
    const spine = opf?.package?.spine?.itemref ?? [];
    const spineList = Array.isArray(spine) ? spine : [spine];
    const spineIds = spineList.map((item) => item?.['@_idref']).filter(Boolean);

    const chapters: string[] = [];
    for (const id of spineIds) {
        const href = idToHref.get(id);
        if (!href) continue;
        const resolved = path.posix.join(opfDir, href).replace(/^\/+/, '');
        const file = zip.file(resolved);
        if (!file) continue;
        let content = await file.async('string');
        const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        chapters.push(bodyMatch ? bodyMatch[1] : content);
    }

    if (chapters.length === 0) {
        throw new Error('EPUB spine contains no readable content.');
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${path.basename(inputPath, path.extname(inputPath))}</title>
</head>
<body>
${chapters.join('\n')}
</body>
</html>`;

    const htmlPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.html`);
    await fs.writeFile(htmlPath, html, 'utf8');
    return htmlPath;
}

/**
 * Reusable LibreOffice user-profile pool.
 *
 * A single shared profile makes concurrent `soffice --headless` invocations
 * collide on profile lock files and fail with exit code 1. Pointing each run
 * at a brand-new profile avoids that but costs ~15s of cold-start per job.
 * Instead we keep a small pool of profiles and round-robin them, so concurrent
 * workers each get a distinct profile while the profiles stay warm between runs.
 */
class LibreOfficeProfilePool {
    private slots: { dir: string; inUse: boolean }[];
    private waiters: ((slot: { dir: string; inUse: boolean }) => void)[] = [];

    constructor(size: number) {
        this.slots = Array.from({ length: Math.max(2, size) }, (_, i) => ({
            dir: path.join(os.tmpdir(), 'docflow-lo-profiles', `profile-${i}`),
            inUse: false,
        }));
    }

    getProfileDirs(): string[] {
        return this.slots.map((s) => s.dir);
    }

    private async release(slot: { dir: string; inUse: boolean }): Promise<void> {
        slot.inUse = false;
        const next = this.waiters.shift();
        if (next) {
            slot.inUse = true;
            next(slot);
        }
    }

    async acquire(): Promise<{ dir: string; release: () => void }> {
        const free = this.slots.find((s) => !s.inUse);
        if (free) {
            free.inUse = true;
            return {
                dir: free.dir,
                release: () => { void this.release(free); },
            };
        }
        return new Promise((resolve) => {
            this.waiters.push((slot) => {
                resolve({
                    dir: slot.dir,
                    release: () => { void this.release(slot); },
                });
            });
        });
    }
}

const profilePool = new LibreOfficeProfilePool(parseInt(String(process.env.WORKER_CONCURRENCY ?? '2'), 10) + 1);

export const libreOfficeProfilePool = profilePool;

/**
 * Warm every profile in the pool at worker startup. A brand-new LO user
 * profile costs ~15s of cold-start on its first invocation; by priming each
 * slot once (a trivial no-op convert) the very first real conversions skip
 * that delay. Runs best-effort in the background and never blocks boot.
 */
export async function prewarmLibreOfficeProfiles(): Promise<void> {
    const start = Date.now();
    const dirs = profilePool.getProfileDirs();
    // Create a trivial source so the profile initializes fully even when no
    // PREWARM_LO_SOURCE override is provided.
    const sourceDir = path.join(os.tmpdir(), 'docflow-lo-profiles');
    const sourcePath = process.env.PREWARM_LO_SOURCE || path.join(sourceDir, 'prewarm.txt');
    try {
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.writeFile(sourcePath, 'DocFlow LO prewarm', 'utf8');
    } catch {
        // best effort
    }
    const warm: Promise<void>[] = dirs.map(async (dir) => {
        try {
            const args = [
                '--headless',
                '--invisible',
                '--nologo',
                '--nodefault',
                '--nofirststartwizard',
                `-env:UserInstallation=${toFileUri(dir)}`,
                '--terminate_after_init',
                '--convert-to',
                'pdf',
                '--outdir',
                sourceDir,
                sourcePath,
            ];
            await SandboxRunner.execute(env.SOFFICE_BINARY, args, {
                timeoutMs: 60000,
            });
        } catch {
            // First run may still be initializing; next real conversion will
            // finish the profile setup. Not fatal.
        }
    });
    await Promise.allSettled(warm);
    logger.info(`LibreOffice profiles pre-warmed in ${Date.now() - start}ms`);
}

const toFileUri = (p: string): string => {
    const joined = p
        .replace(/\\/g, '/')
        .split('/')
        .map(encodeURIComponent)
        .join('/')
        .replace(/^C%3A/, 'C:');
    return `file:///${joined}`;
};

export const libreOfficeToFileUri = toFileUri;

export class LibreOfficeEngine implements ConverterEngine {
    name = 'LibreOffice';

    // Formats supported by LibreOffice for converting to PDF
    private supportedSources = new Set([
        'doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'md', 'epub',
        'xls', 'xlsx', 'ods', 'csv', 'tsv',
        'ppt', 'pptx', 'odp',
        'png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff', 'webp', 'svg'
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

        // This LO build ships no EPUB import filter, so flatten the book into
        // a single HTML document and convert that instead.
        let loInput = inputPath;
        if (sourceFormat === 'epub') {
            loInput = await epubToHtml(inputPath, outputDir);
        }

        // Isolated per-run user profile: concurrent soffice --headless invocations
        // collide on the shared profile (lock files) and fail with exit code 1.
        const profile = await profilePool.acquire();

        // Execute LibreOffice headless
        // e.g. soffice --headless --convert-to pdf --outdir /output /input/file.docx
        const args = [
            '--headless',
            '--invisible',
            '--nologo',
            '--nodefault',
            '--nofirststartwizard',
            `-env:UserInstallation=${toFileUri(profile.dir)}`,
            '--convert-to',
            'pdf',
            '--outdir',
            outputDir,
            loInput
        ];

        try {
            // Ensure we're using a sandboxed execution
            await SandboxRunner.execute(env.SOFFICE_BINARY, args, {
                timeoutMs: env.CONVERSION_TIMEOUT_MS, // 3 minutes max for LibreOffice
            });

            // Verify output exists and get its size
            try {
                const stats = await fs.stat(expectedOutputPath);

                if (loInput !== inputPath) {
                    // Remove the intermediate flattened HTML for EPUB inputs.
                    await fs.rm(loInput, { force: true }).catch(() => {});
                }

                return {
                    outputPath: expectedOutputPath,
                    sizeBytes: stats.size,
                    durationMs: Date.now() - startTime
                };
            } catch (error) {
                throw new Error(`Conversion completed but output file was not found at ${expectedOutputPath}`);
            }
        } finally {
            profile.release();
        }
    }
}