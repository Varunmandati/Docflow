import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyFirebaseToken } from '../../middleware/firebase.middleware.js';
import { ensureUserExists, generateEmailChangeOtp, verifyEmailChangeOtp } from '../../services/profile.service.js';
import { requestLoginOtp, verifyLoginOtp } from '../../services/otp-auth.service.js';

const ChangeEmailRequestSchema = z.object({
    oldEmail: z.string().email(),
    newEmail: z.string().email(),
});

const ChangeEmailVerifySchema = z.object({
    oldEmail: z.string().email(),
    newEmail: z.string().email(),
    otp: z.string().trim().min(4).max(12),
});

const OtpRequestSchema = z.object({
    email: z.string().email(),
    mode: z.enum(['login', 'signup']).optional(),
});

const OtpVerifySchema = z.object({
    email: z.string().email(),
    otp: z.string().trim().min(4).max(12),
    name: z.string().trim().max(128).optional(),
    mode: z.enum(['login', 'signup']).optional(),
});

export async function authRoutes(app: FastifyInstance) {
    app.post('/v1/auth/change-email', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const { user } = request;
        if (!user) {
            return reply.code(401).send({ success: false, message: 'Unauthorized.' });
        }
        const parsed = ChangeEmailRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
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
        const { user } = request;
        if (!user) {
            return reply.code(401).send({ success: false, message: 'Unauthorized.' });
        }
        const parsed = ChangeEmailVerifySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
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

    app.post('/v1/auth/otp/request', async (request, reply) => {
        const parsed = OtpRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
            });
        }

        try {
            const result = await requestLoginOtp(parsed.data.email, request.ip);
            return reply.send(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to send OTP.';
            return reply.code(400).send({ success: false, message });
        }
    });

    app.post('/v1/auth/otp/verify', async (request, reply) => {
        const parsed = OtpVerifySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid request payload.',
                details: parsed.error.flatten(),
            });
        }

        try {
            const result = await verifyLoginOtp(
                parsed.data.email,
                parsed.data.otp,
                parsed.data.name,
                request.ip
            );
            return reply.send(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to verify OTP.';
            return reply.code(400).send({ success: false, message });
        }
    });
}
