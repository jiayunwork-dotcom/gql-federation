import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import config from './config';
import { getDbPool } from './db';
import { getRedisClient, cacheGet, cacheSet } from './cache';
import { getTenantConfig, getCurrentSupergraph } from './services/supergraph-loader';
import { planQuery, getQueryHash, buildQueryPlannerContext } from './services/query-planner';
import { executeSimpleQuery } from './services/query-executor';
import { validateQueryDepth, validateQueryComplexity, analyzeDepthAndComplexity } from './services/query-analysis';
import { shouldUseGrayscale, checkGrayscaleAutoRollback, checkGrayscaleAutoPromote } from './services/grayscale';
import { recordMetrics } from './services/metrics-recorder';

const QUERY_PLAN_CACHE_PREFIX = 'queryplan:';

export async function buildGateway() {
  const fastify = Fastify({
    logger: config.nodeEnv !== 'production',
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  });

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(fastifyRateLimit, {
    max: 5000,
    timeWindow: '1 minute',
  });

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.post('/graphql', async (request, reply) => {
    const tenantHeader = request.headers['x-tenant-id'] as string;
    if (!tenantHeader) {
      reply.status(400).send({ errors: [{ message: 'Missing X-Tenant-ID header' }] });
      return;
    }

    const tenant = await getTenantConfig(tenantHeader);
    if (!tenant) {
      reply.status(404).send({ errors: [{ message: `Tenant "${tenantHeader}" not found` }] });
      return;
    }

    const body = request.body as any;
    const { query, variables, operationName } = body;

    if (!query) {
      reply.status(400).send({ errors: [{ message: 'Query is required' }] });
      return;
    }

    const depthCheck = validateQueryDepth(query, tenant.maxQueryDepth);
    if (!depthCheck.valid) {
      reply.status(400).send({
        errors: [{
          message: depthCheck.error,
          extensions: { code: 'QUERY_DEPTH_EXCEEDED', maxDepth: tenant.maxQueryDepth, actualDepth: depthCheck.depth }
        }]
      });
      return;
    }

    const complexityCheck = validateQueryComplexity(query, tenant.maxComplexity);
    if (!complexityCheck.valid) {
      reply.status(400).send({
        errors: [{
          message: complexityCheck.error,
          extensions: { code: 'QUERY_COMPLEXITY_EXCEEDED', maxComplexity: tenant.maxComplexity, actualComplexity: complexityCheck.complexity }
        }]
      });
      return;
    }

    const supergraph = await getCurrentSupergraph(tenant.id);
    if (!supergraph) {
      reply.status(503).send({ errors: [{ message: 'No supergraph available' }] });
      return;
    }

    const useGrayscale = supergraph.status === 'grayscale' && shouldUseGrayscale(tenant.id, config.grayscalePercent);

    const authHeaders: Record<string, string> = {};
    const authHeader = request.headers.authorization;
    if (authHeader) {
      authHeaders['Authorization'] = authHeader;
    }

    const queryHash = getQueryHash(query, operationName);
    const planCacheKey = `${QUERY_PLAN_CACHE_PREFIX}${tenant.id}:${supergraph.id}:${queryHash}`;

    let queryPlan;
    const cachedPlan = await cacheGet(planCacheKey);
    if (cachedPlan) {
      queryPlan = cachedPlan;
    } else {
      try {
        const plannerContext = buildQueryPlannerContext(supergraph.subgraphs);
        queryPlan = planQuery(query, plannerContext);
        await cacheSet(planCacheKey, queryPlan, config.queryPlanCacheTtl);
      } catch (err: any) {
        reply.status(400).send({ errors: [{ message: `Query planning failed: ${err.message}` }] });
        return;
      }
    }

    const analysis = analyzeDepthAndComplexity(query, variables);
    const startTime = Date.now();

    const { result, metrics } = await executeSimpleQuery(
      query,
      supergraph.subgraphs,
      authHeaders,
      variables
    );

    const totalDurationMs = Date.now() - startTime;
    const hasErrors = !!result.errors && result.errors.length > 0;

    const responseSizeBytes = JSON.stringify(result.data || {}).length;

    setImmediate(async () => {
      try {
        await recordMetrics({
          tenantId: tenant.id,
          supergraphVersionId: supergraph.id,
          queryHash,
          queryText: query,
          operationName,
          totalDurationMs,
          responseSizeBytes,
          hasErrors,
          errorMessage: result.errors?.[0]?.message,
          subgraphMetrics: metrics,
          queryPlan,
          depth: analysis.depth,
          complexity: analysis.complexity,
          fields: analysis.fields,
        });

        if (supergraph.status === 'grayscale') {
          await checkGrayscaleAutoRollback(tenant.id);
          await checkGrayscaleAutoPromote(tenant.id);
        }
      } catch (err) {
        console.warn('Metrics recording failed:', err);
      }
    });

    result.extensions = {
      ...result.extensions,
      queryPlan,
      duration: totalDurationMs,
      depth: analysis.depth,
      complexity: analysis.complexity,
      supergraphVersion: supergraph.version,
      supergraphStatus: supergraph.status,
    };

    reply.type('application/json');
    return result;
  });

  fastify.post('/graphql/explain', async (request, reply) => {
    const tenantHeader = request.headers['x-tenant-id'] as string;
    if (!tenantHeader) {
      reply.status(400).send({ error: 'Missing X-Tenant-ID header' });
      return;
    }

    const tenant = await getTenantConfig(tenantHeader);
    if (!tenant) {
      reply.status(404).send({ error: 'Tenant not found' });
      return;
    }

    const body = request.body as any;
    const { query, operationName } = body;

    if (!query) {
      reply.status(400).send({ error: 'Query is required' });
      return;
    }

    const supergraph = await getCurrentSupergraph(tenant.id);
    if (!supergraph) {
      reply.status(503).send({ error: 'No supergraph available' });
      return;
    }

    try {
      const plannerContext = buildQueryPlannerContext(supergraph.subgraphs);
      const queryPlan = planQuery(query, plannerContext);
      const analysis = analyzeDepthAndComplexity(query);

      return {
        queryPlan,
        analysis,
        supergraphVersion: supergraph.version,
        subgraphs: supergraph.subgraphs.map(s => ({ name: s.name, url: s.routingUrl })),
      };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.setErrorHandler((error, request, reply) => {
    console.error('Gateway error:', error);
    reply.status(500).send({
      errors: [{ message: error.message || 'Internal Server Error' }],
    });
  });

  return fastify;
}

export async function startGateway() {
  try {
    getDbPool();
    getRedisClient();

    const gateway = await buildGateway();

    await gateway.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    console.log(`GraphQL Gateway listening on port ${config.port}`);
    console.log(`GraphQL endpoint: http://localhost:${config.port}/graphql`);
    console.log(`Health check: http://localhost:${config.port}/health`);

    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      await gateway.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to start gateway:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startGateway();
}

export default buildGateway;
