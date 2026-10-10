import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import JSZip from 'jszip';
import zlib from 'zlib';
import { ArchiveJsEngine } from './ArchiveJsEngine';
import { ArchiveLimitError } from './ArchiveEngine';

const engine = new ArchiveJsEngine();

let tmpDir: string;

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-js-test-'));
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function makeZipFile(name: string, files: Record<string, string>): Promise<string> {
    const zip = new JSZip();
    for (const [entry, content] of Object.entries(files)) {
        zip.file(entry, content);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const filePath = path.join(tmpDir, name);
    await fs.writeFile(filePath, buf);
    return filePath;
}

async function listZip(filePath: string): Promise<Record<string, string>> {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath));
    const out: Record<string, string> = {};
    for (const [name, entry] of Object.entries(zip.files)) {
        if (!entry.dir) out[name] = await entry.async('string');
    }
    return out;
}

describe('ArchiveJsEngine', () => {
    it('claims zip/tar/tar.gz pairs but not 7z and not same-format', () => {
        expect(engine.canHandle('zip', 'tar')).toBe(true);
        expect(engine.canHandle('zip', 'tar.gz')).toBe(true);
        expect(engine.canHandle('tar.gz', 'zip')).toBe(true);
        expect(engine.canHandle('tar', 'tar.gz')).toBe(true);
        expect(engine.canHandle('zip', '7z')).toBe(false);
        expect(engine.canHandle('7z', 'zip')).toBe(false);
        expect(engine.canHandle('zip', 'zip')).toBe(false);
        expect(engine.canHandle('mp3', 'wav')).toBe(false);
    });

    it('zip -> tar -> zip roundtrip preserves file contents', async () => {
        const zipPath = await makeZipFile('roundtrip.zip', {
            'a.txt': 'hello world',
            'nested/b.txt': 'nested content',
            'nested/deep/c.txt': 'deep content',
        });
        const outDir = path.join(tmpDir, 'out1');
        await fs.mkdir(outDir, { recursive: true });

        const tarResult = await engine.convert(zipPath, outDir, 'zip', 'tar');
        expect(tarResult.outputPath.endsWith('.tar')).toBe(true);
        expect(fs.access(tarResult.outputPath)).resolves.toBeUndefined();

        const zipResult = await engine.convert(tarResult.outputPath, outDir, 'tar', 'zip');
        const restored = await listZip(zipResult.outputPath);
        expect(restored).toEqual({
            'a.txt': 'hello world',
            'nested/b.txt': 'nested content',
            'nested/deep/c.txt': 'deep content',
        });
    });

    it('zip -> tar.gz produces valid gzip', async () => {
        const zipPath = await makeZipFile('gz.zip', { 'x.txt': 'gzip me' });
        const outDir = path.join(tmpDir, 'out2');
        await fs.mkdir(outDir, { recursive: true });

        const result = await engine.convert(zipPath, outDir, 'zip', 'tar.gz');
        const raw = await fs.readFile(result.outputPath);
        // gunzip must succeed and contain the file name in the tar stream.
        const tar = zlib.gunzipSync(raw);
        expect(tar.includes(Buffer.from('x.txt'))).toBe(true);
    });

    it('tar.gz -> zip restores contents', async () => {
        const zipPath = await makeZipFile('source.zip', { 'doc.txt': 'round gz', 'dir/file2.txt': 'two' });
        const outDir = path.join(tmpDir, 'out3');
        await fs.mkdir(outDir, { recursive: true });

        const tarResult = await engine.convert(zipPath, outDir, 'zip', 'tar.gz');
        const zipResult = await engine.convert(tarResult.outputPath, outDir, 'tar.gz', 'zip');
        const restored = await listZip(zipResult.outputPath);
        expect(restored['doc.txt']).toBe('round gz');
        expect(restored['dir/file2.txt']).toBe('two');
    });

    it('rejects path traversal entries', async () => {
        const zip = new JSZip();
        zip.file('../evil.txt', 'nope');
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        const zipPath = path.join(tmpDir, 'evil.zip');
        await fs.writeFile(zipPath, buf);
        const outDir = path.join(tmpDir, 'out4');
        await fs.mkdir(outDir, { recursive: true });

        await expect(engine.convert(zipPath, outDir, 'zip', 'tar')).rejects.toThrow(ArchiveLimitError);
    });
});
