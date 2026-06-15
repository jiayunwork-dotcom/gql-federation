import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import {
  getSubgraphsByTenant,
  getSubgraphById,
  getSchemaVersions,
  getSchemaVersionById,
  createSubgraph,
  updateSubgraphSchema,
  rollbackSchemaVersion,
  deleteSubgraph,
  updateSubgraphMetadata,
} from '../services/subgraph-service';
import { composeAndPublishSupergraph } from '../services/supergraph-service';

export default async function subgraphRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const subgraphs = await getSubgraphsByTenant(tenantId);
    return { subgraphs };
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    const subgraph = await getSubgraphById(id, tenantId);
    
    if (!subgraph) {
      reply.status(404).send({ error: 'Subgraph not found' });
      return;
    }
    
    return { subgraph };
  });

  fastify.post('/', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;
    
    try {
      const result = await createSubgraph({
        tenantId,
        name: body.name,
        routingUrl: body.routingUrl,
        ownerTeam: body.ownerTeam,
        description: body.description,
        sdl: body.sdl,
        publishedBy: user.email,
      });

      await composeAndPublishSupergraph(tenantId, user.email);

      reply.status(201).send(result);
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.put('/:id', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;
    
    try {
      const subgraph = await updateSubgraphMetadata(id, tenantId, {
        routingUrl: body.routingUrl,
        ownerTeam: body.ownerTeam,
        description: body.description,
        isActive: body.isActive,
      });
      return { subgraph };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.delete('/:id', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    const user = request.user!;
    
    await deleteSubgraph(id, tenantId);
    await composeAndPublishSupergraph(tenantId, user.email);
    
    reply.status(204).send();
  });

  fastify.get('/:id/versions', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const versions = await getSchemaVersions(id, 50);
    return { versions };
  });

  fastify.get('/:id/versions/:versionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { versionId } = request.params as { versionId: string };
    const version = await getSchemaVersionById(versionId);
    
    if (!version) {
      reply.status(404).send({ error: 'Schema version not found' });
      return;
    }
    
    return { version };
  });

  fastify.post('/:id/schema', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;
    
    try {
      const result = await updateSubgraphSchema({
        subgraphId: id,
        tenantId,
        sdl: body.sdl,
        publishedBy: user.email,
      });

      if (result.compositionSuccess) {
        await composeAndPublishSupergraph(tenantId, user.email);
      }

      return result;
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/versions/:versionId/rollback', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    const tenantId = request.tenantId!;
    const user = request.user!;
    
    try {
      const result = await rollbackSchemaVersion(id, versionId, tenantId);
      if (result.success) {
        await composeAndPublishSupergraph(tenantId, user.email);
      }
      return result;
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });
}
