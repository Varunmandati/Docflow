import Fastify from 'fastify';
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
    });

    // Security headers
    await app.register(helmet, {
        global: true,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "blob:", "https:"],
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
            fileSize: 100 * 1024 * 1024, // 100MB
        },
    });

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

    await registerRoutes(app);
    return app;
}
