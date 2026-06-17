export interface Draft {
  id: string;
  tenant_id: string;
  subgraph_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  sdl: string;
  subgraph_name?: string;
  created_at: string;
  updated_at: string;
}

export interface DraftHistory {
  id: string;
  draft_id: string;
  tenant_id: string;
  subgraph_id: string;
  user_id: string;
  sdl: string;
  version_number: number;
  created_at: string;
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
  created_at: string;
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

export interface Subgraph {
  id: string;
  name: string;
  routing_url: string;
  owner_team: string;
  description?: string;
  is_active: boolean;
  current_version_id?: string;
  created_at: string;
  updated_at: string;
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
