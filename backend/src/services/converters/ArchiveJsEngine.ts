import path from 'path';
import fs from 'fs/promises';
import JSZip from 'jszip';
import zlib from 'zlib';
import { ConverterEngine, EngineConversionResult, EngineOptions } from './ConverterEngine.js';
import { env } from '../../config/env.js';
import { ArchiveLimitError } from './ArchiveEngine.js';

/**
 * Pure-JS archive converter for the serverless shape.
 *
 * `zip` <-> `tar` <-> `tar.gz` are trivially convertible without any system
 * binary, and on a serverless runtime `ArchiveEngine` (7z/tar shells) can
 * never run. This engine handles every archive pair that does NOT involve
 * 7z; 7z pairs still route to the remote provider (see the processor's
 * LOCAL_SAFE selection and RemoteEngine).
 *
 * Extraction mirrors ArchiveEngine's safety contract: path-traversal entries
 * are refused, non-regular entries are refused, and file/byte caps are
 * enforced incrementally during extraction (the caps are a tripwire — the
 * archive is abandoned, not truncated).
 */
const ARCHIVE_FORMATS = new Set(['zip', 'tar', 'tar.gz']);

function isInsideRoot(candidate: string, root: string): boolean {
    const resolved = path.resolve(candidate);
    const normalizedRoot = path.resolve(root);
    return resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
}

function normalizeEntryName(name: string): string {
    let n = name.replace(/\\/g, '/');
    while (n.startsWith('./')) n = n.slice(2);
    return n;
}

function assertSafeEntryName(name: string): void {
    if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
        throw new ArchiveLimitError(`Archive entry "${name}" is an absolute path.`);
    }
    const segments = name.split('/');
    if (segments.includes('..')) {
        throw new ArchiveLimitError(`Archive entry "${name}" resolves outside the extraction directory.`);
    }
}

// --- tar reader -------------------------------------------------------------

interface TarEntry {
    name: string;
    type: 'file' | 'dir';
    data: Buffer | null;
}

function parseTar(buffer: Buffer): TarEntry[] {
    const entries: TarEntry[] = [];
    let offset = 0;
    let longName: string | null = null;
    let paxPath: string | null = null;

    const readOctal = (buf: Buffer, start: number, len: number): number => {
        const raw = buf.subarray(start, start + len).toString('latin1').replace(/\0/g, ' ').trim();
        if (!raw) return 0;
        return parseInt(raw, 8) || 0;
    };

    while (offset + 512 <= buffer.length) {
        const header = buffer.subarray(offset, offset + 512);
        // Two consecutive zero blocks terminate the archive.
        if (header.every((b) => b === 0)) break;

        const storedSum = header.subarray(148, 156).toString('latin1').replace(/\0/g, ' ').trim();
        const check = Buffer.from(header);
        check.fill(0x20, 148, 156);
        const computedSum = check.reduce((sum, b) => sum + b, 0);
        if (/^\d+$/.test(storedSum) && parseInt(storedSum, 8) !== computedSum) {
            throw new ArchiveLimitError('Archive is corrupt: invalid tar header checksum.');
        }

        const size = readOctal(header, 124, 12);
        const typeflag = String.fromCharCode(header[156]) || '0';
        const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');

        const dataStart = offset + 512;
        const dataEnd = dataStart + size;
        if (dataEnd > buffer.length) {
            throw new ArchiveLimitError('Archive is corrupt: tar entry exceeds file bounds.');
        }
        const data = buffer.subarray(dataStart, dataEnd);
        offset = dataStart + Math.ceil(size / 512) * 512;

        if (typeflag === 'L') {
            // GNU long name: the payload of this entry is the NEXT entry's name.
            longName = data.toString('utf8').replace(/\0.*$/, '');
            continue;
        }
        if (typeflag === 'K') {
            continue; // GNU long link name — link targets are not extracted.
        }
        if (typeflag === 'x' || typeflag === 'g') {
            // Pax extended header: records like "LEN path=VALUE\n".
            const text = data.toString('utf8');
            const match = text.match(/\d+ path=([^\n]+)\n/);
            if (match) paxPath = match[1];
            continue;
        }

        let name = paxPath ?? longName ?? rawName;
        if (!name && header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')) {
            const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
            name = `${prefix}/${rawName}`;
        }
        paxPath = null;
        longName = null;
        name = normalizeEntryName(name);

        if (typeflag === '5') {
            entries.push({ name, type: 'dir', data: null });
        } else if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
            entries.push({ name, type: 'file', data: Buffer.from(data) });
        } else if (typeflag === '1' || typeflag === '2') {
            throw new ArchiveLimitError(`Archive contains a non-regular file entry ("${name}").`);
        }
        // Other types (pax global, sparse metadata...) are skipped.
    }

    return entries;
}

