export interface SubgraphInfo {
  id: string;
  name: string;
  routingUrl: string;
  sdl: string;
}

export interface SupergraphInfo {
  id: string;
  version: number;
  sdl: string;
  status: string;
  subgraphs: SubgraphInfo[];
}

export interface QueryPlan {
  steps: QueryPlanStep[];
  variables?: any;
  operationName?: string;
}

export interface QueryPlanStep {
  id: string;
  type: 'fetch' | 'flatten' | 'parallel' | 'sequence';
  subgraphName?: string;
  operation?: string;
  selectionSet?: string;
  dependsOn?: string[];
  path?: string;
  entityType?: string;
  keyFields?: string[];
  children?: QueryPlanStep[];
}

export interface SubgraphResponse {
  data?: any;
  errors?: Array<{ message: string; path?: string[] }>;
  extensions?: any;
}

export interface ExecutionResult {
  data?: any;
  errors?: Array<{ message: string; path?: string[] }>;
  extensions?: {
    queryPlan?: QueryPlan;
    subgraphMetrics?: SubgraphMetric[];
    duration?: number;
  };
}

export interface SubgraphMetric {
  subgraphName: string;
  durationMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

export interface FieldInfo {
  typeName: string;
  fieldName: string;
  subgraphName?: string;
}

export interface DepthAndComplexityResult {
  depth: number;
  complexity: number;
  fields: FieldInfo[];
}

export interface TenantConfig {
  id: string;
  name: string;
  maxQueryDepth: number;
  maxComplexity: number;
}
