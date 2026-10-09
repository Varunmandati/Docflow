import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { z } from 'zod';

// Always load the backend's own .env (resolved from this file's location),
// regardless of the process working directory. dotenv.config() with no path
// reads process.cwd()/.env, so launching from the project root silently picks
// up the root .env (which can hold a different/stale SMTP password).
// (Compiled to CommonJS, so __dirname is available at runtime.)
const envDir = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(envDir, '.env') });
dotenv.config();

const EnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('127.0.0.1'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    STORAGE_ROOT: z.string().default('./storage'),
    SOFFICE_BINARY: z.string().default('soffice'),
    PDFTOPPM_BINARY: z.string().default('pdftoppm'),
    PDFTOTEXT_BINARY: z.string().default('pdftotext'),
    GS_BINARY: z.string().default('gs'),
    FFMPEG_BINARY: z.string().default('ffmpeg'),
    SEVENZIP_BINARY: z.string().default('7z'),
    PDF2HTMLEX_BINARY: z.string().default('pdf2htmlEX'),
    CONVERSION_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
    HEAVY_JOB_CONCURRENCY: z.coerce.number().int().positive().optional(),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
    PDF_DOCX_OCR: z.enum(['on', 'off']).default('on'),
    JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
    JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    // Empty (the default) means "same-origin only": no Access-Control-Allow-*
    // header is ever emitted. That is the correct posture for the production
    // architecture, where Caddy serves the SPA and the API from one origin.
    // Local development and any split-origin deployment must set it explicitly.
    CORS_ORIGIN: z.string().default(''),
    RUN_INLINE_WORKERS: z.string().default('false'),
    SMTP_HOST: z.string().default('smtp.gmail.com'),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASS: z.string().optional().default(''),
    SMTP_FROM: z.string().default('DocFlow <noreply@docflow.example.com>'),
    EMAIL_TRANSPORT: z.enum(['smtp', 'resend']).default('smtp'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    DATABASE_URL: z.string().url(),
    DATABASE_URL_WORKER: z.string().url(),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(1),
    DB_POOL_MAX: z.coerce.number().int().min(1).default(5),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    BULLMQ_DRAIN_DELAY_SEC: z.coerce.number().int().min(0).default(5),
    BULLMQ_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    RATE_LIMIT_EXPENSIVE_FALLBACK: z.enum(['open', 'memory']).default('open'),
    TRUST_PROXY: z.string().default('false'),
    ARTIFACT_TTL_MINUTES: z.coerce.number().int().positive().default(10080),
    DATABASE_URL_DIRECT: z.string().url().optional(),
    RUN_MIGRATIONS_ON_START: z.string().default('false'),

    // --- Worker liveness ----------------------------------------------------
    // The worker process heartbeats into Redis on this interval. /v1/health
    // reports the worker as degraded when the heartbeat has gone stale, which
    // is the only way a containerised worker can be observed: a BullMQ worker
    // that is alive but wedged produces no other signal.
    WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
    WORKER_HEARTBEAT_STALE_MS: z.coerce.number().int().min(2000).default(60000),

    // --- Archive extraction safety ------------------------------------------
    // ArchiveEngine shells out to 7z/tar. Without these bounds a tiny archive
    // can exhaust the volume (a decompression bomb) or spawn millions of
    // inodes. Enforced after extraction, before repacking.
    ARCHIVE_MAX_EXTRACTED_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
    ARCHIVE_MAX_EXTRACTED_FILES: z.coerce.number().int().positive().default(20000),
    ARCHIVE_EXTRACT_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),

    // --- Command execution output caps --------------------------------------
    // command.service.ts buffers a child's stdout/stderr into a JS string.
    // An unbounded capture is a trivial memory-exhaustion vector, so every
    // invocation truncates at this many bytes per stream.
    COMMAND_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
});

export function parseTrustProxy(val: string): boolean | string | ((address: string, hop: number) => boolean) {
    const trimmed = val.trim();
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false' || trimmed === '') return false;
    const num = Number(trimmed);
    if (!Number.isNaN(num) && Number.isInteger(num) && num >= 0) {
        return (_address: string, hop: number): boolean => hop < num;
    }
    return trimmed;
}

const parsed = EnvSchema.parse(process.env);

/**
 * Production fail-closed validation.
 *
 * Refusing to boot on an unsafe configuration is the only check that cannot be
 * forgotten at deploy time - everything else degrades silently.
 */
function assertProductionInvariants(config: typeof parsed): void {
    if (config.NODE_ENV !== 'production') return;

    const problems: string[] = [];

    if (config.CORS_ORIGIN === '*') {
        problems.push(
            'CORS_ORIGIN="*" is not permitted in production. The public origin is same-origin, so leave it ' +
            'empty, or set the exact origin (e.g. CORS_ORIGIN=https://docflow.example.com).',
        );
    }

    if (config.RUN_INLINE_WORKERS === 'true') {
        problems.push(
            'RUN_INLINE_WORKERS must be "false" in production so conversion work runs in the dedicated ' +
            'worker container rather than competing with request handling inside the API.',
        );
    }

    if (config.EMAIL_TRANSPORT === 'resend' && !config.RESEND_API_KEY?.trim()) {
        problems.push('EMAIL_TRANSPORT=resend requires RESEND_API_KEY.');
    }

    if (config.DB_POOL_MAX < config.DB_POOL_MIN) {
        problems.push(`DB_POOL_MAX (${config.DB_POOL_MAX}) is below DB_POOL_MIN (${config.DB_POOL_MIN}).`);
    }

    if (problems.length > 0) {
        throw new Error(
            'Refusing to start in production with an unsafe configuration:\n' +
            problems.map((p) => `  - ${p}`).join('\n') +
            '\n\nSee deploy/oci/.env.example for the required production values.',
        );
    }
}

assertProductionInvariants(parsed);

export const env = {
    ...parsed,
    RUN_INLINE_WORKERS: parsed.RUN_INLINE_WORKERS === 'true',
    RUN_MIGRATIONS_ON_START: parsed.RUN_MIGRATIONS_ON_START === 'true',
    TRUST_PROXY: parseTrustProxy(parsed.TRUST_PROXY),
    STORAGE_ROOT: path.resolve(process.cwd(), parsed.STORAGE_ROOT),
    WORKER_HEARTBEAT_KEY: 'docflow:worker:heartbeat',
};

/**
 * Create the persistent storage layout. Extracted from storage.service.ts so
 * that both the API and the worker entrypoints can guarantee the directories
 * exist before their first request/job, and so a read-only or unmounted volume
 * fails loudly at boot instead of at the first user upload.
 */
export function ensureStorageRootLayout(): void {
    const subdirs = ['uploads', 'jobs', 'temp'];
    fs.mkdirSync(env.STORAGE_ROOT, { recursive: true });
    for (const dir of subdirs) {
        fs.mkdirSync(path.join(env.STORAGE_ROOT, dir), { recursive: true });
    }
}
