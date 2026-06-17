import { query } from '../db';
import { getRedisClient, cacheGet, cacheSet, cacheDel } from '../cache';
import { CanaryRelease, CanaryMetricsSummary, PercentHistoryItem } from '../types';
import { getSubgraphById, getSchemaVersionById, getActiveSchemaVersion } from './subgraph-service';
import { notificationService } from './notification-service';

const CANARY_REDIS_PREFIX = 'canary:config:';
const VALID_PERCENTS = [10, 25, 50, 75, 100];

export interface StartCanaryInput {
  tenantId: string;
  subgraphId: string;
  newVersionId: string;
  startedBy: string;
  initialPercent?: number;
  errorRateThreshold?: number;
  autoFullReleaseHours?: number;
}

export interface AdjustCanaryPercentInput {
  canaryId: string;
  tenantId: string;
  newPercent: number;
  operator: string;
  reason?: string;
}

export interface RollbackCanaryInput {
  canaryId: string;
  tenantId: string;
  operator: string;
  reason?: string;
}

export interface FullReleaseCanaryInput {
  canaryId: string;
  tenantId: string;
  operator: string;
  reason?: string;
}

export async function getActiveCanaryForSubgraph(
  subgraphId: string,
  tenantId: string
): Promise<CanaryRelease | null> {
  const result = await query<CanaryRelease>(
    `SELECT * FROM canary_releases 
     WHERE subgraph_id = $1 AND tenant_id = $2 AND status IN ('pending', 'canary')
     ORDER BY created_at DESC LIMIT 1`,
    [subgraphId, tenantId]
  );
  return result.rows[0] || null;
}

export async function getCanaryById(
  canaryId: string,
  tenantId: string
): Promise<CanaryRelease | null> {
  const result = await query<CanaryRelease>(
    'SELECT * FROM canary_releases WHERE id = $1 AND tenant_id = $2',
    [canaryId, tenantId]
  );
  return result.rows[0] || null;
}

