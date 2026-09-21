import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { PdfToDocxEngine } from './PdfToDocxEngine';
import { SandboxRunner } from '../../utils/sandboxRunner';
import { executeCommand } from '../command.service';

vi.mock('../../utils/sandboxRunner', () => ({
    SandboxRunner: {
        execute: vi.fn(),
    }
}));

vi.mock('../command.service', () => ({
    executeCommand: vi.fn(),
}));

vi.mock('../../config/logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }
}));

// We test checking limits using fs.stat.
vi.mock('fs/promises', async (importOriginal) => {
    const actual = (await importOriginal()) as any;
    return {
        ...actual,
        default: {
            ...actual.default,
            access: vi.fn().mockResolvedValue(undefined),
            stat: vi.fn(),
            mkdir: vi.fn().mockResolvedValue(undefined),
            rm: vi.fn().mockResolvedValue(undefined),
            readFile: vi.fn(),
            writeFile: vi.fn(),
        }
    };
});

describe('PdfToDocxEngine', () => {
    const engine = new PdfToDocxEngine();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default happy paths
        (fs.stat as any).mockImplementation(async (filepath: string) => {
            if (filepath.endsWith('input.pdf')) return { size: 1024 * 1024 }; // 1MB
            if (filepath.endsWith('.docx')) return { size: 50 * 1024 }; // 50KB output
            return { size: 1024 };
        });
        (executeCommand as any).mockImplementation((binary: string) => {
            if (binary === 'pdfinfo') return { stdout: 'Pages: 25\n' };
            if (binary === 'pdftotext') return { stdout: 'This is some text so it is not seen as scanned.' };
            return { stdout: '' };
        });
        (SandboxRunner.execute as any).mockResolvedValue('success');
    });

    it('should declare support for pdf -> docx only', () => {
        expect(engine.canHandle('pdf', 'docx')).toBe(true);
        expect(engine.canHandle('docx', 'pdf')).toBe(false);
        expect(engine.canHandle('pdf', 'txt')).toBe(false);
    });

    it('should throw if limits are exceeded', async () => {
        // Exceeds bytes
        (fs.stat as any).mockResolvedValueOnce({ size: 300 * 1024 * 1024 });
        await expect(engine.convert('/input.pdf', '/out', 'pdf', 'docx'))
            .rejects.toThrow(/exceeds maximum size/);

        // Reset bytes, exceed pages
        (fs.stat as any).mockResolvedValue({ size: 1024 });
        (executeCommand as any).mockImplementationOnce((binary: string) => {
            if (binary === 'pdfinfo') return { stdout: 'Pages: 600\n' }; // > 500
        });
        await expect(engine.convert('/input.pdf', '/out', 'pdf', 'docx'))
            .rejects.toThrow(/exceeding the 500-page limit/);
    });

    it('should run ocrmypdf if scanned pdf detected', async () => {
        // Return < 40 chars for pdftotext to trigger scanned path
        (executeCommand as any).mockImplementation((binary: string) => {
            if (binary === 'pdfinfo') return { stdout: 'Pages: 2\n' };
            if (binary === 'pdftotext') return { stdout: 'Too short text' };
            return { stdout: '' };
        });

        await engine.convert('/input.pdf', '/out', 'pdf', 'docx');

        // Should have called SandboxRunner with ocrmypdf (which is mocked via OCRMYPDF_BIN env or default)
        expect(SandboxRunner.execute).toHaveBeenCalledWith(
            expect.stringContaining('ocrmypdf'),
            expect.arrayContaining(['--skip-text', '--deskew', '/input.pdf', expect.stringContaining('ocr-output.pdf')]),
            expect.any(Object)
        );
    });

    it('should use python script by default', async () => {
        await engine.convert('/input.pdf', '/out', 'pdf', 'docx');
        // Because of the mocks, sandbox runner executes successfully.
        // Second call should be python3
        const mockCalls = (SandboxRunner.execute as any).mock.calls;
        const callArgs = mockCalls[0][1]; // The args array of the first execute call

        expect(mockCalls[0][0]).toContain('python3');
        expect(callArgs).toEqual(
            expect.arrayContaining([
                expect.stringContaining('pdf_to_docx_v2.py'),
                '/input.pdf',
                expect.stringContaining('input.docx')
            ])
        );
    });

    it('should fallback to libreoffice if pdf2docx fails', async () => {
        // If pdf2docx fails, the SandboxRunner command will throw on the python step
        (SandboxRunner.execute as any).mockImplementationOnce(() => {
            throw new Error('pdf2docx crashed');
        });

        await engine.convert('/input.pdf', '/out', 'pdf', 'docx');

        const mockCalls = (SandboxRunner.execute as any).mock.calls;
        // First call failed (python), second call should be soffice
        expect(mockCalls[1][0]).toContain('soffice');
        expect(mockCalls[1][1]).toEqual(
            expect.arrayContaining([
                '--infilter=writer_pdf_import',
                '--convert-to',
                'docx',
                '--outdir',
                '/out',
                '/input.pdf'
            ])
        );
    });
});
