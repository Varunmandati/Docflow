/**
 * Vercel serverless adapter: routes /v1/* (and /health) into the existing
 * Fastify app via `app.inject()`.
 *
 * Why inject(): the backend is already a self-contained Fastify instance with
 * its own routing, validation, auth and error handling — wrapping it in an
 * inject-based request pipeline keeps every behaviour identical to the
 * long-running deployment instead of re-implementing the API surface.
 *
 * Path resolution is dual-mode because platforms disagree about what a
 * rewritten request looks like:
 *  - `/api/backend?p=/v1/convert&original=qs` — the explicit `p` param our
 *    vercel.json rewrites carry; the original query string is forwarded
 *    separately by the platform.
 *  - `/v1/convert?original=qs` — some runtimes keep the original URL intact;
 *    in that case `p` is absent and `req.url` is used as-is.
 * Both land on the same Fastify routes, so behaviour is identical either way.
 *
 * Imports resolve into backend/dist, which the build command produces before
 * the function is bundled (vercel.json buildCommand).
 */
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../backend/dist/api/server.js';
import { env } from '../backend/dist/config/env.js';
import { initializeFirebaseAdmin } from '../backend/dist/config/firebase.js';
import { redisReady } from '../backend/dist/queue/connection.js';
import { ensureStorageLayout } from '../backend/dist/services/storage.service.js';
import { runMigrations } from '../backend/dist/db/migrate.js';

interface AdapterRequest {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
    body?: unknown;
    // Present when the platform left the payload unparsed (multipart uploads).
    [key: string]: unknown;
}

interface AdapterResponse {
    statusCode?: number;
    setHeader(name: string, value: string): void;
    end(chunk?: unknown): void;
}

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
    if (!appPromise) {
        appPromise = (async () => {
            if (env.RUN_MIGRATIONS_ON_START) {
                await runMigrations();
            }
            initializeFirebaseAdmin();
            // Ephemeral workspaces only (STORAGE_ROOT=/tmp/... on Vercel) —
            // durable state lives in R2 + Postgres. Best-effort: the runtime
            // filesystem may be read-only outside /tmp, and per-job workspace
            // creation mkdirs on demand anyway.
            await ensureStorageLayout().catch(() => {});
            // Cold-start guard: `enableOfflineQueue: false` makes any Redis
            // command issued before the handshake finishes fail immediately.
            await Promise.race([
                redisReady,
                new Promise((resolve) => setTimeout(resolve, 8000)),
            ]);
            return buildServer();
        })();
        // A failed boot must not poison the singleton: reset so the next
        // invocation retries instead of replaying the same rejection forever.
        appPromise.catch(() => {
            appPromise = null;
        });
    }
    return appPromise;
}

const HOP_BY_HOP_HEADERS = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'accept-encoding',
    'keep-alive',
    'upgrade',
]);

function forwardHeaders(req: AdapterRequest): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers ?? {})) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) continue;
        out[lower] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return out;
}

function buildQuery(search: Record<string, string | string[] | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(key, item);
        } else {
            params.append(key, value);
        }
    }
    return params.toString();
}

function resolveTargetUrl(req: AdapterRequest): string {
    const query = req.query ?? {};
    const rawP = query.p;
    const p = Array.isArray(rawP) ? rawP[0] : rawP;

    if (p && p.startsWith('/')) {
        const forwarded: Record<string, string | string[] | undefined> = { ...query };
        delete forwarded.p;
        const qs = buildQuery(forwarded);
        return qs ? `${p}?${qs}` : p;
    }

    const url = req.url || '/';
    if (url.includes('?') || Object.keys(query).length === 0) {
        return url;
    }
    // `req.url` arrived without its query string — reattach what the platform
    // parsed separately.
    const qs = buildQuery(query);
    return qs ? `${url}?${qs}` : url;
}

async function readStream(stream: unknown): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function forwardPayload(req: AdapterRequest): Promise<Buffer | undefined> {
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
        return undefined;
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();

    if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'string') {
            return Buffer.from(req.body);
        }
        if (Buffer.isBuffer(req.body)) {
            return req.body;
        }
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(req.body as Record<string, unknown>)) {
                params.append(key, String(value));
            }
            return Buffer.from(params.toString());
        }
        // JSON (the default parse the platform performs).
        return Buffer.from(JSON.stringify(req.body));
    }

    if (method === 'GET' || method === 'HEAD') return undefined;

    // Unparsed bodies (multipart file uploads) arrive as the raw stream.
    return await readStream(req);
}

export default async function handler(req: AdapterRequest, res: AdapterResponse): Promise<void> {
    try {
        const app = await getApp();

        const method = String(req.method || 'GET').toUpperCase() as any;
        const url = resolveTargetUrl(req);
        const headers = forwardHeaders(req);
        const payload = await forwardPayload(req);

        const result = await app.inject({ method, url, headers, payload });

        res.statusCode = result.statusCode;
        for (const [key, value] of Object.entries(result.headers)) {
            if (value === undefined) continue;
            res.setHeader(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        res.end(result.rawPayload);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Serverless adapter failure';
        // Surface boot failures loudly instead of hanging the invocation.
        if (!res.statusCode || res.statusCode === 200) {
            res.statusCode = 500;
        }
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: 'Internal server error.', detail: message }));
    }
}
