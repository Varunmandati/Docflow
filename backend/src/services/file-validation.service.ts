import path from 'path';
import fs from 'fs/promises';

interface FileValidationResult {
    valid: boolean;
    error?: string;
    mimeType?: string;
    extension?: string;
}

// Allowed MIME types for document conversion and image processing.
// NOTE: browsers sometimes report uploads as `application/octet-stream`, so a
// generic octet-stream is always accepted here — the per-extension
// magic/signature check still rejects bogus bytes.
const ALLOWED_MIME_TYPES = new Set([
    'application/octet-stream',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/rtf',
    'text/plain',
    'application/pdf',
    'application/x-pdf',
    // Image MIME types
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/bmp',
    'image/gif',
    'image/tiff',
    'image/x-tiff',
    'image/webp',
    // Audio MIME types
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/aacp',
    'audio/flac',
    'audio/ogg',
    'audio/x-m4a',
    'audio/mp4',
    // Video MIME types
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo',
    'video/x-matroska',
    // Archive MIME types
    'application/zip',
    'application/x-zip-compressed',
    'application/gzip',
    'application/x-tar',
    'application/x-7z-compressed',
    // Extended document MIME types
    'text/markdown',
    'text/x-markdown',
    'application/epub+zip',
    'text/html',
    'text/csv',
    'text/tab-separated-values',
    // Extended image MIME types
    'image/svg+xml',
    'image/heic',
    'image/heif',
    'image/heif-sequence',
    'image/avif',
    'image/x-icon',
    'image/vnd.microsoft.icon',
]);

