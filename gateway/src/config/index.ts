export interface GatewayConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  apiUrl: string;
  queryPlanCacheTtl: number;
  maxQueryDepth: number;
  maxComplexity: number;
  batchSize: number;
  grayscalePercent: number;
  grayscaleDuration: number;
  grayscaleErrorThreshold: number;
  nodeEnv: string;
}

export const config: GatewayConfig = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://gqlfederation:gqlfederation@localhost:5432/gqlfederation',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  queryPlanCacheTtl: parseInt(process.env.QUERY_PLAN_CACHE_TTL || '3600', 10),
  maxQueryDepth: parseInt(process.env.MAX_QUERY_DEPTH || '15', 10),
  maxComplexity: parseInt(process.env.MAX_COMPLEXITY || '1000', 10),
  batchSize: parseInt(process.env.BATCH_SIZE || '200', 10),
  grayscalePercent: parseInt(process.env.GRAYSCALE_PERCENT || '10', 10),
  grayscaleDuration: parseInt(process.env.GRAYSCALE_DURATION || '300', 10),
  grayscaleErrorThreshold: parseInt(process.env.GRAYSCALE_ERROR_THRESHOLD || '5', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};

export default config;
