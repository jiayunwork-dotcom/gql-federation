import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { computeSchemaDiff, getDiffableVersions } from '../services/schema-diff-service';

export default async function schemaDiffRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/versions/:subgraphId', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const versions = await getDiffableVersions(subgraphId);
    return { versions };
  });

  fastify.get('/compare', async (request: FastifyRequest, reply: FastifyReply) => {
    const { leftVersionId, rightVersionId } = request.query as { leftVersionId?: string; rightVersionId?: string };

    if (!leftVersionId || !rightVersionId) {
      reply.status(400).send({ error: 'Both leftVersionId and rightVersionId are required' });
      return;
    }

    try {
      const diff = await computeSchemaDiff(leftVersionId, rightVersionId);
      return { diff };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });
}