// File magic numbers (signatures) for validation
const FILE_SIGNATURES: Record<string, Buffer[]> = {
    'pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
    'docx': [Buffer.from([0x50, 0x4B, 0x03, 0x04])], // ZIP header (PK..)
    'doc': [
        Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), // OLE compound document
        Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
    ],
    'pptx': [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
    'xlsx': [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
    'rtf': [Buffer.from([0x7B, 0x5C, 0x72, 0x74, 0x66])], // {\rtf
    'txt': [], // No signature check for text files
    // Image signatures
    'jpg': [Buffer.from([0xFF, 0xD8, 0xFF])], // JPEG
    'jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])], // JPEG
    'png': [Buffer.from([0x89, 0x50, 0x4E, 0x47])], // PNG
    'bmp': [Buffer.from([0x42, 0x4D])], // BMP
    'gif': [Buffer.from([0x47, 0x49, 0x46])], // GIF
    'tiff': [
        Buffer.from([0x49, 0x49, 0x2A, 0x00]), // TIFF little-endian
        Buffer.from([0x4D, 0x4D, 0x00, 0x2A]), // TIFF big-endian
    ],
    'webp': [Buffer.from([0x52, 0x49, 0x46, 0x46])], // RIFF (WebP container)
};

const ALLOWED_EXTENSIONS = new Set([
    '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.odt', '.odp', '.ods', '.rtf', '.txt', '.md', '.epub', '.html', '.htm', '.csv', '.tsv',
    '.pdf',
    // Image extensions
    '.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.tif', '.webp', '.svg', '.heic', '.heif', '.avif', '.ico',
    // Audio extensions
    '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a',
    // Video extensions
    '.mp4', '.mov', '.webm', '.avi', '.mkv',
    // Archive extensions
    '.zip', '.tar', '.tar.gz', '.tgz', '.7z', '.gz'
]);

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Validate file before upload
 */
export async function validateFile(
    filePath: string,
    declaredMimeType: string,
    declaredFileName: string
): Promise<FileValidationResult> {
    try {
        // Check file extension
        const ext = path.extname(declaredFileName).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return {
                valid: false,
                error: `File type not allowed. Supported: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
            };
        }

        // Check file size
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_FILE_SIZE) {
            return {
                valid: false,
                error: `File size exceeds limit (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
            };
        }

        // Check MIME type
        if (!ALLOWED_MIME_TYPES.has(declaredMimeType)) {
            return {
                valid: false,
                error: `MIME type not allowed: ${declaredMimeType}`,
            };
        }

        // Validate file signature using file-type
        const { fileTypeFromFile } = await import('file-type');
        const typeInfo = await fileTypeFromFile(filePath);

        // For plain text files, file-type might return undefined (since they lack magic bytes)
        // If typeInfo is missing, and the extension is .txt, .csv, etc, we can allow it based on text heuristic
        if (!typeInfo) {
            const extWithoutDot = ext.substring(1).toLowerCase();
            if (['txt', 'csv', 'tsv', 'md', 'markdown', 'html', 'htm'].includes(extWithoutDot)) {
                // Ensure it's mostly text by reading a chunk
                const buffer = Buffer.alloc(512);
                const fd = await fs.open(filePath, 'r');
                const { bytesRead } = await fd.read(buffer, 0, 512, 0);
                await fd.close();
                
                // If there are null bytes, it's likely a binary file masquerading as text
                if (buffer.subarray(0, bytesRead).includes(0)) {
                    return {
                        valid: false,
                        error: `File signature validation failed. Expected text but found binary data.`,
                    };
                }
            }
        } else {
            // Check if the detected extension matches the declared one (or is loosely compatible)
            const detectedExt = typeInfo.ext.toLowerCase();
            const declaredExt = ext.substring(1).toLowerCase();
            
            // Map some aliases where file-type might return a different extension
            const extAliases: Record<string, string[]> = {
                'jpg': ['jpg', 'jpeg'],
                'jpeg': ['jpg', 'jpeg'],
                'tif': ['tif', 'tiff'],
                'tiff': ['tif', 'tiff'],
                'docx': ['docx', 'zip'],
                'xlsx': ['xlsx', 'zip'],
                'pptx': ['pptx', 'zip'],
                'odt': ['odt', 'zip'],
                'ods': ['ods', 'zip'],
                'odp': ['odp', 'zip'],
                'epub': ['epub', 'zip'],
                'doc': ['doc', 'cfb'], // file-type detects older MS Office files as cfb
                'xls': ['xls', 'cfb'],
                'ppt': ['ppt', 'cfb'],
                'm4a': ['m4a', 'mp4'],
                'mp4': ['mp4', 'm4a', 'mov'],
                'mov': ['mov', 'mp4', 'qt'],
                'mkv': ['mkv'],
                'avi': ['avi'],
                'webm': ['webm'],
                'mp3': ['mp3'],
                'wav': ['wav'],
                'aac': ['aac'],
                'flac': ['flac'],
                'ogg': ['ogg', 'oga'],
                'zip': ['zip', 'jar'],
                'tgz': ['gz', 'tar.gz', 'tgz'],
                'gz': ['gz', 'tar.gz', 'tgz'],
                'tar.gz': ['gz', 'tar.gz', 'tgz'],
                'tar': ['tar'],
                '7z': ['7z'],
                'md': ['md', 'markdown'],
                'html': ['html', 'htm'],
                'htm': ['html', 'htm'],
                'svg': ['svg', 'xml'],
                'heic': ['heic', 'heif'],
                'heif': ['heic', 'heif'],
                'avif': ['avif', 'heif', 'heic'],
                'ico': ['ico']
            };

            const allowedDetectedExts = extAliases[declaredExt] || [declaredExt];
            if (!allowedDetectedExts.includes(detectedExt)) {
                return {
                    valid: false,
                    error: `File signature validation failed. Expected ${declaredExt.toUpperCase()} but detected ${detectedExt.toUpperCase()}.`,
                };
            }
        }

        return {
            valid: true,
            mimeType: typeInfo ? typeInfo.mime : declaredMimeType,
            extension: ext,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            valid: false,
            error: `File validation error: ${message}`,
        };
    }
}

/**
 * Sanitize file name to prevent directory traversal
 */
export function sanitizeFileName(fileName: string): string {
    return path.basename(fileName).replace(/[^\w\s.-]/g, '');
}

/**
 * Detect file type from content
 */
export async function detectFileType(filePath: string): Promise<string> {
    try {
        const buffer = Buffer.alloc(512);
        const fd = await fs.open(filePath, 'r');
        await fd.read(buffer, 0, 512, 0);
        await fd.close();

        // PDF
        if (buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) {
            return 'pdf';
        }

        // ZIP-based (DOCX, PPTX, XLSX)
        if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]))) {
            return 'zip-based';
        }

        // OLE (DOC, XLS, PPT, etc.)
        if (buffer.subarray(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))) {
            return 'ole';
        }

        // RTF
        if (buffer.subarray(0, 5).equals(Buffer.from([0x7B, 0x5C, 0x72, 0x74, 0x66]))) {
            return 'rtf';
        }

        // Plain text (check for null bytes)
        if (!buffer.includes(0)) {
            return 'text';
        }

        return 'unknown';
    } catch {
        return 'unknown';
    }
}
