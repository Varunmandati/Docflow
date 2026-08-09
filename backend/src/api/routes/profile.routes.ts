import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyFirebaseToken } from '../../middleware/firebase.middleware.js';
import {
    ensureUserExists,
    storeProfilePicture,
    updateUserProfile,
    getUserProfile,
} from '../../services/profile.service.js';
import { auditService } from '../../services/audit.service.js';

const UpdateProfileSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.string().url().max(512).optional(),
});

interface AuthenticatedRequest {
    user: {
        uid: string;
        email?: string;
        name?: string;
        picture?: string;
    };
}

export async function profileRoutes(app: FastifyInstance) {
    app.post('/v1/profile/upload-picture', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const { user } = request as any as AuthenticatedRequest;
        if (!user.uid) {
            return reply.code(401).send({ success: false, message: 'Unauthorized.' });
        }

        try {
            await ensureUserExists({
                uid: user.uid,
                email: user.email,
                name: user.name,
                avatarUrl: user.picture,
            });

            let dataUrl = '';

            if (request.headers['content-type']?.includes('application/json')) {
                const body = request.body as any;
                if (!body || typeof body.pictureDataUrl !== 'string' || !body.pictureDataUrl.startsWith('data:image/')) {
                    return reply.code(400).send({ success: false, message: 'Valid image data is required.' });
                }
                if (body.pictureDataUrl.length > 2 * 1024 * 1024) {
                    return reply.code(400).send({ success: false, message: 'Image data exceeds 2 MB limit.' });
                }
                dataUrl = body.pictureDataUrl;
            } else {
                const file = await request.file();
                if (!file) {
                    return reply.code(400).send({ success: false, message: 'Image file is required.' });
                }
                if (!file.mimetype.startsWith('image/')) {
                    return reply.code(400).send({ success: false, message: 'Only image files are allowed.' });
                }
                if (file.file.truncated || (file.file.bytesRead ?? 0) > 2 * 1024 * 1024) {
                    return reply.code(400).send({ success: false, message: 'Image exceeds 2 MB limit.' });
                }
                const buffer = await file.toBuffer();
                dataUrl = `data:${file.mimetype};base64,${buffer.toString('base64')}`;
            }

            const result = await storeProfilePicture(user.uid, dataUrl, 3600);

            auditService.log({
                userId: user.uid,
                eventType: 'file.uploaded',
                severity: 'info',
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
                metadata: { kind: 'profile-picture' },
            });

            return reply.send({
                success: true,
                message: 'Picture uploaded successfully.',
                pictureId: result.pictureId,
                dataUrl,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Picture upload failed.';
            return reply.code(500).send({ success: false, message });
        }
    });

    app.get('/v1/profile', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const { user } = request as any as AuthenticatedRequest;
        if (!user.uid) {
            return reply.code(401).send({ success: false, message: 'Unauthorized.' });
        }

        try {
            const ensured = await ensureUserExists({
                uid: user.uid,
                email: user.email,
                name: user.name,
                avatarUrl: user.picture,
            });
            const profile = await getUserProfile(user.uid);
            return reply.send({
                success: true,
                profile: profile || {
                    id: ensured?.id,
                    email: user.email,
                    display_name: user.name,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch profile.';
            return reply.code(500).send({ success: false, message });
        }
    });

    app.put('/v1/profile', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const { user } = request as any as AuthenticatedRequest;
        if (!user.uid) {
            return reply.code(401).send({ success: false, message: 'Unauthorized.' });
        }

        const parsed = UpdateProfileSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
            });
        }

        try {
            await ensureUserExists({
                uid: user.uid,
                email: user.email,
                name: user.name,
                avatarUrl: user.picture,
            });
            await updateUserProfile(user.uid, parsed.data);
            const updated = await getUserProfile(user.uid);

            return reply.send({
                success: true,
                message: 'Profile updated successfully.',
                profile: updated,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Profile update failed.';
            return reply.code(500).send({ success: false, message });
        }
    });
}
