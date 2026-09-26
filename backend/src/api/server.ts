import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from '../config/env.js';
import { registerRoutes } from './routes.js';

export async function buildServer() {
    const app = Fastify({
        logger: false,
        // Secure JSON body limit for general requests
        bodyLimit: 2 * 1024 * 1024, // 2MB
        trustProxy: env.TRUST_PROXY,
    });

    // Security headers
    await app.register(helmet, {
        global: true,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // This server also serves the built SPA (fastifyStatic below), so
                // the policy has to permit exactly what index.html already
                // references. index.html pulls Tailwind, PDF.js, JSZip, jsPDF,
                // tiff.js and WebClient from CDNs, loads Google Fonts, carries
                // two inline <script> blocks (Tailwind runtime config + import
                // map), and calls Firebase Identity Toolkit for auth. With the
                // previous 'self'-only policy those were all blocked, so the
                // page Fastify served compiled down to a blank, unstyled shell.
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdn.tailwindcss.com",
                    "https://unpkg.com",
                    "https://cdnjs.cloudflare.com",
                    "https://cdn.jsdelivr.net",
                    "https://aistudiocdn.com",
                    "https://www.gstatic.com",
                ],
                // 'unsafe-inline' was already helmet's default for styles;
                // fonts.googleapis.com serves Space Grotesk / JetBrains Mono.
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "blob:", "https:"],
                mediaSrc: ["'self'", "blob:", "data:"],
                workerSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
                // 'self' covers the API in same-origin (all-in-one container)
                // deployments; the Google endpoints are Firebase Auth token
                // exchange/refresh; the remaining entries cover a separately
                // hosted API when CORS_ORIGIN lists its origin.
                connectSrc: [
                    "'self'",
                    "https://identitytoolkit.googleapis.com",
                    "https://securetoken.googleapis.com",
                    "https://firebase.googleapis.com",
                    "https://www.googleapis.com",
                    "https://*.googleapis.com",
                    ...(env.CORS_ORIGIN === '*'
                        ? []
                        : env.CORS_ORIGIN
                            .split(',')
                            .map((value) => value.trim())
                            .filter((value) => value.startsWith('http'))),
                ],
            }
        },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        }
    });

    await app.register(cors, {
        // Explicit allowlist from CORS_ORIGIN (comma-separated) when configured.
        // A reflective wildcard ('*' => true) is safe here only because the API
        // authenticates via Authorization: Bearer headers, NOT cookies - so the
        // OPEN-CORS + credentials:true combination the audit flagged is removed
        // by keeping credentials strictly false.
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean),
        credentials: false,
    });

    await app.register(cookie);

    await app.register(multipart, {
        limits: {
            // Keep higher limits specifically for file uploads
            fileSize: env.MAX_UPLOAD_BYTES,
        },
    });

    // Swagger docs are dev-only: never expose the API surface in production.
    if (process.env.NODE_ENV !== 'production') {
        await app.register(swagger, {
            openapi: {
                info: {
                    title: 'DocFlow API',
                    description: 'API documentation for DocFlow Conversion and Processing system',
                    version: '1.0.0'
                },
                components: {
                    securitySchemes: {
                        cookieAuth: {
                            type: 'apiKey',
                            name: 'accessToken',
                            in: 'cookie',
                        }
                    }
                }
            }
        });

        await app.register(swaggerUi, {
            routePrefix: '/docs',
            uiConfig: {
                docExpansion: 'list',
                deepLinking: false
            },
        });
    }

    await registerRoutes(app);

    await app.register(fastifyStatic, {
        root: path.resolve(process.cwd(), 'dist'),
        wildcard: true,
        index: 'index.html',
    });

    app.setNotFoundHandler(async (request, reply) => {
        if (
            request.method === 'GET' &&
            request.headers.accept?.includes('text/html') &&
            !request.url.startsWith('/api/')
        ) {
            return reply.sendFile('index.html');
        }

        return reply.code(404).send({
            message: 'Route not found',
            error: 'Not Found',
            statusCode: 404,
        });
    });
    return app;
}

