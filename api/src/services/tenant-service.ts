import { query } from '../db';
import { Tenant } from '../types';

export interface CreateTenantInput {
  name: string;
  displayName: string;
  maxQueryDepth?: number;
  maxComplexity?: number;
  maxSchemaSizeKb?: number;
  maxSupergraphSizeKb?: number;
  settings?: Record<string, any>;
}

export interface UpdateTenantInput {
  displayName?: string;
  isActive?: boolean;
  maxQueryDepth?: number;
  maxComplexity?: number;
  maxSchemaSizeKb?: number;
  maxSupergraphSizeKb?: number;
  settings?: Record<string, any>;
}

export async function getAllTenants(): Promise<Tenant[]> {
  const result = await query<Tenant>(
    'SELECT * FROM tenants ORDER BY created_at DESC'
  );
  return result.rows;
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const result = await query<Tenant>(
    'SELECT * FROM tenants WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function getTenantByName(name: string): Promise<Tenant | null> {
  const result = await query<Tenant>(
    'SELECT * FROM tenants WHERE name = $1',
    [name]
  );
  return result.rows[0] || null;
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const existing = await getTenantByName(input.name);
  if (existing) {
    throw new Error(`Tenant with name "${input.name}" already exists`);
  }

  const result = await query<Tenant>(
    `INSERT INTO tenants (name, display_name, max_query_depth, max_complexity, max_schema_size_kb, max_supergraph_size_kb, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.name,
      input.displayName,
      input.maxQueryDepth || 15,
      input.maxComplexity || 1000,
      input.maxSchemaSizeKb || 500,
      input.maxSupergraphSizeKb || 5120,
      JSON.stringify(input.settings || {}),
    ]
  );

  return result.rows[0];
}

export async function updateTenant(id: string, input: UpdateTenantInput): Promise<Tenant> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (input.displayName !== undefined) {
    fields.push(`display_name = $${paramIndex++}`);
    values.push(input.displayName);
  }
  if (input.isActive !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    values.push(input.isActive);
  }
  if (input.maxQueryDepth !== undefined) {
    fields.push(`max_query_depth = $${paramIndex++}`);
    values.push(input.maxQueryDepth);
  }
  if (input.maxComplexity !== undefined) {
    fields.push(`max_complexity = $${paramIndex++}`);
    values.push(input.maxComplexity);
  }
  if (input.maxSchemaSizeKb !== undefined) {
    fields.push(`max_schema_size_kb = $${paramIndex++}`);
    values.push(input.maxSchemaSizeKb);
  }
  if (input.maxSupergraphSizeKb !== undefined) {
    fields.push(`max_supergraph_size_kb = $${paramIndex++}`);
    values.push(input.maxSupergraphSizeKb);
  }
  if (input.settings !== undefined) {
    fields.push(`settings = $${paramIndex++}`);
    values.push(JSON.stringify(input.settings));
  }

  if (fields.length === 0) {
    const tenant = await getTenantById(id);
    if (!tenant) throw new Error('Tenant not found');
    return tenant;
  }

  values.push(id);

  const result = await query<Tenant>(
    `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  return result.rows[0];
}

export async function deleteTenant(id: string): Promise<void> {
  await query(
    'DELETE FROM tenants WHERE id = $1',
    [id]
  );
}

export default {
  getAllTenants,
  getTenantById,
  getTenantByName,
  createTenant,
  updateTenant,
  deleteTenant,
};
