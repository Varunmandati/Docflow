import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { verifyFirebaseToken } from '../../middleware/firebase.middleware.js';

// Server-side proxy for Gemini filename suggestion. The client never holds
// the API key; it posts the first-page image and the backend calls Gemini
// using GEMINI_API_KEY from its own environment.
const SuggestFilenameSchema = z.object({
    imageBase64: z.string().min(1),
    mimeType: z.string().default('image/jpeg'),
    prompt: z.string().min(1),
});

export async function aiRoutes(app: FastifyInstance) {
    app.post('/v1/ai/suggest-filename', { preHandler: [verifyFirebaseToken] }, async (request, reply) => {
        const parsed = SuggestFilenameSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ success: false, message: 'Invalid request body.' });
        }

        if (!env.GEMINI_API_KEY) {
            return reply.code(503).send({ success: false, message: 'AI suggestion is not configured.' });
        }

        const { imageBase64, mimeType, prompt } = parsed.data;

        try {
            const response = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': env.GEMINI_API_KEY,
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [
                                    { inlineData: { mimeType, data: imageBase64 } },
                                    { text: prompt },
                                ],
                            },
                        ],
                    }),
                    signal: AbortSignal.timeout(10000),
                }
            );

            if (!response.ok) {
                const detail = await response.text();
                console.error('Gemini suggestion failed:', response.status, detail.slice(0, 500));
                return reply.code(502).send({ success: false, message: 'AI suggestion failed.' });
            }

            const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
            const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join(' ') || '';
            return reply.send({ success: true, suggestion: text });
        } catch (error) {
            console.error('Gemini suggestion error:', error);
            return reply.code(502).send({ success: false, message: 'AI suggestion failed.' });
        }
    });
}