export async function getCanaryReleases(
  tenantId: string,
  options: {
    subgraphId?: string;
    status?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ rows: CanaryRelease[]; total: number }> {
  const { subgraphId, status, startTime, endTime, limit = 20, offset = 0 } = options;

  let whereClause = 'WHERE tenant_id = $1';
  const params: any[] = [tenantId];
  let paramIndex = 2;

  if (subgraphId) {
    whereClause += ` AND subgraph_id = $${paramIndex++}`;
    params.push(subgraphId);
  }

  if (status) {
    whereClause += ` AND status = $${paramIndex++}`;
    params.push(status);
  }

  if (startTime) {
    whereClause += ` AND created_at >= $${paramIndex++}`;
    params.push(startTime);
  }

  if (endTime) {
    whereClause += ` AND created_at <= $${paramIndex++}`;
    params.push(endTime);
  }

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM canary_releases ${whereClause}`,
    params
  );

  const dataResult = await query<CanaryRelease>(
    `SELECT * FROM canary_releases ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  return {
    rows: dataResult.rows,
    total: parseInt(countResult.rows[0]?.count || '0', 10),
  };
}

export async function startCanaryRelease(
  input: StartCanaryInput
): Promise<CanaryRelease> {
  const { tenantId, subgraphId, newVersionId, startedBy, initialPercent = 10, errorRateThreshold = 5.0, autoFullReleaseHours = 24 } = input;

  const subgraph = await getSubgraphById(subgraphId, tenantId);
  if (!subgraph) {
    throw new Error('Subgraph not found');
  }

  const existingActive = await getActiveCanaryForSubgraph(subgraphId, tenantId);
  if (existingActive) {
    throw new Error('An active canary release already exists for this subgraph');
  }

  const newVersion = await getSchemaVersionById(newVersionId);
  if (!newVersion || newVersion.tenant_id !== tenantId) {
    throw new Error('New version not found');
  }

  const oldVersion = await getActiveSchemaVersion(subgraphId);
  if (!oldVersion) {
    throw new Error('No active version found for subgraph');
  }

  if (oldVersion.id === newVersionId) {
    throw new Error('New version is the same as the current active version');
  }

  if (!VALID_PERCENTS.includes(initialPercent) && initialPercent !== 0) {
    throw new Error(`Invalid initial percent. Must be one of: ${VALID_PERCENTS.join(', ')}`);
  }

  const percentHistory: PercentHistoryItem[] = [
    {
      percent: initialPercent,
      changedAt: new Date().toISOString(),
      reason: 'Initial canary release started',
    },
  ];

  const result = await query<CanaryRelease>(
    `INSERT INTO canary_releases 
     (tenant_id, subgraph_id, subgraph_name, old_version_id, new_version_id, 
      old_version_string, new_version_string, status, current_percent, 
      percent_history, started_by, error_rate_threshold, auto_full_release_hours)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      tenantId,
      subgraphId,
      subgraph.name,
      oldVersion.id,
      newVersionId,
      oldVersion.version_string || `v${oldVersion.version}.0.0`,
      newVersion.version_string || `v${newVersion.version}.0.0`,
      initialPercent > 0 ? 'canary' : 'pending',
      initialPercent,
      JSON.stringify(percentHistory),
      startedBy,
      errorRateThreshold,
      autoFullReleaseHours,
    ]
  );

  const canary = result.rows[0];

  await updateCanaryRedisConfig(tenantId, subgraphId, canary);

  await query(
    `INSERT INTO release_audit_logs 
     (tenant_id, subgraph_id, subgraph_name, canary_release_id, action_type, 
      old_version_id, new_version_id, old_version_string, new_version_string, 
      old_percent, new_percent, operator, reason, metadata)
     VALUES ($1, $2, $3, $4, 'start_canary', $5, $6, $7, $8, 0, $9, $10, 'Started canary release', '{}'::jsonb)`,
    [
      tenantId,
      subgraphId,
      subgraph.name,
      canary.id,
      oldVersion.id,
      newVersionId,
      oldVersion.version_string || `v${oldVersion.version}.0.0`,
      newVersion.version_string || `v${newVersion.version}.0.0`,
      initialPercent,
      startedBy,
    ]
  );

  notificationService.broadcastEvent(
    tenantId,
    'grayscale_progress' as any,
    {
      canaryId: canary.id,
      subgraphId,
      subgraphName: subgraph.name,
      status: canary.status,
      currentPercent: initialPercent,
      oldVersion: oldVersion.version_string,
      newVersion: newVersion.version_string,
    },
    subgraph.name,
    subgraphId
  );

  return canary;
}

export async function adjustCanaryPercent(
  input: AdjustCanaryPercentInput
): Promise<CanaryRelease> {
  const { canaryId, tenantId, newPercent, operator, reason } = input;

  const canary = await getCanaryById(canaryId, tenantId);
  if (!canary) {
    throw new Error('Canary release not found');
  }

  if (canary.status !== 'canary' && canary.status !== 'pending') {
    throw new Error(`Cannot adjust percent for canary with status: ${canary.status}`);
  }

  if (!VALID_PERCENTS.includes(newPercent)) {
    throw new Error(`Invalid percent. Must be one of: ${VALID_PERCENTS.join(', ')}`);
  }

  if (newPercent === canary.current_percent) {
    return canary;
  }

  const oldPercent = canary.current_percent;
  const percentHistory = [...(canary.percent_history || [])];
  percentHistory.push({
    percent: newPercent,
    changedAt: new Date().toISOString(),
    reason: reason || 'Manual adjustment',
  });

  const newStatus = newPercent >= 100 ? 'full_rollout' : 'canary';

  const result = await query<CanaryRelease>(
    `UPDATE canary_releases 
     SET current_percent = $1, status = $2, percent_history = $3, 
         last_percent_change_at = NOW(),
         completed_at = CASE WHEN $4 = 'full_rollout' THEN NOW() ELSE completed_at END
     WHERE id = $5 AND tenant_id = $6
     RETURNING *`,
    [newPercent, newStatus, JSON.stringify(percentHistory), newStatus, canaryId, tenantId]
  );

  const updatedCanary = result.rows[0];

  await updateCanaryRedisConfig(tenantId, canary.subgraph_id, updatedCanary);

  await query(
    `INSERT INTO release_audit_logs 
     (tenant_id, subgraph_id, subgraph_name, canary_release_id, action_type, 
      old_version_id, new_version_id, old_version_string, new_version_string, 
      old_percent, new_percent, operator, reason, metadata)
     VALUES ($1, $2, $3, $4, 'adjust_percent', $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb)`,
    [
      tenantId,
      canary.subgraph_id,
      canary.subgraph_name,
      canaryId,
      canary.old_version_id,
      canary.new_version_id,
      canary.old_version_string,
      canary.new_version_string,
      oldPercent,
      newPercent,
      operator,
      reason || 'Manual adjustment',
    ]
  );

  notificationService.broadcastEvent(
    tenantId,
    'grayscale_progress' as any,
    {
      canaryId: canary.id,
      subgraphId: canary.subgraph_id,
      subgraphName: canary.subgraph_name,
      status: newStatus,
      currentPercent: newPercent,
      oldPercent,
    },
    canary.subgraph_name,
    canary.subgraph_id
  );

  return updatedCanary;
}

export async function rollbackCanary(
  input: RollbackCanaryInput
): Promise<CanaryRelease> {
  const { canaryId, tenantId, operator, reason } = input;

  const canary = await getCanaryById(canaryId, tenantId);
  if (!canary) {
    throw new Error('Canary release not found');
  }

  if (canary.status === 'rolled_back') {
    return canary;
  }

  const oldPercent = canary.current_percent;

  const result = await query<CanaryRelease>(
    `UPDATE canary_releases 
     SET status = 'rolled_back', current_percent = 0, 
         rolled_back_by = $1, rollback_reason = $2,
         completed_at = NOW(), last_percent_change_at = NOW()
     WHERE id = $3 AND tenant_id = $4
     RETURNING *`,
    [operator, reason || 'Manual rollback', canaryId, tenantId]
  );

  const rolledBackCanary = result.rows[0];

  await clearCanaryRedisConfig(tenantId, canary.subgraph_id);

  await query(
    `INSERT INTO release_audit_logs 
     (tenant_id, subgraph_id, subgraph_name, canary_release_id, action_type, 
      old_version_id, new_version_id, old_version_string, new_version_string, 
      old_percent, new_percent, operator, reason, metadata)
     VALUES ($1, $2, $3, $4, 'rollback', $5, $6, $7, $8, $9, 0, $10, $11, '{}'::jsonb)`,
    [
      tenantId,
      canary.subgraph_id,
      canary.subgraph_name,
      canaryId,
      canary.old_version_id,
      canary.new_version_id,
      canary.old_version_string,
      canary.new_version_string,
      oldPercent,
      operator,
      reason || 'Manual rollback',
    ]
  );

  notificationService.broadcastEvent(
    tenantId,
    'grayscale_progress' as any,
    {
      canaryId: canary.id,
      subgraphId: canary.subgraph_id,
      subgraphName: canary.subgraph_name,
      status: 'rolled_back',
      currentPercent: 0,
      rollbackReason: reason,
      rolledBackBy: operator,
    },
    canary.subgraph_name,
    canary.subgraph_id
  );

  return rolledBackCanary;
}

export async function fullReleaseCanary(
  input: FullReleaseCanaryInput
): Promise<CanaryRelease> {
  const { canaryId, tenantId, operator, reason } = input;

  const canary = await getCanaryById(canaryId, tenantId);
  if (!canary) {
    throw new Error('Canary release not found');
  }

  if (canary.status === 'full_rollout') {
    return canary;
  }

  if (canary.status !== 'canary') {
    throw new Error(`Cannot full release canary with status: ${canary.status}`);
  }

  const oldPercent = canary.current_percent;

  const percentHistory = [...(canary.percent_history || [])];
  percentHistory.push({
    percent: 100,
    changedAt: new Date().toISOString(),
    reason: reason || 'Full release',
  });

  const result = await query<CanaryRelease>(
    `UPDATE canary_releases 
     SET status = 'full_rollout', current_percent = 100, 
         percent_history = $1, completed_at = NOW(),
         last_percent_change_at = NOW()
     WHERE id = $2 AND tenant_id = $3
     RETURNING *`,
    [JSON.stringify(percentHistory), canaryId, tenantId]
  );

  const fullReleaseCanary = result.rows[0];

  await clearCanaryRedisConfig(tenantId, canary.subgraph_id);

  await query(
    `INSERT INTO release_audit_logs 
     (tenant_id, subgraph_id, subgraph_name, canary_release_id, action_type, 
      old_version_id, new_version_id, old_version_string, new_version_string, 
      old_percent, new_percent, operator, reason, metadata)
     VALUES ($1, $2, $3, $4, 'full_release', $5, $6, $7, $8, $9, 100, $10, $11, '{}'::jsonb)`,
    [
      tenantId,
      canary.subgraph_id,
      canary.subgraph_name,
      canaryId,
      canary.old_version_id,
      canary.new_version_id,
      canary.old_version_string,
      canary.new_version_string,
      oldPercent,
      operator,
      reason || 'Full release',
    ]
  );

  notificationService.broadcastEvent(
    tenantId,
    'grayscale_progress' as any,
    {
      canaryId: canary.id,
      subgraphId: canary.subgraph_id,
      subgraphName: canary.subgraph_name,
      status: 'full_rollout',
      currentPercent: 100,
    },
    canary.subgraph_name,
    canary.subgraph_id
  );

  return fullReleaseCanary;
}

export async function getCanaryMetrics(
  canaryId: string,
  tenantId: string
): Promise<CanaryMetricsSummary> {
  const canary = await getCanaryById(canaryId, tenantId);
  if (!canary) {
    throw new Error('Canary release not found');
  }

  const oldMetricsResult = await query<{
    request_count: number;
    error_count: number;
    avg_latency_ms: number;
  }>(
    `SELECT 
       COALESCE(SUM(request_count), 0) as request_count,
       COALESCE(SUM(error_count), 0) as error_count,
       COALESCE(AVG(avg_latency_ms), 0) as avg_latency_ms
     FROM canary_metrics
     WHERE canary_release_id = $1 AND version_type = 'old' AND tenant_id = $2`,
    [canaryId, tenantId]
  );

  const newMetricsResult = await query<{
    request_count: number;
    error_count: number;
    avg_latency_ms: number;
  }>(
    `SELECT 
       COALESCE(SUM(request_count), 0) as request_count,
       COALESCE(SUM(error_count), 0) as error_count,
       COALESCE(AVG(avg_latency_ms), 0) as avg_latency_ms
     FROM canary_metrics
     WHERE canary_release_id = $1 AND version_type = 'new' AND tenant_id = $2`,
    [canaryId, tenantId]
  );

  const oldMetrics = oldMetricsResult.rows[0];
  const newMetrics = newMetricsResult.rows[0];

  return {
    oldVersion: {
      requestCount: parseInt(oldMetrics.request_count as any || '0', 10),
      errorCount: parseInt(oldMetrics.error_count as any || '0', 10),
      errorRate: oldMetrics.request_count ? (oldMetrics.error_count / oldMetrics.request_count) * 100 : 0,
      avgLatencyMs: parseFloat(oldMetrics.avg_latency_ms as any || '0'),
    },
    newVersion: {
      requestCount: parseInt(newMetrics.request_count as any || '0', 10),
      errorCount: parseInt(newMetrics.error_count as any || '0', 10),
      errorRate: newMetrics.request_count ? (newMetrics.error_count / newMetrics.request_count) * 100 : 0,
      avgLatencyMs: parseFloat(newMetrics.avg_latency_ms as any || '0'),
    },
  };
}

export async function checkCanaryAutoRollback(canaryId: string, tenantId: string): Promise<boolean> {
  const canary = await getCanaryById(canaryId, tenantId);
  if (!canary || canary.status !== 'canary') return false;

  const metrics = await getCanaryMetrics(canaryId, tenantId);
  
  if (metrics.newVersion.requestCount < 100) return false;

  if (metrics.newVersion.errorRate > canary.error_rate_threshold) {
    await rollbackCanary({
      canaryId,
      tenantId,
      operator: 'system',
      reason: `Auto rollback: error rate ${metrics.newVersion.errorRate.toFixed(2)}% exceeds threshold ${canary.error_rate_threshold}%`,
    });
    return true;
  }

  return false;
}

export async function checkCanaryAutoFullRelease(canaryId: string, tenantId: string): Promise<boolean> {
  const canary = await getCanaryById(canaryId, tenantId);
  if (!canary || canary.status !== 'canary') return false;
  if (canary.current_percent === 100) return false;

  const metrics = await getCanaryMetrics(canaryId, tenantId);
  
  if (metrics.newVersion.requestCount < 100) return false;
  if (metrics.newVersion.errorRate >= 1) return false;

  const lastChange = new Date(canary.last_percent_change_at).getTime();
  const hoursSinceLastChange = (Date.now() - lastChange) / (1000 * 60 * 60);

  if (hoursSinceLastChange >= canary.auto_full_release_hours) {
    return true;
  }

  return false;
}

async function updateCanaryRedisConfig(
  tenantId: string,
  subgraphId: string,
  canary: CanaryRelease
): Promise<void> {
  const redis = getRedisClient();
  const key = `${CANARY_REDIS_PREFIX}${tenantId}:${subgraphId}`;

  const config = {
    canaryId: canary.id,
    status: canary.status,
    currentPercent: canary.current_percent,
    oldVersionId: canary.old_version_id,
    newVersionId: canary.new_version_id,
    oldVersionString: canary.old_version_string,
    newVersionString: canary.new_version_string,
    errorRateThreshold: canary.error_rate_threshold,
    updatedAt: new Date().toISOString(),
  };

  await cacheSet(key, config);
}

async function clearCanaryRedisConfig(
  tenantId: string,
  subgraphId: string
): Promise<void> {
  const key = `${CANARY_REDIS_PREFIX}${tenantId}:${subgraphId}`;
  await cacheDel(key);
}

export async function getCanaryConfigFromRedis(
  tenantId: string,
  subgraphId: string
): Promise<any | null> {
  const key = `${CANARY_REDIS_PREFIX}${tenantId}:${subgraphId}`;
  return cacheGet(key);
}

export default {
  getActiveCanaryForSubgraph,
  getCanaryById,
  getCanaryReleases,
  startCanaryRelease,
  adjustCanaryPercent,
  rollbackCanary,
  fullReleaseCanary,
  getCanaryMetrics,
  checkCanaryAutoRollback,
  checkCanaryAutoFullRelease,
  getCanaryConfigFromRedis,
};
