import { query } from '../db';
import { cacheSet, cacheDel, cacheGet } from '../cache';
import { SupergraphVersion, SupergraphStatus, Tenant, CompositionLog, SubgraphVersionRef } from '../types';
import { composeSchemas, validateSchemaSize } from './schema-composition';
import { getActiveSubgraphsWithSchema, getSchemaVersionById } from './subgraph-service';
import { notificationService } from './notification-service';

const SUPERGRAPH_CACHE_KEY = 'supergraph:current:';

export async function getCurrentSupergraph(tenantId: string): Promise<SupergraphVersion | null> {
  const cacheKey = SUPERGRAPH_CACHE_KEY + tenantId;
  const cached = await cacheGet<SupergraphVersion>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await query<SupergraphVersion>(
    `SELECT * FROM supergraph_versions 
     WHERE tenant_id = $1 AND status IN ('active', 'grayscale')
     ORDER BY version DESC LIMIT 1`,
    [tenantId]
  );

  if (result.rows.length > 0) {
    await cacheSet(cacheKey, result.rows[0], 300);
    return result.rows[0];
  }

  return null;
}

export async function getSupergraphById(id: string, tenantId: string): Promise<SupergraphVersion | null> {
  const result = await query<SupergraphVersion>(
    'SELECT * FROM supergraph_versions WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  return result.rows[0] || null;
}

export async function getSupergraphVersions(tenantId: string, limit: number = 20): Promise<SupergraphVersion[]> {
  const result = await query<SupergraphVersion>(
    'SELECT * FROM supergraph_versions WHERE tenant_id = $1 ORDER BY version DESC LIMIT $2',
    [tenantId, limit]
  );
  return result.rows;
}

export async function composeAndPublishSupergraph(
  tenantId: string,
  triggeredBy?: string
): Promise<{ success: boolean; supergraph?: SupergraphVersion; errors?: any[]; warnings?: any[] }> {
  const tenantResult = await query<Tenant>(
    'SELECT * FROM tenants WHERE id = $1',
    [tenantId]
  );

  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  const tenant = tenantResult.rows[0];
  const activeSubgraphs = await getActiveSubgraphsWithSchema(tenantId);

  if (activeSubgraphs.length === 0) {
    return {
      success: false,
      errors: [{ message: 'No active subgraphs with schemas found' }],
    };
  }

  const subgraphSchemas = activeSubgraphs
    .filter(sg => sg.version)
    .map(sg => ({ name: sg.subgraph.name, sdl: sg.version!.sdl }));

  const subgraphVersions: SubgraphVersionRef[] = activeSubgraphs
    .filter(sg => sg.version)
    .map(sg => ({
      subgraphId: sg.subgraph.id,
      subgraphName: sg.subgraph.name,
      versionId: sg.version!.id,
      version: sg.version!.version,
    }));

  const startTime = Date.now();
  const compositionResult = composeSchemas(subgraphSchemas);
  const durationMs = Date.now() - startTime;

  if (!compositionResult.success || !compositionResult.supergraphSdl) {
    await createCompositionLog(tenantId, null, triggeredBy, 'schema_change', 'failed', compositionResult.errors, compositionResult.warnings, [], durationMs);

    return {
      success: false,
      errors: compositionResult.errors,
      warnings: compositionResult.warnings,
    };
  }

  const sizeCheck = validateSchemaSize(compositionResult.supergraphSdl, tenant.max_supergraph_size_kb);
  if (!sizeCheck.valid) {
    return {
      success: false,
      errors: [{ message: `Supergraph size exceeds maximum of ${tenant.max_supergraph_size_kb}KB` }],
    };
  }

  const latestVersion = await getLatestSupergraphVersion(tenantId);
  const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

  const result = await query<SupergraphVersion>(
    `INSERT INTO supergraph_versions 
     (tenant_id, version, sdl, schema_size_bytes, composition_result, subgraph_versions, 
      status, grayscale_percent, grayscale_start_at, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'grayscale', $7, NOW(), $8)
     RETURNING *`,
    [
      tenantId,
      nextVersion,
      compositionResult.supergraphSdl,
      sizeCheck.sizeBytes,
      JSON.stringify(compositionResult),
      JSON.stringify(subgraphVersions),
      10,
      triggeredBy || null,
    ]
  );

  const supergraph = result.rows[0];

  await query(
    `UPDATE supergraph_versions SET status = 'rolled_back' 
     WHERE tenant_id = $1 AND status IN ('active', 'grayscale') AND id != $2`,
    [tenantId, supergraph.id]
  );

  await cacheDel(SUPERGRAPH_CACHE_KEY + tenantId);

  await createCompositionLog(
    tenantId,
    supergraph.id,
    triggeredBy,
    'schema_change',
    'success',
    [],
    compositionResult.warnings,
    compositionResult.breakingChanges,
    durationMs
  );

  notificationService.notifySupergraphPublished(tenantId, nextVersion, compositionResult);
  notificationService.notifyGrayscaleProgress(tenantId, nextVersion, 10, 0, 0);

  return {
    success: true,
    supergraph,
  };
}

async function getLatestSupergraphVersion(tenantId: string): Promise<SupergraphVersion | null> {
  const result = await query<SupergraphVersion>(
    'SELECT * FROM supergraph_versions WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1',
    [tenantId]
  );
  return result.rows[0] || null;
}

export async function promoteGrayscaleToActive(supergraphId: string, tenantId: string): Promise<SupergraphVersion | null> {
  const current = await getCurrentSupergraph(tenantId);
  const result = await query<SupergraphVersion>(
    `UPDATE supergraph_versions SET status = 'active' WHERE id = $1 AND tenant_id = $2 AND status = 'grayscale' RETURNING *`,
    [supergraphId, tenantId]
  );

  if (result.rows.length > 0) {
    await cacheDel(SUPERGRAPH_CACHE_KEY + tenantId);
    if (current) {
      notificationService.notifyGrayscaleProgress(tenantId, current.version, 100, current.error_count, current.total_count);
    }
    return result.rows[0];
  }
  return null;
}

export async function rollbackSupergraph(supergraphId: string, tenantId: string, triggeredBy?: string): Promise<SupergraphVersion | null> {
  const supergraph = await getSupergraphById(supergraphId, tenantId);
  if (!supergraph) {
    throw new Error('Supergraph version not found');
  }

  await query(
    `UPDATE supergraph_versions SET status = 'rolled_back' WHERE id = $1 AND tenant_id = $2`,
    [supergraphId, tenantId]
  );

  const previousVersionResult = await query<SupergraphVersion>(
    `SELECT * FROM supergraph_versions 
     WHERE tenant_id = $1 AND version < $2 
     ORDER BY version DESC LIMIT 1`,
    [tenantId, supergraph.version]
  );

  if (previousVersionResult.rows.length > 0) {
    await query(
      `UPDATE supergraph_versions SET status = 'active' WHERE id = $1`,
      [previousVersionResult.rows[0].id]
    );
  }

  await cacheDel(SUPERGRAPH_CACHE_KEY + tenantId);

  await createCompositionLog(
    tenantId,
    previousVersionResult.rows[0]?.id,
    triggeredBy,
    'rollback',
    'success',
    [],
    [],
    [],
    0
  );

  return previousVersionResult.rows[0] || null;
}

export async function createCompositionLog(
  tenantId: string,
  supergraphVersionId: string | null,
  triggeredBy: string | undefined,
  triggerType: string,
  status: string,
  errors: any[],
  warnings: any[],
  breakingChanges: any[],
  durationMs: number
): Promise<void> {
  await query(
    `INSERT INTO composition_logs 
     (tenant_id, supergraph_version_id, triggered_by, trigger_type, status, errors, warnings, breaking_changes, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      tenantId,
      supergraphVersionId,
      triggeredBy || null,
      triggerType,
      status,
      JSON.stringify(errors),
      JSON.stringify(warnings),
      JSON.stringify(breakingChanges),
      durationMs,
    ]
  );
}

export async function getCompositionLogs(tenantId: string, limit: number = 50): Promise<CompositionLog[]> {
  const result = await query<CompositionLog>(
    'SELECT * FROM composition_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2',
    [tenantId, limit]
  );
  return result.rows;
}

export async function updateGrayscaleMetrics(
  supergraphId: string,
  tenantId: string,
  hasError: boolean
): Promise<void> {
  await query(
    `UPDATE supergraph_versions 
     SET total_count = total_count + 1,
         error_count = error_count + CASE WHEN $1 THEN 1 ELSE 0 END
     WHERE id = $2 AND tenant_id = $3 AND status = 'grayscale'`,
    [hasError, supergraphId, tenantId]
  );
}

export async function checkGrayscaleAutoRollback(tenantId: string, errorThreshold: number = 5): Promise<{ rolledBack: boolean; reason?: string }> {
  const current = await getCurrentSupergraph(tenantId);
  if (!current || current.status !== 'grayscale') {
    return { rolledBack: false };
  }

  if (current.total_count < 100) {
    return { rolledBack: false };
  }

  const errorRate = (current.error_count / current.total_count) * 100;
  if (errorRate > errorThreshold) {
    await rollbackSupergraph(current.id, tenantId, 'system-grayscale');
    return { rolledBack: true, reason: `Error rate ${errorRate.toFixed(2)}% exceeds threshold ${errorThreshold}%` };
  }

  return { rolledBack: false };
}

export async function checkGrayscaleAutoPromote(tenantId: string, grayscaleDurationSeconds: number = 300): Promise<{ promoted: boolean }> {
  const current = await getCurrentSupergraph(tenantId);
  if (!current || current.status !== 'grayscale' || !current.grayscale_start_at) {
    return { promoted: false };
  }

  const elapsed = (Date.now() - new Date(current.grayscale_start_at).getTime()) / 1000;
  if (elapsed >= grayscaleDurationSeconds) {
    await promoteGrayscaleToActive(current.id, tenantId);
    return { promoted: true };
  }

  return { promoted: false };
}

export default {
  getCurrentSupergraph,
  getSupergraphById,
  getSupergraphVersions,
  composeAndPublishSupergraph,
  promoteGrayscaleToActive,
  rollbackSupergraph,
  getCompositionLogs,
  updateGrayscaleMetrics,
  checkGrayscaleAutoRollback,
  checkGrayscaleAutoPromote,
};
