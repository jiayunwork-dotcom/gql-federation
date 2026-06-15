import axios from 'axios';
import { QueryPlan, QueryPlanStep, SubgraphResponse, ExecutionResult, SubgraphMetric, SubgraphInfo } from '../types';
import config from '../config';

export interface ExecutionContext {
  subgraphs: SubgraphInfo[];
  supergraphVersionId: string;
  authHeaders: Record<string, string>;
  variables?: any;
  operationName?: string;
}

export async function executeQueryPlan(
  queryPlan: QueryPlan,
  context: ExecutionContext
): Promise<{ result: ExecutionResult; metrics: SubgraphMetric[] }> {
  const metrics: SubgraphMetric[] = [];
  const results: Record<string, any> = {};

  const steps = queryPlan.steps;
  const executedSteps = new Set<string>();

  while (executedSteps.size < steps.length) {
    const runnableSteps = steps.filter(step => {
      if (executedSteps.has(step.id)) return false;
      if (!step.dependsOn || step.dependsOn.length === 0) return true;
      return step.dependsOn.every(dep => executedSteps.has(dep));
    });

    if (runnableSteps.length === 0) {
      break;
    }

    const parallelPromises = runnableSteps.map(async step => {
      const subgraph = context.subgraphs.find(s => s.name === step.subgraphName);
      if (!subgraph) {
        metrics.push({
          subgraphName: step.subgraphName || 'unknown',
          durationMs: 0,
          status: 'error',
          errorMessage: `Subgraph ${step.subgraphName} not found`,
        });
        results[step.id] = { data: null, errors: [{ message: `Subgraph ${step.subgraphName} not found` }] };
        return step.id;
      }

      const startTime = Date.now();
      try {
        const response = await executeSubgraphRequest(
          subgraph,
          step,
          context.authHeaders,
          context.variables,
          context.operationName
        );
        const durationMs = Date.now() - startTime;

        metrics.push({
          subgraphName: subgraph.name,
          durationMs,
          status: 'success',
        });

        results[step.id] = response;
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        metrics.push({
          subgraphName: subgraph.name,
          durationMs,
          status: 'error',
          errorMessage: err.message,
        });
        results[step.id] = { data: null, errors: [{ message: err.message }] };
      }

      return step.id;
    });

    const executed = await Promise.all(parallelPromises);
    executed.forEach(id => executedSteps.add(id));
  }

  const mergedResult = mergeResults(results, queryPlan);

  return {
    result: {
      data: mergedResult.data,
      errors: mergedResult.errors,
      extensions: {
        queryPlan,
        subgraphMetrics: metrics,
      },
    },
    metrics,
  };
}

async function executeSubgraphRequest(
  subgraph: SubgraphInfo,
  step: QueryPlanStep,
  authHeaders: Record<string, string>,
  variables?: any,
  operationName?: string
): Promise<SubgraphResponse> {
  const query = buildSubgraphQuery(step);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders,
  };

  const response = await axios.post(
    subgraph.routingUrl,
    {
      query,
      variables,
      operationName,
    },
    {
      headers,
      timeout: 30000,
    }
  );

  return response.data as SubgraphResponse;
}

function buildSubgraphQuery(step: QueryPlanStep): string {
  if (step.entityType && step.keyFields) {
    return `
      query Entities($representations: [_Any!]!) {
        _entities(representations: $representations) {
          ... on ${step.entityType} {
            ${step.selectionSet?.replace(/[{}]/g, '') || ''}
          }
        }
      }
    `;
  }

  return `query ${step.selectionSet || '{}'}`;
}

function mergeResults(
  results: Record<string, any>,
  queryPlan: QueryPlan
): { data?: any; errors?: any[] } {
  const errors: any[] = [];
  let data: any = {};

  for (const step of queryPlan.steps) {
    const stepResult = results[step.id];
    if (stepResult?.errors) {
      errors.push(...stepResult.errors);
    }
    if (stepResult?.data) {
      data = deepMerge(data, stepResult.data);
    }
  }

  return {
    data: Object.keys(data).length > 0 ? data : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function deepMerge(target: any, source: any): any {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }

  return output;
}

function isObject(item: any): boolean {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

export async function executeSimpleQuery(
  query: string,
  subgraphs: SubgraphInfo[],
  authHeaders: Record<string, string>,
  variables?: any
): Promise<{ result: ExecutionResult; metrics: SubgraphMetric[] }> {
  const metrics: SubgraphMetric[] = [];
  const allErrors: any[] = [];
  let mergedData: any = {};

  const promises = subgraphs.map(async subgraph => {
    const startTime = Date.now();
    try {
      const response = await axios.post(
        subgraph.routingUrl,
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          timeout: 30000,
        }
      );

      const durationMs = Date.now() - startTime;
      metrics.push({
        subgraphName: subgraph.name,
        durationMs,
        status: 'success',
      });

      return response.data;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      metrics.push({
        subgraphName: subgraph.name,
        durationMs,
        status: 'error',
        errorMessage: err.message,
      });
      return { errors: [{ message: err.message }] };
    }
  });

  const responses = await Promise.all(promises);

  for (const resp of responses) {
    if (resp.errors) {
      allErrors.push(...resp.errors);
    }
    if (resp.data) {
      mergedData = deepMerge(mergedData, resp.data);
    }
  }

  const result: ExecutionResult = {
    data: Object.keys(mergedData).length > 0 ? mergedData : undefined,
    errors: allErrors.length > 0 ? allErrors : undefined,
    extensions: {
      subgraphMetrics: metrics,
    },
  };

  return { result, metrics };
}

export default {
  executeQueryPlan,
  executeSimpleQuery,
};
