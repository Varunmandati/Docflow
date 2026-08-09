import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { LibreOfficeEngine } from './LibreOfficeEngine';
import { SharpEngine } from './SharpEngine';
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
    }
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
            expect(engine.canHandle('pdf', 'docx')).toBe(false); // Only outputs PDF
            expect(engine.canHandle('png', 'pdf')).toBe(false); // Does not handle images
        });

        it('should execute soffice with correct arguments', async () => {
            (fs.stat as any).mockResolvedValue({ size: 1024 });
            (SandboxRunner.execute as any).mockResolvedValue('success');

            const result = await engine.convert('/input/file.docx', '/output', 'docx', 'pdf');

            expect(SandboxRunner.execute).toHaveBeenCalledWith(
                'soffice',
                [
                    '--headless',
                    '--invisible',
                    '--nologo',
                    '--nodefault',
                    '--nofirststartwizard',
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
});
