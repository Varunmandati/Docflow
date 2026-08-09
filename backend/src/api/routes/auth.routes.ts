import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyFirebaseToken } from '../../middleware/firebase.middleware.js';
import { ensureUserExists, generateEmailChangeOtp, verifyEmailChangeOtp } from '../../services/profile.service.js';

const ChangeEmailRequestSchema = z.object({
    oldEmail: z.string().email(),
    newEmail: z.string().email(),
});

const ChangeEmailVerifySchema = z.object({
    oldEmail: z.string().email(),
    newEmail: z.string().email(),
    otp: z.string().trim().min(4).max(12),
});

interface AuthenticatedRequest {
    user: { uid: string; email?: string; name?: string; picture?: string };
}

export async function authRoutes(app: FastifyInstance) {
    app.post('/v1/auth/change-email', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const { user } = request as any as AuthenticatedRequest;
        const parsed = ChangeEmailRequestSchema.safeParse(request.body);
        if (!parsed.success || !user.uid) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.success ? undefined : parsed.error.flatten(),
            });
        }

        try {
            await ensureUserExists({ uid: user.uid, email: user.email, name: user.name, avatarUrl: user.picture });
            const { oldEmail, newEmail } = parsed.data;
            const result = await generateEmailChangeOtp(user.uid, oldEmail, newEmail);
            return reply.send(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to request email change OTP.';
            return reply.code(400).send({ success: false, message });
        }
    });

    app.post('/v1/auth/verify-email-change', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const { user } = request as any as AuthenticatedRequest;
        const parsed = ChangeEmailVerifySchema.safeParse(request.body);
        if (!parsed.success || !user.uid) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.success ? undefined : parsed.error.flatten(),
            });
        }

        try {
            await ensureUserExists({ uid: user.uid, email: user.email, name: user.name, avatarUrl: user.picture });
            const { oldEmail, newEmail, otp } = parsed.data;
            const result = await verifyEmailChangeOtp(user.uid, oldEmail, newEmail, otp);
            
            // Note: verification updates DB, so we can return success and the updated email
            return reply.send({
                ...result,
                newEmail
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to verify email change OTP.';
            return reply.code(400).send({ success: false, message });
        }
    });
}
