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

        it('should accept a valid bencoded .torrent file', async () => {
            // Minimal single-file bencoded torrent with an announce key.
            const bencoded = Buffer.from('d8:announce42:udp://tracker.opentrackr.org:1337/announce4:info4:name4:demo13:piece lengthi262144e6:pieces0:0ee');
            const filePath = await writeFixture('demo.torrent', bencoded);
            const result = await validateFile(filePath, 'application/x-bittorrent', 'demo.torrent');
            expect(result.valid).toBe(true);
            expect(result.extension).toBe('.torrent');
        });

        it('should accept a real .torrent file (big-buck-bunny fixture)', async () => {
            // Load an actual bencoded .torrent file from disk (not a synthetic
            // buffer) so we validate against real-world torrent bytes.
            const fixtureDir = path.join(__dirname, '__fixtures__');
            const fixturePath = path.join(fixtureDir, 'big-buck-bunny.torrent');
            const realTorrent = await fs.readFile(fixturePath);

            // Sanity: the fixture really is bencoded (starts with 'd' 0x64).
            expect(realTorrent[0]).toBe(0x64);

            const filePath = await writeFixture('big-buck-bunny.torrent', realTorrent);
            const result = await validateFile(filePath, 'application/x-bittorrent', 'big-buck-bunny.torrent');
            expect(result.valid).toBe(true);
            expect(result.extension).toBe('.torrent');
            expect(result.mimeType).toBe('application/x-bittorrent');
        });

        it('rejects a .torrent that is not bencoded', async () => {
            const filePath = await writeFixture('fake.torrent', Buffer.from('this is not a bencoded torrent at all!'));
            const result = await validateFile(filePath, 'application/x-bittorrent', 'fake.torrent');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('bencoded torrent');
        });

        it('rejects a .torrent with a bad declared mime type', async () => {
            const bencoded = Buffer.from('d8:announce42:udp://tracker.opentrackr.org:1337/announce4:name4:demo1');
            const filePath = await writeFixture('demo.torrent', bencoded);
            const result = await validateFile(filePath, 'application/zip', 'demo.torrent');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('MIME type not allowed');
        });
    });
});
