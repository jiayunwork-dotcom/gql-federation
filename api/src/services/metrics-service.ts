import { query } from '../db';
import { QueryMetric, SubgraphMetric, FieldUsage, SubgraphHealth } from '../types';

export interface RecordQueryMetricInput {
  tenantId: string;
  supergraphVersionId: string;
  queryHash: string;
  queryText?: string;
  operationName?: string;
  totalDurationMs: number;
  responseSizeBytes: number;
  hasErrors: boolean;
  errorMessage?: string;
  subgraphMetrics: SubgraphMetric[];
  queryPlan?: any;
  depth?: number;
  complexity?: number;
  fields?: Array<{ typeName: string; fieldName: string; subgraphName?: string }>;
}

export async function recordQueryMetric(input: RecordQueryMetricInput): Promise<void> {
  await query(
    `INSERT INTO query_metrics 
     (tenant_id, supergraph_version_id, query_hash, query_text, operation_name,
      total_duration_ms, response_size_bytes, has_errors, error_message,
      subgraph_metrics, query_plan, depth, complexity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.tenantId,
      input.supergraphVersionId,
      input.queryHash,
      input.queryText || null,
      input.operationName || null,
      input.totalDurationMs,
      input.responseSizeBytes,
      input.hasErrors,
      input.errorMessage || null,
      JSON.stringify(input.subgraphMetrics),
      input.queryPlan ? JSON.stringify(input.queryPlan) : null,
      input.depth || null,
      input.complexity || null,
    ]
  );

  if (input.fields && input.fields.length > 0) {
    for (const field of input.fields) {
      await updateFieldUsage(input.tenantId, field.typeName, field.fieldName, field.subgraphName);
    }
  }

  for (const sm of input.subgraphMetrics) {
    await updateSubgraphHealth(input.tenantId, sm);
  }
}

async function updateFieldUsage(
  tenantId: string,
  typeName: string,
  fieldName: string,
  subgraphName?: string
): Promise<void> {
  await query(
    `INSERT INTO field_usage (tenant_id, type_name, field_name, subgraph_name, usage_count, last_used_at)
     VALUES ($1, $2, $3, $4, 1, NOW())
     ON CONFLICT (tenant_id, type_name, field_name)
     DO UPDATE SET 
       usage_count = field_usage.usage_count + 1,
       last_used_at = NOW(),
       subgraph_name = COALESCE(EXCLUDED.subgraph_name, field_usage.subgraph_name)`,
    [tenantId, typeName, fieldName, subgraphName || null]
  );
}

async function updateSubgraphHealth(
  tenantId: string,
  subgraphMetric: SubgraphMetric
): Promise<void> {
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - 5);

  const result = await query<SubgraphHealth>(
    `SELECT * FROM subgraph_health 
     WHERE tenant_id = $1 AND subgraph_name = $2 AND window_start >= $3
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, subgraphMetric.subgraphName, windowStart]
  );

  if (result.rows.length > 0) {
    await query(
      `UPDATE subgraph_health SET
         total_requests = total_requests + 1,
         error_count = error_count + CASE WHEN $1 THEN 1 ELSE 0 END
       WHERE id = $2`,
      [subgraphMetric.status === 'error', result.rows[0].id]
    );
  }
}

export async function getSubgraphHealth(
  tenantId: string,
  windowMinutes: number = 60
): Promise<SubgraphHealth[]> {
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - windowMinutes);

  const result = await query<SubgraphHealth>(
    `SELECT 
       sh.tenant_id,
       sh.subgraph_id,
       sh.subgraph_name,
       AVG(CASE WHEN sm.status = 'success' THEN sm.duration_ms END) as avg_response_time_ms,
       PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY sm.duration_ms) as p99_response_time_ms,
       (COUNT(CASE WHEN sm.status = 'error' THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100) as error_rate,
       (COUNT(*)::numeric / $3::numeric) as qps,
       COUNT(*) as total_requests,
       COUNT(CASE WHEN sm.status = 'error' THEN 1 END) as error_count
     FROM (
       SELECT 
         tenant_id, subgraph_name, 
         jsonb_array_elements(subgraph_metrics) as subgraph_metric,
         created_at
       FROM query_metrics
       WHERE tenant_id = $1 AND created_at >= $2
     ) sub,
     LATERAL jsonb_to_record(subgraph_metric) as sm(subgraph_name text, duration_ms int, status text)
     WHERE sm.subgraph_name IS NOT NULL
     GROUP BY sh.tenant_id, sh.subgraph_id, sh.subgraph_name
     ORDER BY subgraph_name`,
    [tenantId, windowStart, windowMinutes * 60]
  );

  return result.rows;
}

export async function getFieldUsageStats(
  tenantId: string,
  limit: number = 50
): Promise<FieldUsage[]> {
  const result = await query<FieldUsage>(
    'SELECT * FROM field_usage WHERE tenant_id = $1 ORDER BY usage_count DESC LIMIT $2',
    [tenantId, limit]
  );
  return result.rows;
}

export async function getQueryMetricsSummary(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<{ totalQueries: number; errorCount: number; avgDuration: number; p99Duration: number }> {
  const result = await query<any>(
    `SELECT 
       COUNT(*) as total_queries,
       COUNT(CASE WHEN has_errors THEN 1 END) as error_count,
       AVG(total_duration_ms) as avg_duration,
       PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_duration_ms) as p99_duration
     FROM query_metrics 
     WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3`,
    [tenantId, startDate, endDate]
  );

  const row = result.rows[0];
  return {
    totalQueries: parseInt(row.total_queries || '0', 10),
    errorCount: parseInt(row.error_count || '0', 10),
    avgDuration: parseFloat(row.avg_duration || '0'),
    p99Duration: parseFloat(row.p99_duration || '0'),
  };
}

export async function getTopQueries(
  tenantId: string,
  limit: number = 10
): Promise<Array<{ queryHash: string; operationName?: string; count: number; avgDuration: number; errorRate: number }>> {
  const result = await query<any>(
    `SELECT 
       query_hash,
       operation_name,
       COUNT(*) as count,
       AVG(total_duration_ms) as avg_duration,
       (COUNT(CASE WHEN has_errors THEN 1 END)::numeric / COUNT(*) * 100) as error_rate
     FROM query_metrics 
     WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY query_hash, operation_name
     ORDER BY count DESC
     LIMIT $2`,
    [tenantId, limit]
  );

  return result.rows.map(r => ({
    queryHash: r.query_hash,
    operationName: r.operation_name || undefined,
    count: parseInt(r.count, 10),
    avgDuration: parseFloat(r.avg_duration),
    errorRate: parseFloat(r.error_rate),
  }));
}

export default {
  recordQueryMetric,
  getSubgraphHealth,
  getFieldUsageStats,
  getQueryMetricsSummary,
  getTopQueries,
};
