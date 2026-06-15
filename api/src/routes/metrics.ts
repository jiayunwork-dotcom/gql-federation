import { FastifyInstance, FastifyRequest } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import {
  recordQueryMetric,
  getSubgraphHealth,
  getFieldUsageStats,
  getQueryMetricsSummary,
  getTopQueries,
} from '../services/metrics-service';

export default async function metricsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/overview', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - 24);

    const summary = await getQueryMetricsSummary(tenantId, startDate, endDate);
    const subgraphHealth = await getSubgraphHealth(tenantId, 60);
    const topQueries = await getTopQueries(tenantId, 10);

    return {
      summary,
      subgraphHealth,
      topQueries,
    };
  });

  fastify.get('/subgraphs', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const { window = 60 } = request.query as { window?: number };
    const health = await getSubgraphHealth(tenantId, window);
    return { subgraphHealth: health };
  });

  fastify.get('/fields', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const { limit = 50 } = request.query as { limit?: number };
    const usage = await getFieldUsageStats(tenantId, limit);
    return { fieldUsage: usage };
  });

  fastify.get('/queries/top', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const { limit = 10 } = request.query as { limit?: number };
    const queries = await getTopQueries(tenantId, limit);
    return { queries };
  });

  fastify.post('/record', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const body = request.body as any;
    
    await recordQueryMetric({
      tenantId,
      supergraphVersionId: body.supergraphVersionId,
      queryHash: body.queryHash,
      queryText: body.queryText,
      operationName: body.operationName,
      totalDurationMs: body.totalDurationMs,
      responseSizeBytes: body.responseSizeBytes,
      hasErrors: body.hasErrors,
      errorMessage: body.errorMessage,
      subgraphMetrics: body.subgraphMetrics || [],
      queryPlan: body.queryPlan,
      depth: body.depth,
      complexity: body.complexity,
      fields: body.fields,
    });
    
    return { success: true };
  });
}
