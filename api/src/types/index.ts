export interface Tenant {
  id: string;
  name: string;
  display_name: string;
  is_active: boolean;
  max_query_depth: number;
  max_complexity: number;
  max_schema_size_kb: number;
  max_supergraph_size_kb: number;
  settings: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Subgraph {
  id: string;
  tenant_id: string;
  name: string;
  routing_url: string;
  owner_team: string;
  description?: string;
  is_active: boolean;
  current_version_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface SchemaVersion {
  id: string;
  subgraph_id: string;
  tenant_id: string;
  version: number;
  sdl: string;
  schema_size_bytes: number;
  change_summary: ChangeSummary;
  is_active: boolean;
  published_by?: string;
  published_at: Date;
  created_at: Date;
}

export interface ChangeSummary {
  breakingChanges: ChangeItem[];
  nonBreakingChanges: ChangeItem[];
  dangerousChanges: ChangeItem[];
}

export interface ChangeItem {
  type: string;
  description: string;
  path?: string;
  subgraph?: string;
}

export type SupergraphStatus = 'pending' | 'active' | 'grayscale' | 'rolled_back' | 'failed';

export interface SupergraphVersion {
  id: string;
  tenant_id: string;
  version: number;
  sdl: string;
  schema_size_bytes: number;
  composition_result: CompositionResult;
  subgraph_versions: SubgraphVersionRef[];
  status: SupergraphStatus;
  grayscale_start_at?: Date;
  grayscale_percent: number;
  error_count: number;
  total_count: number;
  published_by?: string;
  published_at: Date;
  created_at: Date;
}

export interface SubgraphVersionRef {
  subgraphId: string;
  subgraphName: string;
  versionId: string;
  version: number;
}

export interface CompositionResult {
  success: boolean;
  errors: CompositionError[];
  warnings: CompositionWarning[];
  breakingChanges: ChangeItem[];
  supergraphSdl?: string;
}

export interface CompositionError {
  subgraph: string;
  message: string;
  line?: number;
  column?: number;
}

export interface CompositionWarning {
  type: string;
  message: string;
  subgraph?: string;
}

export interface QueryMetric {
  id: string;
  tenant_id: string;
  supergraph_version_id: string;
  query_hash: string;
  query_text?: string;
  operation_name?: string;
  total_duration_ms: number;
  response_size_bytes: number;
  has_errors: boolean;
  error_message?: string;
  subgraph_metrics: SubgraphMetric[];
  query_plan?: any;
  depth?: number;
  complexity?: number;
  created_at: Date;
}

export interface SubgraphMetric {
  subgraphName: string;
  durationMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

export interface FieldUsage {
  id: string;
  tenant_id: string;
  type_name: string;
  field_name: string;
  subgraph_name?: string;
  usage_count: number;
  last_used_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface SubgraphHealth {
  id: string;
  tenant_id: string;
  subgraph_id: string;
  subgraph_name: string;
  avg_response_time_ms: number;
  p99_response_time_ms: number;
  error_rate: number;
  qps: number;
  total_requests: number;
  error_count: number;
  window_start: Date;
  window_end: Date;
  created_at: Date;
}

export interface AlertConfig {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  subgraph_id?: string;
  threshold: number;
  comparison: string;
  channels: AlertChannel[];
  is_enabled: boolean;
  last_triggered_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook';
  target: string;
}

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: 'super_admin' | 'admin' | 'viewer';
  is_active: boolean;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CompositionLog {
  id: string;
  tenant_id: string;
  supergraph_version_id?: string;
  triggered_by?: string;
  trigger_type: string;
  status: string;
  errors: CompositionError[];
  warnings: CompositionWarning[];
  breaking_changes: ChangeItem[];
  duration_ms?: number;
  created_at: Date;
}
