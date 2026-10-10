import fs from 'fs/promises';
import path from 'path';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import mime from 'mime-types';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { workerPool } from '../db/client.js';
import { UploadedFileMeta } from '../models/types.js';

/**
 * Cloudflare R2 (S3-compatible) storage backend for serverless deployments.
 *
 * This module is only ever reached through the `env.IS_R2_STORAGE` dispatch
 * branches in storage.service.ts / files.routes.ts (dynamic imports), so
 * disk-mode deployments never load the AWS SDK at runtime.
 *
 * Path convention: durable files are addressed by their logical storage path
 * (`uploads/...`, `jobs/{jobId}/...`) — identical to the disk-mode relative
 * paths — and inlined as `r2://<key>` where a filesystem path would have been
 * used (upload metadata `path`, job input paths).
 */

let client: S3Client | null = null;

function requireConfig(): { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string } {
    const endpoint = env.R2_ENDPOINT;
    const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
    const bucket = env.R2_BUCKET?.trim();
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error(
            'R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
            'R2_SECRET_ACCESS_KEY and R2_BUCKET (STORAGE_BACKEND=r2).'
        );
    }
    return { endpoint, accessKeyId, secretAccessKey, bucket };
}

function s3(): { client: S3Client; bucket: string } {
    const { endpoint, accessKeyId, secretAccessKey, bucket } = requireConfig();
    if (!client) {
        client = new S3Client({
            region: 'auto',
            endpoint,
            credentials: { accessKeyId, secretAccessKey },
        });
    }
    return { client, bucket };
}

export function r2UriToKey(uri: string): string {
    if (!uri.startsWith('r2://')) {
        throw new Error(`Not an r2:// path: ${uri}`);
    }
    return uri.slice('r2://'.length);
}

export function keyToR2Uri(key: string): string {
    return `r2://${key}`;
}

const contentTypeFor = (key: string): string => mime.lookup(key) || 'application/octet-stream';

// --- Object I/O ------------------------------------------------------------

export async function putObjectFromBuffer(key: string, body: Buffer, contentType?: string): Promise<void> {
    const { client: c, bucket } = s3();
    await c.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || contentTypeFor(key),
    }));
}

/** Upload a finished job artifact from the local (ephemeral) workspace. */
export async function uploadArtifact(relativePath: string, absolutePath: string): Promise<void> {
    const body = await fs.readFile(absolutePath);
    await putObjectFromBuffer(relativePath, body);
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
    const { client: c, bucket } = s3();
    const res = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`R2 object is empty or unreadable: ${key}`);
    return Buffer.from(bytes);
}

/** Node Readable for streaming downloads through the API function. */
export async function getObjectStream(key: string): Promise<{ stream: NodeJS.ReadableStream; size: number | null }> {
    const { client: c, bucket } = s3();
    const res = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`R2 object not found: ${key}`);
    const size = typeof res.ContentLength === 'number' ? res.ContentLength : null;
    return { stream: res.Body as unknown as NodeJS.ReadableStream, size };
}

export async function headSize(key: string): Promise<number | null> {
    try {
        const { client: c, bucket } = s3();
        const res = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return typeof res.ContentLength === 'number' ? res.ContentLength : null;
    } catch {
        return null;
    }
}

/** Download an `r2://` object to a local (workspace) path. */
export async function downloadR2ToLocal(uri: string, destAbs: string): Promise<void> {
    const buf = await getObjectBuffer(r2UriToKey(uri));
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.writeFile(destAbs, buf);
}

/** Download by logical key (used by the validation step of direct uploads). */
export async function downloadKeyToLocal(key: string, destAbs: string): Promise<void> {
    const buf = await getObjectBuffer(key);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.writeFile(destAbs, buf);
}

export async function deleteKey(key: string): Promise<void> {
    try {
        const { client: c, bucket } = s3();
        await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
        logger.warn({ key, err }, 'R2 delete failed');
    }
}

export async function deleteByPrefix(prefix: string): Promise<number> {
    const { client: c, bucket } = s3();
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
        const listed = await c.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
        if (keys.length > 0) {
            await c.send(new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: keys, Quiet: true },
            }));
            deleted += keys.length;
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return deleted;
}

