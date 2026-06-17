-- ============================================
-- Schema Version Management & Canary Release
-- ============================================

-- Add semantic version columns to schema_versions
ALTER TABLE schema_versions 
ADD COLUMN IF NOT EXISTS version_major INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS version_minor INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS version_patch INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS compatibility VARCHAR(20) NOT NULL DEFAULT 'COMPATIBLE', -- COMPATIBLE, BREAKING
ADD COLUMN IF NOT EXISTS version_string VARCHAR(20) NOT NULL DEFAULT 'v1.0.0';

CREATE INDEX IF NOT EXISTS idx_schema_versions_version_string ON schema_versions(version_string);

-- ============================================
-- Canary Releases
-- ============================================
CREATE TABLE IF NOT EXISTS canary_releases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    subgraph_name VARCHAR(100) NOT NULL,
    old_version_id UUID NOT NULL REFERENCES schema_versions(id) ON DELETE CASCADE,
    new_version_id UUID NOT NULL REFERENCES schema_versions(id) ON DELETE CASCADE,
    old_version_string VARCHAR(20) NOT NULL,
    new_version_string VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, canary, full_rollout, rolled_back, failed
    current_percent INTEGER NOT NULL DEFAULT 0, -- 0, 10, 25, 50, 75, 100
    percent_history JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{percent: 10, changedAt: timestamp, reason: string}]
    started_by VARCHAR(100) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    rolled_back_by VARCHAR(100),
    rollback_reason TEXT,
    error_rate_threshold NUMERIC(5, 2) NOT NULL DEFAULT 5.0,
    auto_full_release_hours INTEGER NOT NULL DEFAULT 24,
    last_percent_change_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canary_releases_tenant_id ON canary_releases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canary_releases_subgraph_id ON canary_releases(subgraph_id);
CREATE INDEX IF NOT EXISTS idx_canary_releases_status ON canary_releases(status);
CREATE INDEX IF NOT EXISTS idx_canary_releases_created_at ON canary_releases(created_at DESC);

-- ============================================
-- Canary Metrics (per-minute granularity)
-- ============================================
CREATE TABLE IF NOT EXISTS canary_metrics (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    canary_release_id UUID NOT NULL REFERENCES canary_releases(id) ON DELETE CASCADE,
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    version_type VARCHAR(10) NOT NULL, -- old, new
    request_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms NUMERIC(10, 2) NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canary_metrics_unique ON canary_metrics(canary_release_id, version_type, window_start);
CREATE INDEX IF NOT EXISTS idx_canary_metrics_canary_id ON canary_metrics(canary_release_id);
CREATE INDEX IF NOT EXISTS idx_canary_metrics_version_type ON canary_metrics(version_type);
CREATE INDEX IF NOT EXISTS idx_canary_metrics_window ON canary_metrics(window_start, window_end);

-- ============================================
-- Release Audit Logs
-- ============================================
CREATE TABLE IF NOT EXISTS release_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    subgraph_name VARCHAR(100) NOT NULL,
    canary_release_id UUID REFERENCES canary_releases(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL, -- start_canary, adjust_percent, full_release, rollback, version_published
    old_version_id UUID REFERENCES schema_versions(id),
    new_version_id UUID REFERENCES schema_versions(id),
    old_version_string VARCHAR(20),
    new_version_string VARCHAR(20),
    old_percent INTEGER,
    new_percent INTEGER,
    operator VARCHAR(100) NOT NULL,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_audit_logs_tenant_id ON release_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_release_audit_logs_subgraph_id ON release_audit_logs(subgraph_id);
CREATE INDEX IF NOT EXISTS idx_release_audit_logs_action_type ON release_audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_release_audit_logs_created_at ON release_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_audit_logs_canary_id ON release_audit_logs(canary_release_id);

-- ============================================
-- Updated_at triggers for new tables
-- ============================================
DROP TRIGGER IF EXISTS update_canary_releases_updated_at ON canary_releases;
CREATE TRIGGER update_canary_releases_updated_at BEFORE UPDATE ON canary_releases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
