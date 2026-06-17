import { query } from '../db';
import { SchemaChangeApproval, ApprovalStatus, DiffSummary, ChangeSummary } from '../types';
import { getSubgraphById, getLatestSchemaVersion, getActiveSubgraphsWithSchema } from './subgraph-service';
import { composeSchemas, detectChanges, validateSchemaSize } from './schema-composition';
import { composeAndPublishSupergraph } from './supergraph-service';
import { getTenantById } from './tenant-service';
import { notificationService } from './notification-service';
import { logActivity } from './collaboration-service';
import { generateNextVersion, updateSchemaVersionWithSemantic } from './version-management-service';

export interface SubmitApprovalInput {
  tenantId: string;
  subgraphId: string;
  sdl: string;
  submittedBy: string;
  changelog?: string;
}

export async function getPendingApprovals(tenantId: string): Promise<SchemaChangeApproval[]> {
  const result = await query<SchemaChangeApproval>(
    `SELECT * FROM schema_change_approvals 
     WHERE tenant_id = $1 AND status IN ('pending_approval', 'resubmitted')
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return result.rows;
}

export async function getApprovalsByTenant(tenantId: string, limit: number = 50): Promise<SchemaChangeApproval[]> {
  const result = await query<SchemaChangeApproval>(
    `SELECT * FROM schema_change_approvals 
     WHERE tenant_id = $1 
     ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit]
  );
  return result.rows;
}

