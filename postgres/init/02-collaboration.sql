-- ============================================
-- Collaboration Module - Database Schema
-- ============================================

-- ============================================
-- Drafts Table - 用户草稿存储
-- ============================================
CREATE TABLE IF NOT EXISTS drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    sdl TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, subgraph_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_drafts_tenant_id ON drafts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drafts_subgraph_id ON drafts(subgraph_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user_id ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_tenant_user ON drafts(tenant_id, user_id);

-- ============================================
-- Activity Logs Table - 活动流时间线
-- ============================================
CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    subgraph_name VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    action_type VARCHAR(50) NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_id ON activity_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_subgraph_id ON activity_logs(subgraph_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type ON activity_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_subgraph ON activity_logs(tenant_id, subgraph_id, created_at DESC);

-- ============================================
-- Updated_at triggers for new tables
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_drafts_updated_at ON drafts;
CREATE TRIGGER update_drafts_updated_at BEFORE UPDATE ON drafts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Draft History Table - 草稿版本历史
-- ============================================
CREATE TABLE IF NOT EXISTS draft_histories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    sdl TEXT NOT NULL,
    version_number INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_draft_histories_draft_id ON draft_histories(draft_id);
CREATE INDEX IF NOT EXISTS idx_draft_histories_tenant_id ON draft_histories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_draft_histories_subgraph_id ON draft_histories(subgraph_id);
CREATE INDEX IF NOT EXISTS idx_draft_histories_user_id ON draft_histories(user_id);
CREATE INDEX IF NOT EXISTS idx_draft_histories_tenant_user_subgraph ON draft_histories(tenant_id, user_id, subgraph_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_draft_histories_draft_version ON draft_histories(draft_id, version_number DESC);
