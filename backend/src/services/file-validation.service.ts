import path from 'path';
import fs from 'fs/promises';

interface FileValidationResult {
    valid: boolean;
    error?: string;
    mimeType?: string;
    extension?: string;
}

// Allowed MIME types for document conversion and image processing
const ALLOWED_MIME_TYPES = new Set([
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
    'application/x-torrent',
    'application/x-bittorrent',
    // Image MIME types
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/bmp',
    'image/gif',
    'image/tiff',
    'image/x-tiff',
    'image/webp',
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
    'torrent': [Buffer.from([0x64])], // 'd' (0x64) - bencoded dictionary start
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
    '.odt', '.odp', '.ods', '.rtf', '.txt', '.pdf', '.torrent',
    // Image extensions
    '.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.tif', '.webp'
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

        // Validate file signature (magic numbers)
        const buffer = Buffer.alloc(512);
        const fd = await fs.open(filePath, 'r');
        await fd.read(buffer, 0, 512, 0);
        await fd.close();

        const extWithoutDot = ext.substring(1).toLowerCase();
        const signatures = FILE_SIGNATURES[extWithoutDot];

        if (signatures && signatures.length > 0) {
            let signatureMatch = false;
            for (const signature of signatures) {
                if (buffer.subarray(0, signature.length).equals(signature)) {
                    signatureMatch = true;
                    break;
                }
            }

            if (!signatureMatch) {
                return {
                    valid: false,
                    error: `File signature validation failed. The file may be corrupted or not a valid ${extWithoutDot.toUpperCase()} file.`,
                };
            }
        }

        return {
            valid: true,
            mimeType: declaredMimeType,
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

        // Torrent (bencoded - starts with 'd')
        if (buffer.subarray(0, 1).equals(Buffer.from([0x64]))) {
            return 'torrent';
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
