import axios from 'axios';
import config from '../config';
import { SubgraphMetric, FieldInfo } from '../types';

export interface RecordMetricsInput {
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
  fields?: FieldInfo[];
}

export async function recordMetrics(input: RecordMetricsInput): Promise<void> {
  try {
    await axios.post(
      `${config.apiUrl}/api/metrics/record`,
      input,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': input.tenantId,
        },
        timeout: 2000,
      }
    );
  } catch (err: any) {
    console.warn('Failed to record metrics:', err.message);
  }
}

export async function batchRecordMetrics(inputs: RecordMetricsInput[]): Promise<void> {
  if (inputs.length === 0) return;
  
  for (const input of inputs) {
    await recordMetrics(input);
  }
}

export default {
  recordMetrics,
  batchRecordMetrics,
};
