import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { makeAnchorOffsetsPageRelative, fixDocxAnchorOrigins } from './docx-postprocess.service';

const LO_ANCHORS = `
<w:p>
  <w:r>
    <wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="column"><wp:posOffset>354660</wp:posOffset></wp:positionH>
      <wp:positionV relativeFrom="paragraph"><wp:posOffset>182880</wp:posOffset></wp:positionV>
      <wp:extent cx="1234" cy="5678"/>
    </wp:anchor>
  </w:r>
</w:p>`;

describe('docx-postprocess.service', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-postprocess-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe('makeAnchorOffsetsPageRelative', () => {
        it('relabels LibreOffice column/paragraph anchors to page', () => {
            const fixed = makeAnchorOffsetsPageRelative(LO_ANCHORS);

            expect(fixed).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>354660');
            expect(fixed).toContain('<wp:positionV relativeFrom="page"><wp:posOffset>182880');
            expect(fixed).not.toContain('relativeFrom="column"');
            expect(fixed).not.toContain('relativeFrom="paragraph"');
        });

        it('leaves offsets and page/margin anchors untouched', () => {
            const xml =
                '<wp:positionH relativeFrom="page"><wp:posOffset>354660</wp:posOffset></wp:positionH>' +
                '<wp:positionV relativeFrom="margin"><wp:posOffset>182880</wp:posOffset></wp:positionV>';

            expect(makeAnchorOffsetsPageRelative(xml)).toBe(xml);
        });

        it('is a no-op for document.xml without floating shapes', () => {
            const xml = '<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body>';

            expect(makeAnchorOffsetsPageRelative(xml)).toBe(xml);
        });
    });

    describe('fixDocxAnchorOrigins', () => {
        async function writeDocx(name: string, documentXml: string | null): Promise<string> {
            const zip = new JSZip();
            zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
            if (documentXml !== null) zip.file('word/document.xml', documentXml);
            const filePath = path.join(tmpDir, name);
            await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
            return filePath;
        }

        async function readDocumentXml(docxPath: string): Promise<string> {
            const zip = await JSZip.loadAsync(await fs.readFile(docxPath));
            return zip.file('word/document.xml')!.async('string');
        }

        it('rewrites the anchors inside an existing DOCX', async () => {
            const docxPath = await writeDocx('fixed.docx', LO_ANCHORS);

            await expect(fixDocxAnchorOrigins(docxPath)).resolves.toBe(true);

            const rewritten = await readDocumentXml(docxPath);
            expect(rewritten).toContain('<wp:positionH relativeFrom="page">');
            expect(rewritten).toContain('<wp:positionV relativeFrom="page">');
        });

        it('reports no change when the file is already clean', async () => {
            const docxPath = await writeDocx('clean.docx', '<w:body><w:p/></w:body>');
            const before = await fs.readFile(docxPath);

            await expect(fixDocxAnchorOrigins(docxPath)).resolves.toBe(false);
            expect(await fs.readFile(docxPath)).toEqual(before);
        });

        it('reports no change when word/document.xml is missing', async () => {
            const docxPath = await writeDocx('empty.docx', null);

            await expect(fixDocxAnchorOrigins(docxPath)).resolves.toBe(false);
        });

        it('throws for files that are not valid ZIP archives', async () => {
            const docxPath = path.join(tmpDir, 'not-a-zip.docx');
            await fs.writeFile(docxPath, 'definitely not a zip');

            await expect(fixDocxAnchorOrigins(docxPath)).rejects.toThrow();
        });
    });
});
