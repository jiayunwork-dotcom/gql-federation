import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { buildDependencyGraph } from '../services/dependency-graph-service';

export default async function dependencyGraphRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/', async (request) => {
    const tenantId = request.tenantId!;
    const graph = await buildDependencyGraph(tenantId);
    return { graph };
  });
}
