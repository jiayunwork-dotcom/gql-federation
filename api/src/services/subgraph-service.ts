import { query } from '../db';
import { Subgraph, SchemaVersion, Tenant, ChangeSummary } from '../types';
import { composeSchemas, detectChanges, validateSchemaSize } from './schema-composition';

export interface CreateSubgraphInput {
  tenantId: string;
  name: string;
  routingUrl: string;
  ownerTeam: string;
  description?: string;
  sdl: string;
  publishedBy?: string;
}

export interface UpdateSchemaInput {
  subgraphId: string;
  tenantId: string;
  sdl: string;
  publishedBy?: string;
}

export async function getSubgraphsByTenant(tenantId: string): Promise<Subgraph[]> {
  const result = await query<Subgraph>(
    'SELECT * FROM subgraphs WHERE tenant_id = $1 ORDER BY name ASC',
    [tenantId]
  );
  return result.rows;
}

export async function getSubgraphById(id: string, tenantId: string): Promise<Subgraph | null> {
  const result = await query<Subgraph>(
    'SELECT * FROM subgraphs WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  return result.rows[0] || null;
}

export async function getSubgraphByName(name: string, tenantId: string): Promise<Subgraph | null> {
  const result = await query<Subgraph>(
    'SELECT * FROM subgraphs WHERE name = $1 AND tenant_id = $2',
    [name, tenantId]
  );
  return result.rows[0] || null;
}

export async function getActiveSubgraphsWithSchema(tenantId: string): Promise<Array<{ subgraph: Subgraph; version: SchemaVersion | null }>> {
  const result = await query<{ subgraph_id: string; version_id: string }>(
    `SELECT s.id as subgraph_id, s.current_version_id as version_id 
     FROM subgraphs s 
     WHERE s.tenant_id = $1 AND s.is_active = true AND s.current_version_id IS NOT NULL`,
    [tenantId]
  );

  const subgraphs: Array<{ subgraph: Subgraph; version: SchemaVersion | null }> = [];
  
  for (const row of result.rows) {
    const subgraph = await getSubgraphById(row.subgraph_id, tenantId);
    const version = row.version_id ? await getSchemaVersionById(row.version_id) : null;
    if (subgraph) {
      subgraphs.push({ subgraph, version });
    }
  }

  return subgraphs;
}

export async function getSchemaVersions(subgraphId: string, limit: number = 20): Promise<SchemaVersion[]> {
  const result = await query<SchemaVersion>(
    'SELECT * FROM schema_versions WHERE subgraph_id = $1 ORDER BY version DESC LIMIT $2',
    [subgraphId, limit]
  );
  return result.rows;
}

export async function getSchemaVersionById(versionId: string): Promise<SchemaVersion | null> {
  const result = await query<SchemaVersion>(
    'SELECT * FROM schema_versions WHERE id = $1',
    [versionId]
  );
  return result.rows[0] || null;
}

export async function getLatestSchemaVersion(subgraphId: string): Promise<SchemaVersion | null> {
  const result = await query<SchemaVersion>(
    'SELECT * FROM schema_versions WHERE subgraph_id = $1 ORDER BY version DESC LIMIT 1',
    [subgraphId]
  );
  return result.rows[0] || null;
}

export async function getActiveSchemaVersion(subgraphId: string): Promise<SchemaVersion | null> {
  const result = await query<SchemaVersion>(
    'SELECT * FROM schema_versions WHERE subgraph_id = $1 AND is_active = true LIMIT 1',
    [subgraphId]
  );
  return result.rows[0] || null;
}

export async function createSubgraph(input: CreateSubgraphInput): Promise<{ subgraph: Subgraph; version: SchemaVersion }> {
  const tenantResult = await query<Tenant>(
    'SELECT * FROM tenants WHERE id = $1',
    [input.tenantId]
  );
  
  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  const tenant = tenantResult.rows[0];
  const sizeCheck = validateSchemaSize(input.sdl, tenant.max_schema_size_kb);
  if (!sizeCheck.valid) {
    throw new Error(`Schema size exceeds maximum allowed size of ${tenant.max_schema_size_kb}KB`);
  }

  const existing = await getSubgraphByName(input.name, input.tenantId);
  if (existing) {
    throw new Error(`Subgraph with name "${input.name}" already exists`);
  }

  const changes = detectChanges(null, input.sdl);

  const subgraphResult = await query<Subgraph>(
    `INSERT INTO subgraphs (tenant_id, name, routing_url, owner_team, description, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING *`,
    [input.tenantId, input.name, input.routingUrl, input.ownerTeam, input.description || null]
  );

  const subgraph = subgraphResult.rows[0];

  const versionResult = await query<SchemaVersion>(
    `INSERT INTO schema_versions (subgraph_id, tenant_id, version, sdl, schema_size_bytes, change_summary, is_active, published_by)
     VALUES ($1, $2, 1, $3, $4, $5, true, $6)
     RETURNING *`,
    [subgraph.id, input.tenantId, input.sdl, sizeCheck.sizeBytes, JSON.stringify(changes), input.publishedBy || null]
  );

  const version = versionResult.rows[0];

  await query(
    'UPDATE subgraphs SET current_version_id = $1 WHERE id = $2',
    [version.id, subgraph.id]
  );

  return { subgraph: { ...subgraph, current_version_id: version.id }, version };
}

export async function updateSubgraphSchema(input: UpdateSchemaInput): Promise<{ version: SchemaVersion; changes: ChangeSummary; compositionSuccess: boolean; compositionErrors?: any[] }> {
  const subgraph = await getSubgraphById(input.subgraphId, input.tenantId);
  if (!subgraph) {
    throw new Error('Subgraph not found');
  }

  const tenantResult = await query<Tenant>(
    'SELECT * FROM tenants WHERE id = $1',
    [input.tenantId]
  );
  const tenant = tenantResult.rows[0];

  const sizeCheck = validateSchemaSize(input.sdl, tenant.max_schema_size_kb);
  if (!sizeCheck.valid) {
    throw new Error(`Schema size exceeds maximum allowed size of ${tenant.max_schema_size_kb}KB`);
  }

  const latestVersion = await getLatestSchemaVersion(input.subgraphId);
  const latestSdl = latestVersion?.sdl || null;
  const changes = detectChanges(latestSdl, input.sdl);

  const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

  const versionResult = await query<SchemaVersion>(
    `INSERT INTO schema_versions (subgraph_id, tenant_id, version, sdl, schema_size_bytes, change_summary, is_active, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7)
     RETURNING *`,
    [input.subgraphId, input.tenantId, nextVersion, input.sdl, sizeCheck.sizeBytes, JSON.stringify(changes), input.publishedBy || null]
  );

  const version = versionResult.rows[0];

  const activeSubgraphs = await getActiveSubgraphsWithSchema(input.tenantId);
  const subgraphSchemas = activeSubgraphs
    .filter(sg => sg.version && sg.subgraph.id !== input.subgraphId)
    .map(sg => ({ name: sg.subgraph.name, sdl: sg.version!.sdl }));

  subgraphSchemas.push({ name: subgraph.name, sdl: input.sdl });

  const compositionResult = composeSchemas(subgraphSchemas);

  if (compositionResult.success && changes.breakingChanges.length === 0) {
    await query(
      `UPDATE schema_versions SET is_active = true WHERE id = $1`,
      [version.id]
    );
    await query(
      'UPDATE subgraphs SET current_version_id = $1 WHERE id = $2',
      [version.id, input.subgraphId]
    );
    if (latestVersion) {
      await query(
        'UPDATE schema_versions SET is_active = false WHERE id = $1',
        [latestVersion.id]
      );
    }
    return { version, changes, compositionSuccess: true };
  }

  return {
    version,
    changes,
    compositionSuccess: compositionResult.success,
    compositionErrors: compositionResult.errors,
  };
}

export async function rollbackSchemaVersion(
  subgraphId: string,
  versionId: string,
  tenantId: string
): Promise<{ success: boolean; message?: string }> {
  const subgraph = await getSubgraphById(subgraphId, tenantId);
  if (!subgraph) {
    throw new Error('Subgraph not found');
  }

  const targetVersion = await getSchemaVersionById(versionId);
  if (!targetVersion || targetVersion.subgraph_id !== subgraphId) {
    throw new Error('Version not found');
  }

  const currentVersion = subgraph.current_version_id 
    ? await getSchemaVersionById(subgraph.current_version_id)
    : null;

  const activeSubgraphs = await getActiveSubgraphsWithSchema(tenantId);
  const subgraphSchemas = activeSubgraphs
    .filter(sg => sg.version && sg.subgraph.id !== subgraphId)
    .map(sg => ({ name: sg.subgraph.name, sdl: sg.version!.sdl }));

  subgraphSchemas.push({ name: subgraph.name, sdl: targetVersion.sdl });

  const compositionResult = composeSchemas(subgraphSchemas);

  if (!compositionResult.success) {
    return {
      success: false,
      message: `Rollback failed: composition errors - ${compositionResult.errors.map(e => e.message).join(', ')}`,
    };
  }

  await query(
    'UPDATE schema_versions SET is_active = false WHERE subgraph_id = $1 AND is_active = true',
    [subgraphId]
  );

  await query(
    'UPDATE schema_versions SET is_active = true WHERE id = $1',
    [versionId]
  );

  await query(
    'UPDATE subgraphs SET current_version_id = $1 WHERE id = $2',
    [versionId, subgraphId]
  );

  return { success: true };
}

export async function deleteSubgraph(id: string, tenantId: string): Promise<void> {
  await query(
    'DELETE FROM subgraphs WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
}

export async function updateSubgraphMetadata(
  id: string,
  tenantId: string,
  updates: { routingUrl?: string; ownerTeam?: string; description?: string; isActive?: boolean }
): Promise<Subgraph> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.routingUrl !== undefined) {
    fields.push(`routing_url = $${paramIndex++}`);
    values.push(updates.routingUrl);
  }
  if (updates.ownerTeam !== undefined) {
    fields.push(`owner_team = $${paramIndex++}`);
    values.push(updates.ownerTeam);
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }
  if (updates.isActive !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    values.push(updates.isActive);
  }

  if (fields.length === 0) {
    const subgraph = await getSubgraphById(id, tenantId);
    if (!subgraph) throw new Error('Subgraph not found');
    return subgraph;
  }

  values.push(id, tenantId);

  const result = await query<Subgraph>(
    `UPDATE subgraphs SET ${fields.join(', ')} WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Subgraph not found');
  }

  return result.rows[0];
}

export default {
  getSubgraphsByTenant,
  getSubgraphById,
  getSubgraphByName,
  getActiveSubgraphsWithSchema,
  getSchemaVersions,
  getSchemaVersionById,
  getLatestSchemaVersion,
  getActiveSchemaVersion,
  createSubgraph,
  updateSubgraphSchema,
  rollbackSchemaVersion,
  deleteSubgraph,
  updateSubgraphMetadata,
};
