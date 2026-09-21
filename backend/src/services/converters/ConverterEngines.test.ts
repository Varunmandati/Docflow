import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { LibreOfficeEngine } from './LibreOfficeEngine';
import { SharpEngine } from './SharpEngine';
import { IcoEngine } from './IcoEngine';
import { SandboxRunner } from '../../utils/sandboxRunner';

vi.mock('../../utils/sandboxRunner', () => ({
    SandboxRunner: {
        execute: vi.fn(),
    }
}));

vi.mock('fs/promises', () => ({
    default: {
        stat: vi.fn(),
        mkdir: vi.fn(),
        rm: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
    }
}));

vi.mock('jszip', () => ({
    default: {
        loadAsync: vi.fn(),
    }
}));

vi.mock('sharp', () => ({
    default: vi.fn(() => ({
        jpeg: vi.fn().mockReturnThis(),
        png: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toFile: vi.fn().mockResolvedValue(undefined),
    })),
}));

describe('Converter Engines', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('LibreOfficeEngine', () => {
        const engine = new LibreOfficeEngine();

        it('should report correct supported formats', () => {
            expect(engine.canHandle('docx', 'pdf')).toBe(true);
            expect(engine.canHandle('csv', 'pdf')).toBe(true);
            expect(engine.canHandle('md', 'pdf')).toBe(true);
            expect(engine.canHandle('epub', 'pdf')).toBe(true);
            expect(engine.canHandle('pdf', 'docx')).toBe(false); // PDF -> DOCX moved to PdfToDocxEngine
            expect(engine.canHandle('png', 'pdf')).toBe(true); // Rasterized via LibreOffice
            expect(engine.canHandle('svg', 'pdf')).toBe(true);
            expect(engine.canHandle('bmp', 'pdf')).toBe(true);
        });

        it('should execute soffice with correct arguments', async () => {
            (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 1024 });
            (SandboxRunner.execute as ReturnType<typeof vi.fn>).mockResolvedValue('success');

            const result = await engine.convert('/input/file.docx', '/output', 'docx', 'pdf');

            expect(SandboxRunner.execute).toHaveBeenCalledWith(
                'soffice',
                [
                    '--headless',
                    '--invisible',
                    '--nologo',
                    '--nodefault',
                    '--nofirststartwizard',
                    expect.stringContaining('-env:UserInstallation='),
                    '--convert-to',
                    'pdf',
                    '--outdir',
                    '/output',
                    '/input/file.docx'
                ],
                expect.any(Object)
            );

            expect(result.outputPath).toBe(path.join('/output', 'file.pdf'));
            expect(result.sizeBytes).toBe(1024);
        });

        it('should fail if output file is missing after command execution', async () => {
            (SandboxRunner.execute as any).mockResolvedValue('success');
            (fs.stat as any).mockRejectedValue(new Error('ENOENT'));

            await expect(engine.convert('/input/file.docx', '/output', 'docx', 'pdf'))
                .rejects
                .toThrow('Conversion completed but output file was not found');
        });
    });

    describe('SharpEngine', () => {
        const engine = new SharpEngine();

        it('should report correct supported formats', () => {
            expect(engine.canHandle('jpg', 'png')).toBe(true);
            expect(engine.canHandle('png', 'webp')).toBe(true);
            expect(engine.canHandle('pdf', 'png')).toBe(false); // Handled by PdfEngine
        });

        // We could test the pipeline but sharp is harder to mock without a deep mock.
        // The canHandle check is enough for verifying the matrix routing config.
    });

    describe('IcoEngine', () => {
        const engine = new IcoEngine();

        it('should report correct supported formats', () => {
            expect(engine.canHandle('ico', 'png')).toBe(true);
            expect(engine.canHandle('ico', 'jpg')).toBe(true);
            expect(engine.canHandle('ico', 'webp')).toBe(true);
            expect(engine.canHandle('ico', 'pdf')).toBe(true);
            expect(engine.canHandle('png', 'ico')).toBe(false);
            expect(engine.canHandle('bmp', 'png')).toBe(false);
        });

        it('should convert a PNG-compressed ICO to PNG via sharp', async () => {
            // Minimal valid ICO header + 1 PNG entry.
            const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
            const ico = Buffer.alloc(6 + 16 + pngMagic.length);
            ico.writeUInt16LE(0, 0);
            ico.writeUInt16LE(1, 2);
            ico.writeUInt16LE(1, 4);
            ico[6] = 32; ico[7] = 32; ico[8] = 0; ico[9] = 0;
            ico.writeUInt16LE(1, 10);
            ico.writeUInt16LE(32, 12);
            ico.writeUInt32LE(pngMagic.length, 14);
            ico.writeUInt32LE(22, 18);
            pngMagic.copy(ico, 22);

            (fs.readFile as any).mockResolvedValue(ico);
            (fs.stat as any).mockResolvedValue({ size: 128 });

            const result = await engine.convert('/input/icon.ico', '/output', 'ico', 'png');

            expect(result.outputPath).toBe(path.join('/output', 'icon.png'));
            expect(result.sizeBytes).toBe(128);
        });
    });
});
