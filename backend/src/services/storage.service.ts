import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { UploadedFileMeta } from '../models/types.js';

const uploadsDir = path.join(env.STORAGE_ROOT, 'uploads');
const jobsDir = path.join(env.STORAGE_ROOT, 'jobs');

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '_');

const ensureInRoot = (resolvedPath: string) => {
    const normalizedRoot = path.resolve(env.STORAGE_ROOT);
    const normalizedTarget = path.resolve(resolvedPath);
    // Separator-aware boundary check: guard against sibling dirs that merely
    // share the storage-root prefix (e.g. root=<storage>, target=<storage>-evil).
    const within =
        normalizedTarget === normalizedRoot ||
        normalizedTarget.startsWith(normalizedRoot + path.sep);
    if (!within) {
        throw new Error('Path traversal blocked.');
    }
    return normalizedTarget;
};

// Upload records live at {uploadsDir}/{uuid}.json. Only accept actual UUID v4
// identifiers so a user-supplied `fileId` cannot escape the uploads directory.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertValidFileId = (fileId: string) => {
    if (!UUID_RE.test(fileId)) {
        throw new Error('Invalid file identifier.');
    }
};

const uploadMetaPath = (fileId: string) => {
    assertValidFileId(fileId);
    return path.join(uploadsDir, `${fileId}.json`);
};

export async function ensureStorageLayout(): Promise<void> {
    // `temp` is written by the upload handler and swept by the cleanup worker,
    // but was never created here. On a fresh volume the worker silently swept
    // an empty list and upload created the directory lazily, so a misconfigured
    // STORAGE_ROOT surfaced hours later instead of at boot. ensureStorageRootLayout()
    // (config/env.ts) creates all three up front and throws if the volume is
    // unwritable; this stays as the async entrypoint the workers use.
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.mkdir(path.join(env.STORAGE_ROOT, 'temp'), { recursive: true });
}

export async function saveUpload(fileName: string, mimeType: string, content: Buffer, userId?: string): Promise<UploadedFileMeta> {
    await ensureStorageLayout();

    const fileId = randomUUID();
    const storedName = `${fileId}-${safeFileName(fileName)}`;
    const storedPath = path.join(uploadsDir, storedName);

    await fs.writeFile(storedPath, content);

    const meta: UploadedFileMeta = {
        fileId,
        originalName: fileName,
        storedName,
        mimeType,
        size: content.length,
        path: storedPath,
        createdAt: new Date().toISOString(),
        userId,
    };

    await fs.writeFile(uploadMetaPath(fileId), JSON.stringify(meta, null, 2), 'utf-8');
    return meta;
}

export async function getUploadMeta(fileId: string): Promise<UploadedFileMeta | null> {
    try {
        const raw = await fs.readFile(uploadMetaPath(fileId), 'utf-8');
        return JSON.parse(raw) as UploadedFileMeta;
    } catch {
        return null;
    }
}

/**
 * Ownership check for an uploaded file. Returns the meta only when the upload
 * belongs to the given user (or the user is null and the upload is anonymous).
 * Returns null otherwise — the caller should treat this as "not found" so an
 * attacker cannot distinguish a missing file from a forbidden one.
 */
export async function getUploadMetaForUser(fileId: string, userId: string | null): Promise<UploadedFileMeta | null> {
    const meta = await getUploadMeta(fileId);
    if (!meta) return null;
    if (userId) {
        return meta.userId === userId ? meta : null;
    }
    // Callers without a user id only ever reach anonymous uploads.
    return meta.userId ? null : meta;
}

export interface JobWorkspace {
    baseDir: string;
    inputDir: string;
    outputDir: string;
    pagesDir: string;
    imagesDir: string;
    htmlDir: string;
}

export async function createJobWorkspace(jobId: string): Promise<JobWorkspace> {
    const baseDir = path.join(jobsDir, jobId);
    const inputDir = path.join(baseDir, 'input');
    const outputDir = path.join(baseDir, 'output');
    const pagesDir = path.join(baseDir, 'pages');
    const imagesDir = path.join(baseDir, 'images');
    const htmlDir = path.join(baseDir, 'html');

    await Promise.all([
        fs.mkdir(inputDir, { recursive: true }),
        fs.mkdir(outputDir, { recursive: true }),
        fs.mkdir(pagesDir, { recursive: true }),
        fs.mkdir(imagesDir, { recursive: true }),
        fs.mkdir(htmlDir, { recursive: true }),
    ]);

    return { baseDir, inputDir, outputDir, pagesDir, imagesDir, htmlDir };
}

export async function copyInputToWorkspace(sourcePath: string, inputDir: string, originalName: string): Promise<string> {
    const target = path.join(inputDir, safeFileName(originalName));
    await fs.copyFile(sourcePath, target);
    return target;
}

export function toRelativeStoragePath(absolutePath: string): string {
    const safeAbsolute = ensureInRoot(absolutePath);
    const relative = path.relative(env.STORAGE_ROOT, safeAbsolute);
    return relative.split(path.sep).join('/');
}

export function resolveStoragePath(relativePath: string): string {
    const absolutePath = path.resolve(env.STORAGE_ROOT, relativePath);
    return ensureInRoot(absolutePath);
}

export async function getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
}
