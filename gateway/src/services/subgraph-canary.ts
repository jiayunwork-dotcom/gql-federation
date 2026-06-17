import { cacheGet } from '../cache';
import { query } from '../db';

const CANARY_CONFIG_PREFIX = 'canary:config:';
const CANARY_METRICS_PREFIX = 'canary:metrics:';

export interface CanaryConfig {
  canaryId: string;
  status: string;
  currentPercent: number;
  oldVersionId: string;
  newVersionId: string;
  oldVersionString: string;
  newVersionString: string;
  errorRateThreshold: number;
  updatedAt: string;
}

export interface CanaryVersionSDL {
  oldVersion: {
    id: string;
    versionString: string;
    sdl: string;
  };
  newVersion: {
    id: string;
    versionString: string;
    sdl: string;
  };
}

export async function getCanaryConfig(
  tenantId: string,
  subgraphId: string
): Promise<CanaryConfig | null> {
  const key = `${CANARY_CONFIG_PREFIX}${tenantId}:${subgraphId}`;
  const config = await cacheGet<CanaryConfig>(key);
  return config;
}

export async function shouldUseNewVersion(
  tenantId: string,
  subgraphId: string
): Promise<{ useNew: boolean; config: CanaryConfig | null }> {
  const config = await getCanaryConfig(tenantId, subgraphId);
  
  if (!config || config.status !== 'canary' || config.currentPercent <= 0) {
    return { useNew: false, config: null };
  }

  const random = Math.random() * 100;
  const useNew = random < config.currentPercent;

  return { useNew, config };
}

export async function getSubgraphVersionsForCanary(
  subgraphId: string,
  oldVersionId: string,
  newVersionId: string
): Promise<CanaryVersionSDL> {
  const oldResult = await query<any>(
    'SELECT id, sdl, version_string FROM schema_versions WHERE id = $1',
    [oldVersionId]
  );

  const newResult = await query<any>(
    'SELECT id, sdl, version_string FROM schema_versions WHERE id = $1',
    [newVersionId]
  );

  if (oldResult.rows.length === 0 || newResult.rows.length === 0) {
    throw new Error('Version not found');
  }

  return {
    oldVersion: {
      id: oldResult.rows[0].id,
      versionString: oldResult.rows[0].version_string || `v${oldResult.rows[0].version}.0.0`,
      sdl: oldResult.rows[0].sdl,
    },
    newVersion: {
      id: newResult.rows[0].id,
      versionString: newResult.rows[0].version_string || `v${newResult.rows[0].version}.0.0`,
      sdl: newResult.rows[0].sdl,
    },
  };
}

export async function recordCanaryRequest(
  tenantId: string,
  subgraphId: string,
  canaryId: string,
  versionType: 'old' | 'new',
  hasError: boolean,
  durationMs: number
): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setSeconds(0, 0);
  const windowEnd = new Date(windowStart.getTime() + 60 * 1000);

  try {
    await query(
      `INSERT INTO canary_metrics 
       (tenant_id, canary_release_id, subgraph_id, version_type, 
        request_count, error_count, avg_latency_ms, window_start, window_end)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8)
       ON CONFLICT (canary_release_id, version_type, window_start) 
       DO UPDATE SET 
         request_count = canary_metrics.request_count + 1,
         error_count = canary_metrics.error_count + $5,
         avg_latency_ms = (
           (canary_metrics.avg_latency_ms * canary_metrics.request_count) + $6
         ) / (canary_metrics.request_count + 1)`,
      [
        tenantId,
        canaryId,
        subgraphId,
        versionType,
        hasError ? 1 : 0,
        durationMs,
        windowStart,
        windowEnd,
      ]
    );
  } catch (err) {
    console.warn('Failed to record canary metrics:', err);
  }
}

export default {
  getCanaryConfig,
  shouldUseNewVersion,
  getSubgraphVersionsForCanary,
  recordCanaryRequest,
};
