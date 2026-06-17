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
  published_at: Date;
  created_at: Date;
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
  started_at: Date;
  completed_at?: Date;
  rolled_back_by?: string;
  rollback_reason?: string;
  error_rate_threshold: number;
  auto_full_release_hours: number;
  last_percent_change_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CanaryMetric {
  id: string;
  tenant_id: string;
  canary_release_id: string;
  subgraph_id: string;
  version_type: 'old' | 'new';
  request_count: number;
  error_count: number;
  avg_latency_ms: number;
  window_start: Date;
  window_end: Date;
  created_at: Date;
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

export type ApprovalStatus = 'pending_approval' | 'approved' | 'rejected' | 'validation_failed' | 'resubmitted';

export interface DiffSummary {
  addedFields: number;
  removedFields: number;
  modifiedTypes: number;
  addedTypes: number;
  removedTypes: number;
  details: {
    addedFields: string[];
    removedFields: string[];
    modifiedTypes: string[];
    addedTypes: string[];
    removedTypes: string[];
  };
}

export interface SchemaChangeApproval {
  id: string;
  tenant_id: string;
  subgraph_id: string;
  subgraph_name: string;
  schema_version_id?: string;
  submitted_by: string;
  changelog?: string;
  diff_summary: DiffSummary;
  status: ApprovalStatus;
  reviewed_by?: string;
  review_comment?: string;
  reviewed_at?: Date;
  composition_result?: CompositionResult;
  created_at: Date;
  updated_at: Date;
}

export interface DependencyEdge {
  source: string;
  target: string;
  entities: string[];
  fields: Record<string, string[]>;
}

export interface DependencyGraph {
  nodes: Array<{
    id: string;
    name: string;
    owner: string;
    latestVersion: number;
    health: string;
  }>;
  edges: DependencyEdge[];
}

export interface SchemaDiffLine {
  lineNumber: number;
  content: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  typeName?: string;
}

export interface SchemaDiffResult {
  leftLines: SchemaDiffLine[];
  rightLines: SchemaDiffLine[];
  structuredSummary: {
    addedTypes: string[];
    removedTypes: string[];
    addedFields: string[];
    removedFields: string[];
    typeChanges: Array<{ path: string; fromType: string; toType: string }>;
  };
  typeSections: Array<{
    typeName: string;
    leftRange: { start: number; end: number };
    rightRange: { start: number; end: number };
  }>;
}

export interface Draft {
  id: string;
  tenant_id: string;
  subgraph_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  sdl: string;
  created_at: Date;
  updated_at: Date;
}

export interface DraftHistory {
  id: string;
  draft_id: string;
  tenant_id: string;
  subgraph_id: string;
  user_id: string;
  sdl: string;
  version_number: number;
  created_at: Date;
}

export interface RemoteCursor {
  userId: string;
  userName: string;
  userEmail: string;
  subgraphId: string;
  lineNumber: number;
  columnNumber: number;
  lastUpdate: number;
  fadingOut?: boolean;
}

export type ActionType = 
  | 'lock_acquired'
  | 'lock_released'
  | 'lock_transferred'
  | 'draft_saved'
  | 'change_submitted'
  | 'change_approved'
  | 'change_rejected'
  | 'user_joined'
  | 'user_left';

export interface ActivityLog {
  id: string;
  tenant_id: string;
  subgraph_id: string;
  subgraph_name: string;
  user_id?: string;
  user_email?: string;
  user_name?: string;
  action_type: ActionType;
  payload?: Record<string, any>;
  created_at: Date;
}

export type NotificationEventType = 
  | 'approval_status_changed'
  | 'supergraph_published'
  | 'subgraph_health_alert'
  | 'grayscale_progress'
  | 'lock_status_changed'
  | 'user_presence_changed'
  | 'activity_logged'
  | 'heartbeat_ack'
  | 'pong'
  | 'cursor_position_changed';

export interface NotificationMessage {
  type: NotificationEventType;
  timestamp: string;
  subgraphName?: string;
  subgraphId?: string;
  payload: Record<string, any>;
}

export interface OnlineUser {
  userId: string;
  userName: string;
  userEmail: string;
  subgraphId?: string;
  lastHeartbeat: number;
}

export interface LockStatus {
  isLocked: boolean;
  holder?: {
    userId: string;
    userName: string;
    userEmail: string;
    acquiredAt: number;
  };
  waitingQueue: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    position: number;
  }>;
}

export interface SyntaxValidationResult {
  valid: boolean;
  errors?: Array<{
    line: number;
    column: number;
    message: string;
  }>;
}

export type CompatibilityLevel = 'COMPATIBLE' | 'BREAKING' | 'WARNING';

export interface CompatibilityCheckItem {
  type: string;
  description: string;
  path?: string;
  level: CompatibilityLevel;
}

export interface CompatibilityCheckResult {
  items: CompatibilityCheckItem[];
  hasBreakingChanges: boolean;
  breakingCount: number;
  compatibleCount: number;
  warningCount: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

export interface SchemaDiffPreview {
  leftLines: Array<{
    lineNumber: number;
    content: string;
    type: 'added' | 'removed' | 'modified' | 'unchanged';
  }>;
  rightLines: Array<{
    lineNumber: number;
    content: string;
    type: 'added' | 'removed' | 'modified' | 'unchanged';
  }>;
  stats: DiffStats;
  compatibility: CompatibilityCheckResult;
}
