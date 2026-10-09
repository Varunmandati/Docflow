import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { sanitizeFileName, validateFile } from './file-validation.service.js';

describe('File Validation Service', () => {
    describe('sanitizeFileName', () => {
        it('should remove special characters from filename', () => {
            const original = 'my-file @ 123 !.pdf';
            const result = sanitizeFileName(original);
            expect(result).toBe('my-file  123 .pdf');
        });

        it('should keep standard characters', () => {
            const original = 'document_v1.docx';
            const result = sanitizeFileName(original);
            expect(result).toBe('document_v1.docx');
        });
    });

    describe('validateFile', () => {
        let dir: string;

        beforeEach(async () => {
            dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docflow-val-'));
        });

        afterEach(async () => {
            await fs.rm(dir, { recursive: true, force: true });
        });

        const writeFixture = async (name: string, content: Buffer) => {
            const filePath = path.join(dir, name);
            await fs.writeFile(filePath, content);
            return filePath;
        };

        it('rejects files with a disallowed extension', async () => {
            const filePath = await writeFixture('malware.xyz', Buffer.from('MZ this is not a document'));
            const result = await validateFile(filePath, 'application/octet-stream', 'malware.xyz');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('File type not allowed');
        });
    });
});
