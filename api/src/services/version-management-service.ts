import { query } from '../db';
import { SchemaVersion, ChangeSummary } from '../types';
import { getSubgraphById, getSchemaVersions, getSchemaVersionById, getLatestSchemaVersion } from './subgraph-service';
import { detectChanges } from './schema-composition';

export interface GetVersionsParams {
  tenantId: string;
  subgraphId?: string;
  subgraphName?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

export interface VersionListResult {
  subgraphId: string;
  subgraphName: string;
  versions: SchemaVersion[];
}

export async function getVersionsTimeline(
  params: GetVersionsParams
): Promise<VersionListResult[]> {
  const { tenantId, subgraphId, startTime, endTime, limit = 50 } = params;

  let subgraphQuery = `
    SELECT s.id, s.name 
    FROM subgraphs s 
    WHERE s.tenant_id = $1 AND s.is_active = true
  `;
  const queryParams: any[] = [tenantId];
  let paramIndex = 2;

  if (subgraphId) {
    subgraphQuery += ` AND s.id = $${paramIndex++}`;
    queryParams.push(subgraphId);
  }

  if (params.subgraphName) {
    subgraphQuery += ` AND s.name ILIKE $${paramIndex++}`;
    queryParams.push(`%${params.subgraphName}%`);
  }

  subgraphQuery += ` ORDER BY s.name ASC`;

  const subgraphResult = await query<{ id: string; name: string }>(subgraphQuery, queryParams);
  
  const results: VersionListResult[] = [];

  for (const subgraph of subgraphResult.rows) {
    let versionQuery = `
      SELECT * FROM schema_versions 
      WHERE subgraph_id = $1 AND tenant_id = $2
    `;
    const versionParams: any[] = [subgraph.id, tenantId];
    let vParamIndex = 3;

    if (startTime) {
      versionQuery += ` AND published_at >= $${vParamIndex++}`;
      versionParams.push(startTime);
    }
    if (endTime) {
      versionQuery += ` AND published_at <= $${vParamIndex++}`;
      versionParams.push(endTime);
    }

    versionQuery += ` ORDER BY version DESC LIMIT $${vParamIndex++}`;
    versionParams.push(limit);

    const versionResult = await query<SchemaVersion>(versionQuery, versionParams);
    
    results.push({
      subgraphId: subgraph.id,
      subgraphName: subgraph.name,
      versions: versionResult.rows.reverse(),
    });
  }

  return results;
}

export async function getVersionDetail(
  versionId: string,
  tenantId: string
): Promise<SchemaVersion | null> {
  const result = await query<SchemaVersion>(
    'SELECT * FROM schema_versions WHERE id = $1 AND tenant_id = $2',
    [versionId, tenantId]
  );
  return result.rows[0] || null;
}

export async function generateNextVersion(
  subgraphId: string,
  compatibility: 'COMPATIBLE' | 'BREAKING'
): Promise<{ major: number; minor: number; patch: number; versionString: string }> {
  const latestVersion = await getLatestSchemaVersion(subgraphId);
  
  if (!latestVersion) {
    return { major: 1, minor: 0, patch: 0, versionString: 'v1.0.0' };
  }

  let major = latestVersion.version_major || 1;
  let minor = latestVersion.version_minor || 0;
  let patch = 0;

  if (compatibility === 'BREAKING') {
    major += 1;
    minor = 0;
  } else {
    minor += 1;
  }

  const versionString = `v${major}.${minor}.${patch}`;
  return { major, minor, patch, versionString };
}

export async function updateSchemaVersionWithSemantic(
  versionId: string,
  major: number,
  minor: number,
  patch: number,
  versionString: string,
  compatibility: 'COMPATIBLE' | 'BREAKING'
): Promise<void> {
  await query(
    `UPDATE schema_versions 
     SET version_major = $1, version_minor = $2, version_patch = $3, 
         version_string = $4, compatibility = $5
     WHERE id = $6`,
    [major, minor, patch, versionString, compatibility, versionId]
  );
}

export async function compareVersions(
  versionId1: string,
  versionId2: string,
  tenantId: string
): Promise<{
  oldVersion: SchemaVersion;
  newVersion: SchemaVersion;
  changes: ChangeSummary;
}> {
  const v1 = await getVersionDetail(versionId1, tenantId);
  const v2 = await getVersionDetail(versionId2, tenantId);

  if (!v1 || !v2) {
    throw new Error('One or both versions not found');
  }

  if (v1.subgraph_id !== v2.subgraph_id) {
    throw new Error('Cannot compare versions from different subgraphs');
  }

  const olderVersion = v1.version < v2.version ? v1 : v2;
  const newerVersion = v1.version < v2.version ? v2 : v1;

  const changes = detectChanges(olderVersion.sdl, newerVersion.sdl);

  return {
    oldVersion: olderVersion,
    newVersion: newerVersion,
    changes,
  };
}

export default {
  getVersionsTimeline,
  getVersionDetail,
  generateNextVersion,
  updateSchemaVersionWithSemantic,
  compareVersions,
};