export async function getApprovalById(id: string, tenantId: string): Promise<SchemaChangeApproval | null> {
  const result = await query<SchemaChangeApproval>(
    'SELECT * FROM schema_change_approvals WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  return result.rows[0] || null;
}

export async function getApprovalsBySubgraph(subgraphId: string, tenantId: string): Promise<SchemaChangeApproval[]> {
  const result = await query<SchemaChangeApproval>(
    `SELECT * FROM schema_change_approvals 
     WHERE subgraph_id = $1 AND tenant_id = $2 
     ORDER BY created_at DESC`,
    [subgraphId, tenantId]
  );
  return result.rows;
}

function computeDiffSummary(changes: ChangeSummary): DiffSummary {
  const details: DiffSummary['details'] = {
    addedFields: [],
    removedFields: [],
    modifiedTypes: [],
    addedTypes: [],
    removedTypes: [],
  };

  for (const c of changes.nonBreakingChanges) {
    if (c.type === 'FIELD_ADDED' && c.path) {
      details.addedFields.push(c.path);
    } else if (c.type === 'TYPE_ADDED' && c.path) {
      details.addedTypes.push(c.path);
    } else if (c.type === 'ENUM_VALUE_ADDED' && c.path) {
      details.addedFields.push(c.path);
    } else if (c.type === 'SCALAR_ADDED' && c.path) {
      details.addedTypes.push(c.path);
    }
  }

  for (const c of changes.breakingChanges) {
    if (c.type === 'FIELD_REMOVED' && c.path) {
      details.removedFields.push(c.path);
    } else if (c.type === 'TYPE_REMOVED' && c.path) {
      details.removedTypes.push(c.path);
    } else if (c.type === 'FIELD_TYPE_CHANGED' && c.path) {
      details.modifiedTypes.push(c.path);
    } else if (c.type === 'FIELD_TYPE_CHANGED_OPTIONAL_TO_REQUIRED' && c.path) {
      details.modifiedTypes.push(c.path);
    } else if (c.type === 'ENUM_REMOVED' && c.path) {
      details.removedTypes.push(c.path);
    } else if (c.type === 'ENUM_VALUE_REMOVED' && c.path) {
      details.removedFields.push(c.path);
    } else if (c.type === 'SCALAR_REMOVED' && c.path) {
      details.removedTypes.push(c.path);
    }
  }

  for (const c of changes.dangerousChanges) {
    if (c.type === 'FIELD_TYPE_NULLABILITY_CHANGED' && c.path) {
      details.modifiedTypes.push(c.path);
    }
  }

  return {
    addedFields: details.addedFields.length,
    removedFields: details.removedFields.length,
    modifiedTypes: details.modifiedTypes.length,
    addedTypes: details.addedTypes.length,
    removedTypes: details.removedTypes.length,
    details,
  };
}

export async function submitSchemaChange(input: SubmitApprovalInput): Promise<{ approval: SchemaChangeApproval; versionId: string }> {
  const subgraph = await getSubgraphById(input.subgraphId, input.tenantId);
  if (!subgraph) {
    throw new Error('Subgraph not found');
  }

  if (!subgraph.name) {
    throw new Error('Subgraph name is missing');
  }

  if (!input.changelog || input.changelog.trim().length < 2) {
    throw new Error('变更说明不能为空且至少需要2个字符');
  }

  if (!input.submittedBy) {
    throw new Error('提交人不能为空');
  }

  const tenant = await getTenantById(input.tenantId);
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const changelog = input.changelog.trim();

  const latestVersion = await getLatestSchemaVersion(input.subgraphId);
  const latestSdl = latestVersion?.sdl || null;
  const changes = detectChanges(latestSdl, input.sdl);
  const diffSummary = computeDiffSummary(changes);

  const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

  const sizeCheck = validateSchemaSize(input.sdl, tenant.max_schema_size_kb);
  if (!sizeCheck.valid) {
    throw new Error(`Schema size exceeds maximum allowed size of ${tenant.max_schema_size_kb}KB`);
  }

  const versionResult = await query<any>(
    `INSERT INTO schema_versions (subgraph_id, tenant_id, version, sdl, schema_size_bytes, change_summary, is_active, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7)
     RETURNING *`,
    [input.subgraphId, input.tenantId, nextVersion, input.sdl, sizeCheck.sizeBytes, JSON.stringify(changes), input.submittedBy]
  );

  const version = versionResult.rows[0];

  const approvalResult = await query<SchemaChangeApproval>(
    `INSERT INTO schema_change_approvals 
     (tenant_id, subgraph_id, subgraph_name, schema_version_id, submitted_by, changelog, diff_summary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_approval')
     RETURNING *`,
    [
      input.tenantId,
      input.subgraphId,
      subgraph.name,
      version.id,
      input.submittedBy,
      changelog,
      JSON.stringify(diffSummary),
    ]
  );

  return { approval: approvalResult.rows[0], versionId: version.id };
}

export async function approveSchemaChange(
  approvalId: string,
  tenantId: string,
  reviewedBy: string
): Promise<{ success: boolean; approval: SchemaChangeApproval; compositionErrors?: any[] }> {
  const approval = await getApprovalById(approvalId, tenantId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  if (approval.status !== 'pending_approval' && approval.status !== 'resubmitted') {
    throw new Error(`Cannot approve approval with status "${approval.status}"`);
  }

  if (!approval.schema_version_id) {
    throw new Error('No schema version associated with this approval');
  }

  const versionResult = await query<any>(
    'SELECT * FROM schema_versions WHERE id = $1',
    [approval.schema_version_id]
  );
  const version = versionResult.rows[0];
  if (!version) {
    throw new Error('Schema version not found');
  }

  const subgraph = await getSubgraphById(approval.subgraph_id, tenantId);
  if (!subgraph) {
    throw new Error('Subgraph not found');
  }

  const activeSubgraphs = await getActiveSubgraphsWithSchema(tenantId);
  const subgraphSchemas = activeSubgraphs
    .filter(sg => sg.version && sg.subgraph.id !== approval.subgraph_id)
    .map(sg => ({ name: sg.subgraph.name, sdl: sg.version!.sdl }));

  subgraphSchemas.push({ name: subgraph.name, sdl: version.sdl });

  const compositionResult = composeSchemas(subgraphSchemas);

  if (!compositionResult.success) {
    await query(
      `UPDATE schema_change_approvals 
       SET status = 'validation_failed', reviewed_by = $1, reviewed_at = NOW(), composition_result = $2
       WHERE id = $3`,
      [reviewedBy, JSON.stringify(compositionResult), approvalId]
    );

    const updated = await getApprovalById(approvalId, tenantId);
    return { success: false, approval: updated!, compositionErrors: compositionResult.errors };
  }

  const latestVersion = await getLatestSchemaVersion(approval.subgraph_id);

  const hasBreakingChanges = version.change_summary?.breakingChanges?.length > 0;
  const compatibility = hasBreakingChanges ? 'BREAKING' : 'COMPATIBLE';
  
  const semanticVersion = await generateNextVersion(approval.subgraph_id, compatibility);
  await updateSchemaVersionWithSemantic(
    version.id,
    semanticVersion.major,
    semanticVersion.minor,
    semanticVersion.patch,
    semanticVersion.versionString,
    compatibility
  );

  await query(
    'UPDATE schema_versions SET is_active = true WHERE id = $1',
    [version.id]
  );

  if (latestVersion && latestVersion.id !== version.id) {
    await query(
      'UPDATE schema_versions SET is_active = false WHERE id = $1',
      [latestVersion.id]
    );
  }

  await query(
    'UPDATE subgraphs SET current_version_id = $1 WHERE id = $2',
    [version.id, approval.subgraph_id]
  );

  await query(
    `INSERT INTO release_audit_logs 
     (tenant_id, subgraph_id, subgraph_name, action_type, 
      old_version_id, new_version_id, old_version_string, new_version_string, 
      operator, reason, metadata)
     VALUES ($1, $2, $3, 'version_published', $4, $5, $6, $7, $8, $9, '{}'::jsonb)`,
    [
      tenantId,
      approval.subgraph_id,
      approval.subgraph_name,
      latestVersion?.id || null,
      version.id,
      latestVersion?.version_string || null,
      semanticVersion.versionString,
      reviewedBy,
      approval.changelog || 'Version approved and published',
    ]
  );

  await query(
    `UPDATE schema_change_approvals 
     SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), composition_result = $2
     WHERE id = $3`,
    [reviewedBy, JSON.stringify(compositionResult), approvalId]
  );

  await composeAndPublishSupergraph(tenantId, reviewedBy);

  notificationService.notifyApprovalStatusChanged(
    tenantId,
    approval.subgraph_id,
    approval.subgraph_name,
    approval.status,
    'approved',
    reviewedBy
  );

  await logActivity(
    tenantId,
    approval.subgraph_id,
    approval.subgraph_name,
    undefined,
    undefined,
    reviewedBy,
    'change_approved',
    {
      approvalId,
      changelog: approval.changelog,
    }
  );

  const updated = await getApprovalById(approvalId, tenantId);
  return { success: true, approval: updated! };
}

export async function rejectSchemaChange(
  approvalId: string,
  tenantId: string,
  reviewedBy: string,
  reason: string
): Promise<SchemaChangeApproval> {
  const approval = await getApprovalById(approvalId, tenantId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  if (approval.status !== 'pending_approval' && approval.status !== 'resubmitted') {
    throw new Error(`Cannot reject approval with status "${approval.status}"`);
  }

  await query(
    `UPDATE schema_change_approvals 
     SET status = 'rejected', reviewed_by = $1, review_comment = $2, reviewed_at = NOW()
     WHERE id = $3`,
    [reviewedBy, reason, approvalId]
  );

  notificationService.notifyApprovalStatusChanged(
    tenantId,
    approval.subgraph_id,
    approval.subgraph_name,
    approval.status,
    'rejected',
    reviewedBy
  );

  await logActivity(
    tenantId,
    approval.subgraph_id,
    approval.subgraph_name,
    undefined,
    undefined,
    reviewedBy,
    'change_rejected',
    {
      approvalId,
      changelog: approval.changelog,
      reason,
    }
  );

  const updated = await getApprovalById(approvalId, tenantId);
  return updated!;
}

export async function resubmitSchemaChange(
  approvalId: string,
  tenantId: string,
  sdl: string,
  changelog?: string,
  submittedBy?: string
): Promise<{ approval: SchemaChangeApproval; versionId: string }> {
  const approval = await getApprovalById(approvalId, tenantId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  if (approval.status !== 'rejected' && approval.status !== 'validation_failed') {
    throw new Error(`Cannot resubmit approval with status "${approval.status}"`);
  }

  if (submittedBy && approval.submitted_by !== submittedBy) {
    throw new Error('Only the original submitter can resubmit');
  }

  const effectiveChangelog = changelog || approval.changelog;
  if (!effectiveChangelog || effectiveChangelog.trim().length < 2) {
    throw new Error('变更说明不能为空且至少需要2个字符');
  }

  const latestVersion = await getLatestSchemaVersion(approval.subgraph_id);
  const latestSdl = latestVersion?.sdl || null;
  const changes = detectChanges(latestSdl, sdl);
  const diffSummary = computeDiffSummary(changes);

  const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

  const sizeCheck = validateSchemaSize(sdl, 500);
  const versionResult = await query<any>(
    `INSERT INTO schema_versions (subgraph_id, tenant_id, version, sdl, schema_size_bytes, change_summary, is_active, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7)
     RETURNING *`,
    [approval.subgraph_id, tenantId, nextVersion, sdl, sizeCheck.sizeBytes, JSON.stringify(changes), approval.submitted_by]
  );

  const version = versionResult.rows[0];

  await query(
    `UPDATE schema_change_approvals 
     SET schema_version_id = $1, changelog = $2, diff_summary = $3, 
         status = 'resubmitted', reviewed_by = NULL, review_comment = NULL, 
         reviewed_at = NULL, composition_result = NULL
     WHERE id = $4`,
    [version.id, effectiveChangelog, JSON.stringify(diffSummary), approvalId]
  );

  const updated = await getApprovalById(approvalId, tenantId);
  return { approval: updated!, versionId: version.id };
}

export default {
  getPendingApprovals,
  getApprovalsByTenant,
  getApprovalById,
  getApprovalsBySubgraph,
  submitSchemaChange,
  approveSchemaChange,
  rejectSchemaChange,
  resubmitSchemaChange,
};