/**
 * Presigned PUT URL for the browser-direct upload flow. The browser sends the
 * file straight to R2 (bypassing the ~4.5MB serverless request body cap) and
 * the API only validates the object afterwards.
 */
export async function presignPut(key: string, contentType: string, expiresInSeconds = 900): Promise<string> {
    const { client: c, bucket } = s3();
    const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType || contentTypeFor(key),
    });
    return getSignedUrl(c, cmd, { expiresIn: expiresInSeconds });
}

// --- Upload metadata (PostgreSQL `uploads` table) --------------------------

export interface UploadRow {
    file_id: string;
    user_id: string | null;
    original_name: string;
    mime_type: string;
    size_bytes: string | number;
    r2_key: string;
    status: 'pending' | 'ready';
    created_at: Date;
}

export function uploadRowToMeta(row: UploadRow): UploadedFileMeta {
    return {
        fileId: row.file_id,
        originalName: row.original_name,
        storedName: row.r2_key.split('/').pop() || row.r2_key,
        mimeType: row.mime_type,
        size: Number(row.size_bytes),
        path: keyToR2Uri(row.r2_key),
        createdAt: new Date(row.created_at).toISOString(),
        userId: row.user_id ?? undefined,
    };
}

export async function insertPendingUpload(input: {
    fileId: string;
    userId: string | undefined;
    fileName: string;
    mimeType: string;
    size: number;
    r2Key: string;
    status?: 'pending' | 'ready';
}): Promise<void> {
    await workerPool.query(
        `INSERT INTO uploads (file_id, user_id, original_name, mime_type, size_bytes, r2_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.fileId, input.userId ?? null, input.fileName, input.mimeType, input.size, input.r2Key, input.status ?? 'pending']
    );
}

export async function markUploadReady(fileId: string, size: number): Promise<void> {
    await workerPool.query(
        `UPDATE uploads SET status = 'ready', size_bytes = $2 WHERE file_id = $1`,
        [fileId, size]
    );
}

export async function getUploadRow(fileId: string): Promise<UploadRow | null> {
    const res = await workerPool.query(`SELECT * FROM uploads WHERE file_id = $1`, [fileId]);
    return res.rows[0] ?? null;
}

/** Ownership-scoped lookup mirroring storage.service's disk counterpart. */
export async function getUploadRowForUser(fileId: string, userId: string | null): Promise<UploadRow | null> {
    const row = await getUploadRow(fileId);
    if (!row) return null;
    if (userId) return row.user_id === userId ? row : null;
    return row.user_id ? null : row;
}

export async function deleteUploadRow(fileId: string): Promise<void> {
    await workerPool.query(`DELETE FROM uploads WHERE file_id = $1`, [fileId]);
}

/**
 * Create the durable upload record after a direct-to-R2 upload has been
 * validated. Equivalent of storage.service's `saveUpload` for r2 mode.
 */
export async function finalizeUploadRow(fileId: string, size: number): Promise<UploadedFileMeta | null> {
    const row = await getUploadRow(fileId);
    if (!row) return null;
    await markUploadReady(fileId, size);
    return uploadRowToMeta({ ...row, status: 'ready', size_bytes: size });
}

// --- Cleanup (invoked from the hourly cron) --------------------------------

/**
 * Sweep expired upload rows and their objects. Mirrors the disk-mode temp
 * sweep in cleanup.worker.ts, which only ever covers local files — without
 * this, orphaned R2 objects from abandoned direct uploads would accumulate
 * for the lifetime of the bucket.
 */
export async function cleanupExpiredR2Uploads(): Promise<void> {
    try {
        const res = await workerPool.query(
            `DELETE FROM uploads WHERE expires_at < NOW() RETURNING r2_key`
        );
        for (const row of res.rows as Array<{ r2_key: string }>) {
            await deleteKey(row.r2_key);
        }
        if (res.rowCount && res.rowCount > 0) {
            logger.info({ count: res.rowCount }, 'Swept expired R2 uploads');
        }
    } catch (err) {
        logger.error({ err }, 'Failed to sweep expired R2 uploads');
    }
}
