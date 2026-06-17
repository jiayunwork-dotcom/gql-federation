import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { getVersionsTimeline, getVersionDetail, compareVersions } from '../services/version-management-service';

const queryTimelineSchema = z.object({
  subgraphId: z.string().optional(),
  subgraphName: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
});

const compareVersionsSchema = z.object({
  versionId1: z.string(),
  versionId2: z.string(),
});

export default async function versionManagementRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);
  fastify.get('/timeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = queryTimelineSchema.parse(request.query);
      const tenantId = (request as any).tenantId;

      const result = await getVersionsTimeline({
        tenantId,
        subgraphId: query.subgraphId,
        subgraphName: query.subgraphName,
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        limit: query.limit,
      });

      return { success: true, data: result };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/:versionId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { versionId } = request.params as { versionId: string };
      const tenantId = (request as any).tenantId;

      const version = await getVersionDetail(versionId, tenantId);

      if (!version) {
        reply.status(404).send({ success: false, error: 'Version not found' });
        return;
      }

      return { success: true, data: version };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.post('/compare', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = compareVersionsSchema.parse(request.body);
      const tenantId = (request as any).tenantId;

      const result = await compareVersions(body.versionId1, body.versionId2, tenantId);

      return { success: true, data: result };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });
}
