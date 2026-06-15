-- ============================================
-- GraphQL Federation Platform - Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Tenant Management
-- ============================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    max_query_depth INTEGER NOT NULL DEFAULT 15,
    max_complexity INTEGER NOT NULL DEFAULT 1000,
    max_schema_size_kb INTEGER NOT NULL DEFAULT 500,
    max_supergraph_size_kb INTEGER NOT NULL DEFAULT 5120,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_name ON tenants(name);
CREATE INDEX idx_tenants_is_active ON tenants(is_active);

-- ============================================
-- Subgraph Management
-- ============================================
CREATE TABLE subgraphs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    routing_url VARCHAR(500) NOT NULL,
    owner_team VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    current_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_subgraphs_tenant_id ON subgraphs(tenant_id);
CREATE INDEX idx_subgraphs_name ON subgraphs(name);
CREATE INDEX idx_subgraphs_is_active ON subgraphs(is_active);

-- ============================================
-- Schema Versions
-- ============================================
CREATE TABLE schema_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    sdl TEXT NOT NULL,
    schema_size_bytes INTEGER NOT NULL,
    change_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT false,
    published_by VARCHAR(100),
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schema_versions_subgraph_id ON schema_versions(subgraph_id);
CREATE INDEX idx_schema_versions_tenant_id ON schema_versions(tenant_id);
CREATE INDEX idx_schema_versions_version ON schema_versions(version);
CREATE INDEX idx_schema_versions_is_active ON schema_versions(is_active);
CREATE UNIQUE INDEX idx_schema_versions_subgraph_version ON schema_versions(subgraph_id, version);

-- Add foreign key constraint for current_version_id
ALTER TABLE subgraphs 
ADD CONSTRAINT fk_current_version 
FOREIGN KEY (current_version_id) REFERENCES schema_versions(id) ON DELETE SET NULL;

-- ============================================
-- Supergraph Versions
-- ============================================
CREATE TABLE supergraph_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    sdl TEXT NOT NULL,
    schema_size_bytes INTEGER NOT NULL,
    composition_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    subgraph_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, active, grayscale, rolled_back, failed
    grayscale_start_at TIMESTAMPTZ,
    grayscale_percent INTEGER NOT NULL DEFAULT 10,
    error_count INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    published_by VARCHAR(100),
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supergraph_versions_tenant_id ON supergraph_versions(tenant_id);
CREATE INDEX idx_supergraph_versions_version ON supergraph_versions(tenant_id, version);
CREATE INDEX idx_supergraph_versions_status ON supergraph_versions(status);

-- ============================================
-- Query Metrics
-- ============================================
CREATE TABLE query_metrics (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supergraph_version_id UUID NOT NULL REFERENCES supergraph_versions(id) ON DELETE CASCADE,
    query_hash VARCHAR(64) NOT NULL,
    query_text TEXT,
    operation_name VARCHAR(255),
    total_duration_ms INTEGER NOT NULL,
    response_size_bytes INTEGER NOT NULL,
    has_errors BOOLEAN NOT NULL DEFAULT false,
    error_message TEXT,
    subgraph_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
    query_plan JSONB,
    depth INTEGER,
    complexity INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_query_metrics_tenant_id ON query_metrics(tenant_id);
CREATE INDEX idx_query_metrics_supergraph_version_id ON query_metrics(supergraph_version_id);
CREATE INDEX idx_query_metrics_query_hash ON query_metrics(query_hash);
CREATE INDEX idx_query_metrics_created_at ON query_metrics(created_at);
CREATE INDEX idx_query_metrics_tenant_created ON query_metrics(tenant_id, created_at);

-- ============================================
-- Field Usage Statistics
-- ============================================
CREATE TABLE field_usage (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type_name VARCHAR(255) NOT NULL,
    field_name VARCHAR(255) NOT NULL,
    subgraph_name VARCHAR(100),
    usage_count BIGINT NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, type_name, field_name)
);

CREATE INDEX idx_field_usage_tenant_id ON field_usage(tenant_id);
CREATE INDEX idx_field_usage_type_field ON field_usage(tenant_id, type_name, field_name);
CREATE INDEX idx_field_usage_count ON field_usage(usage_count DESC);

-- ============================================
-- Subgraph Health Status
-- ============================================
CREATE TABLE subgraph_health (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subgraph_id UUID NOT NULL REFERENCES subgraphs(id) ON DELETE CASCADE,
    subgraph_name VARCHAR(100) NOT NULL,
    avg_response_time_ms NUMERIC(10, 2) NOT NULL DEFAULT 0,
    p99_response_time_ms NUMERIC(10, 2) NOT NULL DEFAULT 0,
    error_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
    qps NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_requests BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subgraph_health_tenant_id ON subgraph_health(tenant_id);
CREATE INDEX idx_subgraph_health_subgraph_id ON subgraph_health(subgraph_id);
CREATE INDEX idx_subgraph_health_window ON subgraph_health(window_start, window_end);

-- ============================================
-- Alert Configurations
-- ============================================
CREATE TABLE alert_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- error_rate, latency, schema_change
    subgraph_id UUID REFERENCES subgraphs(id) ON DELETE CASCADE,
    threshold NUMERIC(10, 2) NOT NULL,
    comparison VARCHAR(10) NOT NULL DEFAULT 'gt', -- gt, lt, eq
    channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_configs_tenant_id ON alert_configs(tenant_id);
CREATE INDEX idx_alert_configs_type ON alert_configs(type);
CREATE INDEX idx_alert_configs_is_enabled ON alert_configs(is_enabled);

-- ============================================
-- Users / Admin
-- ============================================
CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'admin', -- super_admin, admin, viewer
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_role ON admin_users(role);

-- ============================================
-- Schema Composition Log
-- ============================================
CREATE TABLE composition_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supergraph_version_id UUID REFERENCES supergraph_versions(id) ON DELETE SET NULL,
    triggered_by VARCHAR(100),
    trigger_type VARCHAR(50) NOT NULL, -- manual, schema_change, rollback
    status VARCHAR(20) NOT NULL, -- success, failed, partial
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    breaking_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_composition_logs_tenant_id ON composition_logs(tenant_id);
CREATE INDEX idx_composition_logs_status ON composition_logs(status);
CREATE INDEX idx_composition_logs_created_at ON composition_logs(created_at);

-- ============================================
-- Insert initial data
-- ============================================

-- Create default tenant
INSERT INTO tenants (name, display_name, is_active)
VALUES ('default', 'Default Tenant', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subgraphs_updated_at BEFORE UPDATE ON subgraphs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_field_usage_updated_at BEFORE UPDATE ON field_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alert_configs_updated_at BEFORE UPDATE ON alert_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
