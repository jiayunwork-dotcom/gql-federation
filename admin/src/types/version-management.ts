export interface SchemaVersion {
  id: string;
  subgraph_id: string;
  tenant_id: string;
  version: number;
  version_major: number;
  version_minor: number;
  version_patch: number;
  version_string: string;
  sdl: string;
  schema_size_bytes: number;
  change_summary: ChangeSummary;
  compatibility: 'COMPATIBLE' | 'BREAKING';
  is_active: boolean;
  published_by?: string;
  published_at: string;
  created_at: string;
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

export interface VersionTimelineResult {
  subgraphId: string;
  subgraphName: string;
  versions: SchemaVersion[];
}

export type CanaryReleaseStatus = 'pending' | 'canary' | 'full_rollout' | 'rolled_back' | 'failed';

export interface PercentHistoryItem {
  percent: number;
  changedAt: string;
  reason: string;
}

export interface CanaryRelease {
  id: string;
  tenant_id: string;
  subgraph_id: string;
  subgraph_name: string;
  old_version_id: string;
  new_version_id: string;
  old_version_string: string;
  new_version_string: string;
  status: CanaryReleaseStatus;
  current_percent: number;
  percent_history: PercentHistoryItem[];
  started_by: string;
  started_at: string;
  completed_at?: string;
  rolled_back_by?: string;
  rollback_reason?: string;
  error_rate_threshold: number;
  auto_full_release_hours: number;
  last_percent_change_at: string;
  created_at: string;
  updated_at: string;
}

export interface CanaryMetricsSummary {
  oldVersion: {
    requestCount: number;
    errorCount: number;
    errorRate: number;
    avgLatencyMs: number;
  };
  newVersion: {
    requestCount: number;
    errorCount: number;
    errorRate: number;
    avgLatencyMs: number;
  };
}

export type ReleaseActionType = 
  | 'start_canary' 
  | 'adjust_percent' 
  | 'full_release' 
  | 'rollback' 
  | 'version_published';

export interface ReleaseAuditLog {
  id: string;
  tenant_id: string;
  subgraph_id: string;
  subgraph_name: string;
  canary_release_id?: string;
  action_type: ReleaseActionType;
  old_version_id?: string;
  new_version_id?: string;
  old_version_string?: string;
  new_version_string?: string;
  old_percent?: number;
  new_percent?: number;
  operator: string;
  reason?: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface VersionCompareResult {
  oldVersion: SchemaVersion;
  newVersion: SchemaVersion;
  changes: ChangeSummary;
}
