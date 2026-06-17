-- ============================================
-- Incremental Migration: Data Backfill
-- Run this after 03-version-management.sql on existing databases
-- ============================================

-- ============================================
-- 1. Backfill semantic version columns for existing schema_versions
-- ============================================
-- This assigns v1.0.0, v1.1.0, v2.0.0 etc. based on the version integer
-- and marks versions as COMPATIBLE by default (existing versions are assumed compatible)

DO $$
DECLARE
    v_record RECORD;
    v_last_major INTEGER := 0;
    v_last_minor INTEGER := 0;
    v_current_subgraph UUID;
    v_subgraph_versions CURSOR (sid UUID) IS
        SELECT * FROM schema_versions 
        WHERE subgraph_id = sid 
        ORDER BY version ASC;
BEGIN
    FOR v_record IN SELECT DISTINCT subgraph_id FROM schema_versions ORDER BY subgraph_id LOOP
        v_last_major := 0;
        v_last_minor := -1;
        v_current_subgraph := v_record.subgraph_id;
        
        FOR sv IN v_subgraph_versions(v_current_subgraph) LOOP
            v_last_minor := v_last_minor + 1;
            
            IF sv.is_active THEN
                v_last_major := v_last_major + 1;
                v_last_minor := 0;
            END IF;
            
            IF v_last_major = 0 THEN
                v_last_major := 1;
            END IF;
            
            UPDATE schema_versions
            SET 
                version_major = v_last_major,
                version_minor = v_last_minor,
                version_patch = 0,
                version_string = 'v' || v_last_major || '.' || v_last_minor || '.0',
                compatibility = COALESCE(compatibility, 'COMPATIBLE')
            WHERE id = sv.id;
        END LOOP;
    END LOOP;
END $$;

-- ============================================
-- 2. Ensure subgraphs.current_version_id is set for all subgraphs
-- ============================================
UPDATE subgraphs s
SET current_version_id = (
    SELECT sv.id 
    FROM schema_versions sv 
    WHERE sv.subgraph_id = s.id 
    ORDER BY sv.version DESC 
    LIMIT 1
)
WHERE s.current_version_id IS NULL;

-- ============================================
-- 3. Mark the latest schema_version as is_active=true for each subgraph
-- ============================================
UPDATE schema_versions sv
SET is_active = true
WHERE id IN (
    SELECT s.current_version_id 
    FROM subgraphs s 
    WHERE s.current_version_id IS NOT NULL
);

-- Also ensure only one active version per subgraph
UPDATE schema_versions sv1
SET is_active = false
WHERE is_active = true
AND id NOT IN (
    SELECT s.current_version_id 
    FROM subgraphs s 
    WHERE s.current_version_id IS NOT NULL
    AND s.id = sv1.subgraph_id
);

-- ============================================
-- 4. Verify migration results
-- ============================================
-- Check semantic versions are filled
SELECT 
    s.name AS subgraph_name,
    sv.version,
    sv.version_string,
    sv.version_major,
    sv.version_minor,
    sv.version_patch,
    sv.compatibility,
    sv.is_active
FROM schema_versions sv
JOIN subgraphs s ON s.id = sv.subgraph_id
ORDER BY s.name, sv.version;

-- Check subgraph current_version_id
SELECT 
    s.name AS subgraph_name,
    s.current_version_id,
    sv.version_string AS current_version
FROM subgraphs s
LEFT JOIN schema_versions sv ON sv.id = s.current_version_id
ORDER BY s.name;
