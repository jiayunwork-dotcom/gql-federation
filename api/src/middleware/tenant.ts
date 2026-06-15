import { FastifyRequest, FastifyReply } from 'fastify';
import { getTenantByName } from '../services/tenant-service';

export async function tenantMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const tenantHeader = request.headers['x-tenant-id'] as string;
  
  if (!tenantHeader) {
    return reply.status(400).send({ error: 'Missing X-Tenant-ID header' });
  }

  const tenant = await getTenantByName(tenantHeader);
  if (!tenant) {
    return reply.status(404).send({ error: `Tenant "${tenantHeader}" not found` });
  }

  if (!tenant.is_active) {
    return reply.status(403).send({ error: `Tenant "${tenantHeader}" is disabled` });
  }

  request.tenantId = tenant.id;
  request.tenant = tenant;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: {
      id: string;
      name: string;
      display_name: string;
      is_active: boolean;
      max_query_depth: number;
      max_complexity: number;
      max_schema_size_kb: number;
      max_supergraph_size_kb: number;
    };
  }
}

export default tenantMiddleware;
