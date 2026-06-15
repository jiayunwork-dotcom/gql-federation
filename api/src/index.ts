import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import config from './config';
import { getDbPool } from './db';
import { getRedisClient } from './cache';
import { ensureDefaultAdmin } from './services/auth-service';

import authRoutes from './routes/auth';
import tenantRoutes from './routes/tenants';
import subgraphRoutes from './routes/subgraphs';
import supergraphRoutes from './routes/supergraph';
import metricsRoutes from './routes/metrics';
import alertRoutes from './routes/alerts';

export async function buildApp() {
  const fastify = Fastify({
    logger: config.nodeEnv !== 'production',
    trustProxy: true,
  });

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(fastifyRateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.register(authRoutes, { prefix: '/api/auth' });
  fastify.register(tenantRoutes, { prefix: '/api/tenants' });
  fastify.register(subgraphRoutes, { prefix: '/api/subgraphs' });
  fastify.register(supergraphRoutes, { prefix: '/api/supergraph' });
  fastify.register(metricsRoutes, { prefix: '/api/metrics' });
  fastify.register(alertRoutes, { prefix: '/api/alerts' });

  fastify.setErrorHandler((error, request, reply) => {
    console.error('Error:', error);
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: error.message || 'Internal Server Error',
      statusCode,
    });
  });

  return fastify;
}

export async function startServer() {
  try {
    getDbPool();
    getRedisClient();

    await ensureDefaultAdmin();

    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    console.log(`API server listening on port ${config.port}`);
    console.log(`Health check: http://localhost:${config.port}/health`);

    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      await app.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

export default buildApp;
