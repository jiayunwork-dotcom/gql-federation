import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getCanaryById,
  getCanaryReleases,
  getActiveCanaryForSubgraph,
  startCanaryRelease,
  adjustCanaryPercent,
  rollbackCanary,
  fullReleaseCanary,
  getCanaryMetrics,
  checkCanaryAutoFullRelease,
} from '../services/canary-service';

const startCanarySchema = z.object({
  subgraphId: z.string(),
  newVersionId: z.string(),
  initialPercent: z.number().optional().default(10),
  errorRateThreshold: z.number().optional().default(5.0),
  autoFullReleaseHours: z.number().optional().default(24),
});

const adjustPercentSchema = z.object({
  newPercent: z.number(),
  reason: z.string().optional(),
});

const rollbackSchema = z.object({
  reason: z.string().optional(),
});

const fullReleaseSchema = z.object({
  reason: z.string().optional(),
});

const querySchema = z.object({
  subgraphId: z.string().optional(),
  status: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  limit: z.coerce.number().optional().default(20),
  offset: z.coerce.number().optional().default(0),
});

export default async function canaryRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = querySchema.parse(request.query);
      const tenantId = (request as any).tenantId;

      const result = await getCanaryReleases(tenantId, {
        subgraphId: query.subgraphId,
        status: query.status,
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        limit: query.limit,
        offset: query.offset,
      });

      return { success: true, data: result.rows, total: result.total };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/active/:subgraphId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { subgraphId } = request.params as { subgraphId: string };
      const tenantId = (request as any).tenantId;

      const canary = await getActiveCanaryForSubgraph(subgraphId, tenantId);

      return { success: true, data: canary };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/:canaryId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { canaryId } = request.params as { canaryId: string };
      const tenantId = (request as any).tenantId;

      const canary = await getCanaryById(canaryId, tenantId);

      if (!canary) {
        reply.status(404).send({ success: false, error: 'Canary release not found' });
        return;
      }

      return { success: true, data: canary };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = startCanarySchema.parse(request.body);
      const tenantId = (request as any).tenantId;
      const user = (request as any).user;

      const canary = await startCanaryRelease({
        tenantId,
        subgraphId: body.subgraphId,
        newVersionId: body.newVersionId,
        startedBy: user?.name || user?.email || 'unknown',
        initialPercent: body.initialPercent,
        errorRateThreshold: body.errorRateThreshold,
        autoFullReleaseHours: body.autoFullReleaseHours,
      });

      return { success: true, data: canary };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.put('/:canaryId/percent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { canaryId } = request.params as { canaryId: string };
      const body = adjustPercentSchema.parse(request.body);
      const tenantId = (request as any).tenantId;
      const user = (request as any).user;

      const canary = await adjustCanaryPercent({
        canaryId,
        tenantId,
        newPercent: body.newPercent,
        operator: user?.name || user?.email || 'unknown',
        reason: body.reason,
      });

      return { success: true, data: canary };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.post('/:canaryId/rollback', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { canaryId } = request.params as { canaryId: string };
      const body = rollbackSchema.parse(request.body);
      const tenantId = (request as any).tenantId;
      const user = (request as any).user;

      const canary = await rollbackCanary({
        canaryId,
        tenantId,
        operator: user?.name || user?.email || 'unknown',
        reason: body.reason,
      });

      return { success: true, data: canary };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.post('/:canaryId/full-release', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { canaryId } = request.params as { canaryId: string };
      const body = fullReleaseSchema.parse(request.body);
      const tenantId = (request as any).tenantId;
      const user = (request as any).user;

      const canary = await fullReleaseCanary({
        canaryId,
        tenantId,
        operator: user?.name || user?.email || 'unknown',
        reason: body.reason,
      });

      return { success: true, data: canary };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/:canaryId/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { canaryId } = request.params as { canaryId: string };
      const tenantId = (request as any).tenantId;

      const metrics = await getCanaryMetrics(canaryId, tenantId);

      return { success: true, data: metrics };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/:canaryId/auto-full-release-check', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { canaryId } = request.params as { canaryId: string };
      const tenantId = (request as any).tenantId;

      const canFullRelease = await checkCanaryAutoFullRelease(canaryId, tenantId);

      return { success: true, data: { canFullRelease } };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });
}
