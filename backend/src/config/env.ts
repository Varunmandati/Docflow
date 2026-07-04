import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('0.0.0.0'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    STORAGE_ROOT: z.string().default('./storage'),
    SOFFICE_BINARY: z.string().default('soffice'),
    PDFTOPPM_BINARY: z.string().default('pdftoppm'),
    PDFTOTEXT_BINARY: z.string().default('pdftotext'),
    PDF2HTMLEX_BINARY: z.string().default('pdf2htmlEX'),
    CONVERSION_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
    JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
    JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    SMTP_HOST: z.string().default('smtp.gmail.com'),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().min(1),
    SMTP_PASS: z.string().min(1),
    SMTP_FROM: z.string().min(1),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    AUTH_TOKEN_SECRET: z.string().min(16).default('docflow_dev_auth_secret_2026'),
    REFRESH_TOKEN_SECRET: z.string().min(16).default('docflow_dev_refresh_secret_2026'),
    DATABASE_URL: z.string().url(),
    DATABASE_URL_WORKER: z.string().url(),
    DB_POOL_MIN: z.string().default('2'),
    DB_POOL_MAX: z.string().default('10'),
    DB_IDLE_TIMEOUT_MS: z.string().default('30000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = EnvSchema.parse(process.env);

export const env = {
    ...parsed,
    STORAGE_ROOT: path.resolve(process.cwd(), parsed.STORAGE_ROOT),
};
