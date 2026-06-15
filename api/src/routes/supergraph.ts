import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import {
  getCurrentSupergraph,
  getSupergraphById,
  getSupergraphVersions,
  composeAndPublishSupergraph,
  promoteGrayscaleToActive,
  rollbackSupergraph,
  getCompositionLogs,
} from '../services/supergraph-service';

export default async function supergraphRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/current', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const supergraph = await getCurrentSupergraph(tenantId);
    return { supergraph };
  });

  fastify.get('/', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const { limit = 20 } = request.query as { limit?: number };
    const versions = await getSupergraphVersions(tenantId, limit);
    return { versions };
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    const supergraph = await getSupergraphById(id, tenantId);
    
    if (!supergraph) {
      reply.status(404).send({ error: 'Supergraph version not found' });
      return;
    }
    
    return { supergraph };
  });

  fastify.post('/compose', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId!;
    const user = request.user!;
    
    try {
      const result = await composeAndPublishSupergraph(tenantId, user.email);
      
      if (!result.success) {
        reply.status(400).send(result);
        return;
      }
      
      return result;
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/promote', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    
    const result = await promoteGrayscaleToActive(id, tenantId);
    
    if (!result) {
      reply.status(400).send({ error: 'Failed to promote supergraph' });
      return;
    }
    
    return { supergraph: result };
  });

  fastify.post('/:id/rollback', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    const user = request.user!;
    
    try {
      const result = await rollbackSupergraph(id, tenantId, user.email);
      return { supergraph: result };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.get('/composition/logs', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const { limit = 50 } = request.query as { limit?: number };
    const logs = await getCompositionLogs(tenantId, limit);
    return { logs };
  });
}
