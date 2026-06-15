import { query } from '../db';
import config from '../config';

export function shouldUseGrayscale(tenantId: string, grayscalePercent: number = 10): boolean {
  const random = Math.random() * 100;
  return random < grayscalePercent;
}

export async function getGrayscaleSupergraphId(tenantId: string): Promise<string | null> {
  const result = await query<any>(
    `SELECT id FROM supergraph_versions 
     WHERE tenant_id = $1 AND status = 'grayscale'
     ORDER BY version DESC LIMIT 1`,
    [tenantId]
  );
  return result.rows[0]?.id || null;
}

export async function getActiveSupergraphId(tenantId: string): Promise<string | null> {
  const result = await query<any>(
    `SELECT id FROM supergraph_versions 
     WHERE tenant_id = $1 AND status = 'active'
     ORDER BY version DESC LIMIT 1`,
    [tenantId]
  );
  return result.rows[0]?.id || null;
}

export async function recordGrayscaleRequest(
  supergraphId: string,
  tenantId: string,
  hasError: boolean
): Promise<void> {
  await query(
    `UPDATE supergraph_versions 
     SET total_count = total_count + 1,
         error_count = error_count + CASE WHEN $1 THEN 1 ELSE 0 END
     WHERE id = $2 AND tenant_id = $3`,
    [hasError, supergraphId, tenantId]
  );
}

export async function checkGrayscaleAutoRollback(tenantId: string): Promise<boolean> {
  const result = await query<any>(
    `SELECT sv.*, t.name as tenant_name
     FROM supergraph_versions sv
     JOIN tenants t ON t.id = sv.tenant_id
     WHERE sv.tenant_id = $1 AND sv.status = 'grayscale'
     ORDER BY sv.version DESC LIMIT 1`,
    [tenantId]
  );

  if (result.rows.length === 0) return false;

  const version = result.rows[0];
  if (version.total_count < 100) return false;

  const errorRate = (version.error_count / version.total_count) * 100;
  if (errorRate > config.grayscaleErrorThreshold) {
    await query(
      `UPDATE supergraph_versions SET status = 'rolled_back' WHERE id = $1`,
      [version.id]
    );

    const prevResult = await query<any>(
      `SELECT id FROM supergraph_versions 
       WHERE tenant_id = $1 AND version < $2 
       ORDER BY version DESC LIMIT 1`,
      [tenantId, version.version]
    );

    if (prevResult.rows.length > 0) {
      await query(
        `UPDATE supergraph_versions SET status = 'active' WHERE id = $1`,
        [prevResult.rows[0].id]
      );
    }

    console.log(`[Grayscale] Auto-rolled back supergraph v${version.version} for tenant ${version.tenant_name} (error rate: ${errorRate.toFixed(2)}%)`);
    return true;
  }

  return false;
}

export async function checkGrayscaleAutoPromote(tenantId: string): Promise<boolean> {
  const result = await query<any>(
    `SELECT sv.*
     FROM supergraph_versions sv
     WHERE sv.tenant_id = $1 AND sv.status = 'grayscale' AND sv.grayscale_start_at IS NOT NULL
     ORDER BY sv.version DESC LIMIT 1`,
    [tenantId]
  );

  if (result.rows.length === 0) return false;

  const version = result.rows[0];
  const grayscaleStart = new Date(version.grayscale_start_at).getTime();
  const elapsedSeconds = (Date.now() - grayscaleStart) / 1000;

  if (elapsedSeconds >= config.grayscaleDuration) {
    await query(
      `UPDATE supergraph_versions SET status = 'active' WHERE id = $1`,
      [version.id]
    );
    console.log(`[Grayscale] Auto-promoted supergraph v${version.version} for tenant ${tenantId}`);
    return true;
  }

  return false;
}

export default {
  shouldUseGrayscale,
  getGrayscaleSupergraphId,
  getActiveSupergraphId,
  recordGrayscaleRequest,
  checkGrayscaleAutoRollback,
  checkGrayscaleAutoPromote,
};
