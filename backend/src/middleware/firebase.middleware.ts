import { FastifyRequest, FastifyReply } from 'fastify';
import { getFirebaseAdmin } from '../config/firebase.js';
import { getAuth } from 'firebase-admin/auth';
import type { DecodedIdToken } from 'firebase-admin/auth';

export async function verifyFirebaseToken(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ success: false, message: 'Unauthorized: Missing or invalid token format' });
    }

    const token = authHeader.split('Bearer ')[1];

    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
        return reply.code(500).send({ success: false, message: 'Internal Server Error: Auth service not configured' });
    }

    try {
        const decodedToken = await getAuth(adminApp).verifyIdToken(token);
        // Attach decoded token to request for downstream handlers
        request.user = decodedToken;
    } catch (error) {
        request.log.error({ err: error }, 'Firebase token verification failed');
        return reply.code(401).send({ success: false, message: 'Unauthorized: Invalid or expired token' });
    }
}

export async function extractFirebaseUser(request: FastifyRequest): Promise<DecodedIdToken | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.split('Bearer ')[1];
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return null;

    try {
        return await getAuth(adminApp).verifyIdToken(token);
    } catch {
        return null;
    }
}
