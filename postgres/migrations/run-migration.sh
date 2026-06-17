#!/bin/bash
# ============================================
# Database Migration Script for Schema Version Management
# This script applies incremental migrations on an already running environment
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "============================================"
echo "Schema Version Management - Database Migration"
echo "============================================"
echo ""

# Check if docker compose is available
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    echo "ERROR: docker-compose or docker compose is not available"
    exit 1
fi

cd "$PROJECT_DIR"

echo "[1/4] Checking PostgreSQL container status..."
if ! $DOCKER_COMPOSE ps postgres | grep -q "Up"; then
    echo "ERROR: PostgreSQL container is not running"
    echo "Please start the services first: $DOCKER_COMPOSE up -d"
    exit 1
fi
echo "  PostgreSQL container is running"

echo ""
echo "[2/4] Applying 03-version-management.sql (creating tables and columns)..."
$DOCKER_COMPOSE exec -T postgres psql -U postgres -d gql_federation -f /docker-entrypoint-initdb.d/03-version-management.sql 2>&1 || {
    echo "  Note: Some tables/columns may already exist, continuing..."
}

echo ""
echo "[3/4] Applying 04-data-migration-backfill.sql (backfilling existing data)..."
$DOCKER_COMPOSE cp "$SCRIPT_DIR/04-data-migration-backfill.sql" postgres:/tmp/04-data-migration-backfill.sql
$DOCKER_COMPOSE exec -T postgres psql -U postgres -d gql_federation -f /tmp/04-data-migration-backfill.sql
$DOCKER_COMPOSE exec -T postgres rm -f /tmp/04-data-migration-backfill.sql

echo ""
echo "[4/4] Verifying migration results..."
echo ""
echo "--- SubGraphs with current versions ---"
$DOCKER_COMPOSE exec -T postgres psql -U postgres -d gql_federation -c "
SELECT s.name AS subgraph_name, sv.version_string, sv.compatibility, sv.is_active
FROM subgraphs s
LEFT JOIN schema_versions sv ON sv.id = s.current_version_id
ORDER BY s.name;
"
echo ""
echo "--- Recent schema versions (up to 10) ---"
$DOCKER_COMPOSE exec -T postgres psql -U postgres -d gql_federation -c "
SELECT s.name AS subgraph_name, sv.version, sv.version_string, sv.compatibility, sv.published_at
FROM schema_versions sv
JOIN subgraphs s ON s.id = sv.subgraph_id
ORDER BY sv.published_at DESC
LIMIT 10;
"

echo ""
echo "============================================"
echo "Migration completed successfully!"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Restart the API service to pick up new routes: $DOCKER_COMPOSE restart api"
echo "2. Access the Admin UI and navigate to 'Version Management' page"
echo "3. Verify that version timelines are displayed correctly"
echo ""
