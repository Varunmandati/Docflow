import path from 'path';
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
    JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
    JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    CORS_ORIGIN: z.string().default('*'),
    STREAMTOR_INTERNAL_URL: z.string().default('http://127.0.0.1:3002'),
    STREAMTOR_INTERNAL_TOKEN: z.string().optional(),
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
    DB_POOL_MIN: z.string().default('2'),
    DB_POOL_MAX: z.string().default('10'),
    DB_IDLE_TIMEOUT_MS: z.string().default('30000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
});

const parsed = EnvSchema.parse(process.env);

export const env = {
    ...parsed,
    RUN_INLINE_WORKERS: parsed.RUN_INLINE_WORKERS === 'true',
    STORAGE_ROOT: path.resolve(process.cwd(), parsed.STORAGE_ROOT),
};
