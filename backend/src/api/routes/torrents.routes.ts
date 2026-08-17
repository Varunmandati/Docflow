import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import http from 'http';
import { env } from '../../config/env.js';

/**
 * Reverse proxy for the streamtor torrent server.
 *
 * The frontend calls `/api/torrents/*` (TorrentConverterView). In dev this is
 * proxied by Vite's dev server (vite.config.ts), which also injects the
 * `X-Internal-Token`. In production there is no Vite dev server, so the backend
 * must forward these calls itself. Streamtor stays bound to 127.0.0.1 inside
 * the container and is never publicly exposed — the backend is its only
 * network egress (matching the Stage 2 security boundary).
 *
 * Responses are streamed (not buffered) so large torrent file downloads with
 * Range requests work through the proxy. We hijack the Fastify reply and
 * manage the raw socket directly so no framework serialization interferes.
 */
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'content-length',
]);

function buildTargetUrl(request: FastifyRequest): URL {
    // request.url includes the path + query string, which we forward verbatim.
    return new URL(request.url, env.STREAMTOR_INTERNAL_URL);
}

function forwardRequest(request: FastifyRequest, reply: FastifyReply, target: URL) {
    // Take over the raw response socket. Without this Fastify tries to send its
    // own (empty) response after we have already written to reply.raw, which
    // throws ERR_HTTP_HEADERS_SENT and crashes the process.
    reply.hijack();

    const headers: Record<string, string> = {
        host: target.host,
    };

    for (const [key, value] of Object.entries(request.headers)) {
        if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
        if (key.toLowerCase() === 'host') continue;
        if (typeof value === 'string') headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value.join(', ');
    }

    // Inject the internal shared secret so streamtor accepts the request.
    if (env.STREAMTOR_INTERNAL_TOKEN) {
        headers['x-internal-token'] = env.STREAMTOR_INTERNAL_TOKEN;
    }

    const proxyReq = http.request(
        {
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: `${target.pathname}${target.search}`,
            method: request.method,
            headers,
        },
        (proxyRes) => {
            reply.raw.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(reply.raw);
        }
    );

    proxyReq.on('error', (err) => {
        request.log.error({ err }, 'Streamtor proxy upstream error');
        if (!reply.raw.headersSent) {
            reply.raw.writeHead(502, { 'content-type': 'application/json' });
        }
        reply.raw.end(JSON.stringify({ success: false, message: 'Torrent server unavailable.' }));
    });

    reply.raw.on('close', () => {
        if (!proxyReq.destroyed) proxyReq.destroy();
    });

    // Stream the incoming request body to the upstream (e.g. magnet JSON on
    // POST /api/torrents). Chunked transfer is fine for express on streamtor.
    request.raw.pipe(proxyReq);
}

export async function torrentProxyRoutes(app: FastifyInstance) {
    if (!env.STREAMTOR_INTERNAL_URL) {
        throw new Error('STREAMTOR_INTERNAL_URL is not configured');
    }

    app.all('/api/torrents', async (request, reply) => {
        forwardRequest(request, reply, buildTargetUrl(request));
    });

    app.all('/api/torrents/*', async (request, reply) => {
        forwardRequest(request, reply, buildTargetUrl(request));
    });
}