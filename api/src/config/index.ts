export interface Config {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  supergraphCacheTtl: number;
  nodeEnv: string;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://gqlfederation:gqlfederation@localhost:5432/gqlfederation',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production',
  supergraphCacheTtl: parseInt(process.env.SUPERGRAPH_CACHE_TTL || '300', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};

export default config;
