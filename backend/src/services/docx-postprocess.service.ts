import fs from 'fs/promises';
import JSZip from 'jszip';

/**
 * LibreOffice's PDF importer (writer_pdf_import) rebuilds every PDF text block
 * as a floating text box. Its OOXML export writes the shape offsets measured
 * from the **page origin**, but labels them relativeFrom="column" (horizontal)
 * and relativeFrom="paragraph" (vertical), which Word and LibreOffice measure
 * from the section-margin / anchor-paragraph origin instead. The whole page is
 * therefore laid out shifted right and down by the section margin (567 twips =
 * 1 cm on a typical A4 page) — the "extra left spacing" seen in converted files.
 *
 * Relabel those two anchors to relativeFrom="page" so the stored offsets are
 * interpreted from the origin they were actually measured from. Every other
 * relativeFrom value is left untouched, because LO only writes page-relative
 * offsets under these two labels.
 */
export function makeAnchorOffsetsPageRelative(xml: string): string {
    return xml
        .replace(/<wp:positionH relativeFrom="column"/g, '<wp:positionH relativeFrom="page"')
        .replace(/<wp:positionV relativeFrom="paragraph"/g, '<wp:positionV relativeFrom="page"');
}

/**
 * Rewrite word/document.xml inside a DOCX produced by the LibreOffice PDF
 * fallback so floating shapes land on their original PDF coordinates.
 *
 * Returns true when the file was rewritten, false when there was nothing to
 * fix (e.g. pdf2docx output, which has no floating shapes). Throws on I/O or
 * ZIP errors so callers can decide whether the fix is fatal — it never is for
 * a conversion that already succeeded.
 */
export async function fixDocxAnchorOrigins(docxPath: string): Promise<boolean> {
    const raw = await fs.readFile(docxPath);
    const zip = await JSZip.loadAsync(raw);

    const entry = zip.file('word/document.xml');
    if (!entry) return false;

    const xml = await entry.async('string');
    const fixed = makeAnchorOffsetsPageRelative(xml);
    if (fixed === xml) return false;

    zip.file('word/document.xml', fixed);
    const rewritten = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await fs.writeFile(docxPath, rewritten);
    return true;
}
