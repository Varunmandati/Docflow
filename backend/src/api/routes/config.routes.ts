import { FastifyInstance } from 'fastify';
import { conversionMatrix } from '../../config/conversion-matrix.js';

export async function configRoutes(fastify: FastifyInstance) {
    fastify.get('/matrix', async (request, reply) => {
        return reply.send({
            success: true,
            matrix: conversionMatrix
        });
    });
}