// --- tar writer -------------------------------------------------------------

function writeOctal(value: number, fieldLen: number): Buffer {
    const digits = Math.max(0, fieldLen - 1);
    return Buffer.from(value.toString(8).padStart(digits, '0').slice(-digits) + '\0', 'latin1');
}

function tarHeader(name: string, size: number, type: '0' | '5'): Buffer {
    const header = Buffer.alloc(512);
    let fileName = name;
    let prefix = '';

    if (Buffer.byteLength(fileName) > 100) {
        const idx = fileName.lastIndexOf('/', 100);
        const cut = fileName.lastIndexOf('/', idx - 1 >= 0 ? idx - 1 : 0);
        if (idx > 0 && Buffer.byteLength(fileName.slice(idx + 1)) <= 100 && Buffer.byteLength(fileName.slice(0, cut)) <= 155) {
            prefix = fileName.slice(0, cut);
            fileName = fileName.slice(cut + 1);
        } else {
            throw new ArchiveLimitError(`Path "${name}" is too deep to store in a tar archive.`);
        }
    }

    header.write(fileName, 0, 100, 'utf8');
    writeOctal(type === '5' ? 0o755 : 0o644, 8).copy(header, 100);
    writeOctal(0, 8).copy(header, 108);
    writeOctal(0, 8).copy(header, 116);
    writeOctal(type === '5' ? 0 : size, 12).copy(header, 124);
    writeOctal(Math.floor(Date.now() / 1000), 12).copy(header, 136);
    header.write('        ', 148, 8, 'latin1'); // checksum placeholder = spaces
    header.write(type, 156, 1, 'latin1');
    header.write('ustar\0', 257, 6, 'latin1');
    header.write('00', 263, 2, 'latin1');

    const sum = header.reduce((s, b) => s + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
    return header;
}

function buildTar(files: Array<{ name: string; type: 'file' | 'dir'; data: Buffer | null }>): Buffer {
    const chunks: Buffer[] = [];
    for (const file of files) {
        if (file.type === 'file' && !file.data) continue;
        const size = file.type === 'file' ? file.data!.length : 0;
        chunks.push(tarHeader(file.name, size, file.type === 'dir' ? '5' : '0'));
        if (file.type === 'file') {
            chunks.push(file.data!);
            const pad = (512 - (size % 512)) % 512;
            if (pad > 0) chunks.push(Buffer.alloc(pad));
        }
    }
    chunks.push(Buffer.alloc(1024)); // end-of-archive marker
    return Buffer.concat(chunks);
}

// --- engine -----------------------------------------------------------------

export class ArchiveJsEngine implements ConverterEngine {
    name = 'Archive (pure JS)';

    canHandle(sourceFormat: string, targetFormat: string): boolean {
        return (
            ARCHIVE_FORMATS.has(sourceFormat) &&
            ARCHIVE_FORMATS.has(targetFormat) &&
            sourceFormat !== targetFormat
        );
    }

    async convert(
        inputPath: string,
        outputDir: string,
        sourceFormat: string,
        targetFormat: string,
        _options?: EngineOptions
    ): Promise<EngineConversionResult> {
        const startedAt = Date.now();
        const baseName = path.basename(inputPath, path.extname(inputPath).startsWith('.tar') ? '.tar.gz' : path.extname(inputPath));
        const expectedOutputPath = path.join(outputDir, `${baseName}.${targetFormat}`);

        const tempDir = path.join(env.STORAGE_ROOT, 'temp', `extract-js-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
        await fs.mkdir(tempDir, { recursive: true });
        const realDir = await fs.realpath(tempDir);

        try {
            const entries = await this.extract(inputPath, sourceFormat, realDir);
            const packed = await this.pack(realDir, targetFormat);
            await fs.writeFile(expectedOutputPath, packed);

            const stats = await fs.stat(expectedOutputPath);
            return {
                outputPath: expectedOutputPath,
                sizeBytes: stats.size,
                durationMs: Date.now() - startedAt,
            };
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    private async extract(inputPath: string, sourceFormat: string, root: string): Promise<number> {
        const raw = await fs.readFile(inputPath);
        let entries: TarEntry[];

        if (sourceFormat === 'zip') {
            const zip = await JSZip.loadAsync(raw);
            entries = [];
            for (const entry of Object.values(zip.files)) {
                const name = normalizeEntryName(entry.name);
                if (!name) continue;
                entries.push({ name, type: entry.dir ? 'dir' : 'file', data: entry.dir ? null : await entry.async('nodebuffer') });
            }
        } else {
            const tarBuffer = sourceFormat === 'tar.gz' ? zlib.gunzipSync(raw) : raw;
            entries = parseTar(tarBuffer);
        }

        let files = 0;
        let bytes = 0;
        for (const entry of entries) {
            const name = normalizeEntryName(entry.name);
            if (!name) continue;
            assertSafeEntryName(name);
            const dest = path.join(root, name);
            if (!isInsideRoot(dest, root)) {
                throw new ArchiveLimitError(`Archive entry "${entry.name}" resolves outside the extraction directory.`);
            }

            if (entry.type === 'dir') {
                await fs.mkdir(dest, { recursive: true });
                continue;
            }

            files++;
            bytes += entry.data?.length ?? 0;
            if (files > env.ARCHIVE_MAX_EXTRACTED_FILES) {
                throw new ArchiveLimitError(`Archive expands to more than ${env.ARCHIVE_MAX_EXTRACTED_FILES} files.`);
            }
            if (bytes > env.ARCHIVE_MAX_EXTRACTED_BYTES) {
                throw new ArchiveLimitError(`Archive expands to more than ${env.ARCHIVE_MAX_EXTRACTED_BYTES} bytes.`);
            }

            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, entry.data!);
        }

        return files;
    }

    private async pack(root: string, targetFormat: string): Promise<Buffer> {
        const collected: Array<{ name: string; type: 'file' | 'dir'; data: Buffer | null }> = [];

        const walk = async (current: string, prefix: string): Promise<void> => {
            const dirents = await fs.readdir(current, { withFileTypes: true });
            // Stable ordering keeps output deterministic for tests and diffs.
            dirents.sort((a, b) => a.name.localeCompare(b.name));
            for (const dirent of dirents) {
                const full = path.join(current, dirent.name);
                const name = prefix ? `${prefix}/${dirent.name}` : dirent.name;
                if (dirent.isDirectory()) {
                    collected.push({ name, type: 'dir', data: null });
                    await walk(full, name);
                } else if (dirent.isFile()) {
                    collected.push({ name, type: 'file', data: await fs.readFile(full) });
                } else {
                    throw new ArchiveLimitError(`Extraction produced a non-regular file entry ("${name}").`);
                }
            }
        };
        await walk(root, '');

        if (targetFormat === 'zip') {
            const zip = new JSZip();
            for (const entry of collected) {
                if (entry.type === 'dir') {
                    zip.folder(entry.name);
                } else {
                    zip.file(entry.name, entry.data!);
                }
            }
            return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
        }

        const tar = buildTar(collected);
        return targetFormat === 'tar.gz' ? zlib.gzipSync(tar, { level: 9 }) : tar;
    }
}
