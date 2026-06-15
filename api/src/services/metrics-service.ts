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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
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
      JSON.stringify(input.subgraphMetrics || []),
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
  const windowEnd = new Date();

  const existing = await query<any>(
    `SELECT id FROM subgraph_health 
     WHERE tenant_id = $1 AND subgraph_name = $2 AND window_start >= $3
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, subgraphMetric.subgraphName, windowStart]
  );

  if (existing.rows.length > 0) {
    await query(
      `UPDATE subgraph_health SET
         total_requests = total_requests + 1,
         error_count = error_count + CASE WHEN $1 THEN 1 ELSE 0 END,
         window_end = $2
       WHERE id = $3`,
      [subgraphMetric.status === 'error', windowEnd, existing.rows[0].id]
    );
  } else {
    const subgraphResult = await query<{ id: string }>(
      'SELECT id FROM subgraphs WHERE name = $1 AND tenant_id = $2',
      [subgraphMetric.subgraphName, tenantId]
    );
    const subgraphId = subgraphResult.rows[0]?.id || null;

    await query(
      `INSERT INTO subgraph_health 
       (tenant_id, subgraph_id, subgraph_name, avg_response_time_ms, p99_response_time_ms, 
        error_rate, qps, total_requests, error_count, window_start, window_end)
       VALUES ($1, $2, $3, 0, 0, 0, 0, 1, $4, $5, $6)`,
      [
        tenantId,
        subgraphId,
        subgraphMetric.subgraphName,
        subgraphMetric.status === 'error' ? 1 : 0,
        windowStart,
        windowEnd,
      ]
    );
  }
}

export async function getSubgraphHealth(
  tenantId: string,
  windowMinutes: number = 60
): Promise<any[]> {
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - windowMinutes);

  try {
    const result = await query<any>(
      `SELECT 
         subgraph_name,
         COALESCE(AVG(avg_response_time_ms), 0) as avg_response_time_ms,
         COALESCE(MAX(p99_response_time_ms), 0) as p99_response_time_ms,
         CASE WHEN SUM(total_requests) > 0 
           THEN (SUM(error_count)::numeric / SUM(total_requests) * 100)
           ELSE 0 
         END as error_rate,
         CASE WHEN EXTRACT(EPOCH FROM (MAX(window_end) - MIN(window_start))) > 0
           THEN SUM(total_requests)::numeric / EXTRACT(EPOCH FROM (MAX(window_end) - MIN(window_start)))
           ELSE 0
         END as qps,
         SUM(total_requests) as total_requests,
         SUM(error_count) as error_count
       FROM subgraph_health 
       WHERE tenant_id = $1 AND window_start >= $2
       GROUP BY subgraph_name
       ORDER BY subgraph_name`,
      [tenantId, windowStart]
    );
    return result.rows;
  } catch (err) {
    console.error('getSubgraphHealth error:', err);
    return [];
  }
}

export async function getFieldUsageStats(
  tenantId: string,
  limit: number = 50
): Promise<FieldUsage[]> {
  try {
    const result = await query<FieldUsage>(
      'SELECT * FROM field_usage WHERE tenant_id = $1 ORDER BY usage_count DESC LIMIT $2',
      [tenantId, limit]
    );
    return result.rows;
  } catch (err) {
    console.error('getFieldUsageStats error:', err);
    return [];
  }
}

export async function getQueryMetricsSummary(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<{ totalQueries: number; errorCount: number; avgDuration: number; p99Duration: number }> {
  try {
    const result = await query<any>(
      `SELECT 
         COUNT(*) as total_queries,
         COUNT(CASE WHEN has_errors THEN 1 END) as error_count,
         COALESCE(AVG(total_duration_ms), 0) as avg_duration,
         COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_duration_ms), 0) as p99_duration
       FROM query_metrics 
       WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3`,
      [tenantId, startDate, endDate]
    );

    const row = result.rows[0];
    if (!row) {
      return { totalQueries: 0, errorCount: 0, avgDuration: 0, p99Duration: 0 };
    }
    return {
      totalQueries: parseInt(row.total_queries || '0', 10),
      errorCount: parseInt(row.error_count || '0', 10),
      avgDuration: parseFloat(row.avg_duration || '0'),
      p99Duration: parseFloat(row.p99_duration || '0'),
    };
  } catch (err) {
    console.error('getQueryMetricsSummary error:', err);
    return { totalQueries: 0, errorCount: 0, avgDuration: 0, p99Duration: 0 };
  }
}

export async function getTopQueries(
  tenantId: string,
  limit: number = 10
): Promise<Array<{ queryHash: string; operationName?: string; count: number; avgDuration: number; errorRate: number }>> {
  try {
    const result = await query<any>(
      `SELECT 
         query_hash,
         operation_name,
         COUNT(*) as count,
         COALESCE(AVG(total_duration_ms), 0) as avg_duration,
         CASE WHEN COUNT(*) > 0 
           THEN (COUNT(CASE WHEN has_errors THEN 1 END)::numeric / COUNT(*) * 100)
           ELSE 0
         END as error_rate
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
      avgDuration: parseFloat(r.avg_duration || '0'),
      errorRate: parseFloat(r.error_rate || '0'),
    }));
  } catch (err) {
    console.error('getTopQueries error:', err);
    return [];
  }
}

export default {
  recordQueryMetric,
  getSubgraphHealth,
  getFieldUsageStats,
  getQueryMetricsSummary,
  getTopQueries,
};
