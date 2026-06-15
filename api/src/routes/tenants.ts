import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth';
import {
  getAllTenants,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
} from '../services/tenant-service';

export default async function tenantRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [authMiddleware, superAdminMiddleware] }, async (request: FastifyRequest) => {
    const tenants = await getAllTenants();
    return { tenants };
  });

  fastify.get('/:id', { preHandler: [authMiddleware, superAdminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenant = await getTenantById(id);
    
    if (!tenant) {
      reply.status(404).send({ error: 'Tenant not found' });
      return;
    }
    
    return { tenant };
  });

  fastify.post('/', { preHandler: [authMiddleware, superAdminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    
    try {
      const tenant = await createTenant({
        name: body.name,
        displayName: body.displayName,
        maxQueryDepth: body.maxQueryDepth,
        maxComplexity: body.maxComplexity,
        maxSchemaSizeKb: body.maxSchemaSizeKb,
        maxSupergraphSizeKb: body.maxSupergraphSizeKb,
        settings: body.settings,
      });
      reply.status(201).send({ tenant });
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.put('/:id', { preHandler: [authMiddleware, superAdminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    
    try {
      const tenant = await updateTenant(id, body);
      return { tenant };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.delete('/:id', { preHandler: [authMiddleware, superAdminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await deleteTenant(id);
    reply.status(204).send();
  });
}
