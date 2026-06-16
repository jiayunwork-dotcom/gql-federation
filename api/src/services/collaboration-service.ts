import { query } from '../db';
import { Draft, ActivityLog, ActionType, SyntaxValidationResult } from '../types';
import { getSubgraphById } from './subgraph-service';
import { notificationService } from './notification-service';
import { parse, validate, specifiedRules, buildSchema } from 'graphql';

export async function getDraftByUserAndSubgraph(
  tenantId: string,
  subgraphId: string,
  userId: string
): Promise<Draft | null> {
  const result = await query<Draft>(
    `SELECT * FROM drafts 
     WHERE tenant_id = $1 AND subgraph_id = $2 AND user_id = $3`,
    [tenantId, subgraphId, userId]
  );
  return result.rows[0] || null;
}

export async function getDraftsByUser(
  tenantId: string,
  userId: string
): Promise<Draft[]> {
  const result = await query<Draft>(
    `SELECT d.*, s.name as subgraph_name 
     FROM drafts d
     JOIN subgraphs s ON d.subgraph_id = s.id
     WHERE d.tenant_id = $1 AND d.user_id = $2
     ORDER BY d.updated_at DESC`,
    [tenantId, userId]
  );
  return result.rows;
}

export async function saveDraft(
  tenantId: string,
  subgraphId: string,
  userId: string,
  userEmail: string,
  userName: string,
  sdl: string
): Promise<Draft> {
  const subgraph = await getSubgraphById(subgraphId, tenantId);
  if (!subgraph) {
    throw new Error('Subgraph not found');
  }

  const result = await query<Draft>(
    `INSERT INTO drafts (tenant_id, subgraph_id, user_id, user_email, user_name, sdl)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, subgraph_id, user_id) 
     DO UPDATE SET sdl = $6, updated_at = NOW()
     RETURNING *`,
    [tenantId, subgraphId, userId, userEmail, userName, sdl]
  );

  await logActivity(tenantId, subgraphId, subgraph.name, userId, userEmail, userName, 'draft_saved', {
    sdlLength: sdl.length,
  });

  return result.rows[0];
}

export async function deleteDraft(
  tenantId: string,
  subgraphId: string,
  userId: string
): Promise<void> {
  await query(
    `DELETE FROM drafts WHERE tenant_id = $1 AND subgraph_id = $2 AND user_id = $3`,
    [tenantId, subgraphId, userId]
  );
}

export async function logActivity(
  tenantId: string,
  subgraphId: string,
  subgraphName: string,
  userId: string | undefined,
  userEmail: string | undefined,
  userName: string | undefined,
  actionType: ActionType,
  payload?: Record<string, any>
): Promise<ActivityLog> {
  const result = await query<ActivityLog>(
    `INSERT INTO activity_logs 
     (tenant_id, subgraph_id, subgraph_name, user_id, user_email, user_name, action_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      tenantId,
      subgraphId,
      subgraphName,
      userId || null,
      userEmail || null,
      userName || null,
      actionType,
      payload ? JSON.stringify(payload) : null,
    ]
  );

  const activity = result.rows[0];

  notificationService.broadcastEvent(tenantId, 'activity_logged', {
    activity,
  }, subgraphName, subgraphId);

  return activity;
}

export async function getActivityLogs(
  tenantId: string,
  subgraphId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ logs: ActivityLog[]; total: number; hasMore: boolean }> {
  const countResult = await query(
    `SELECT COUNT(*) as count FROM activity_logs 
     WHERE tenant_id = $1 AND subgraph_id = $2`,
    [tenantId, subgraphId]
  );

  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query<ActivityLog>(
    `SELECT * FROM activity_logs 
     WHERE tenant_id = $1 AND subgraph_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [tenantId, subgraphId, limit, offset]
  );

  return {
    logs: result.rows,
    total,
    hasMore: offset + limit < total,
  };
}

export function validateSDL(sdl: string): SyntaxValidationResult {
  try {
    const doc = parse(sdl);
    const schema = buildSchema(sdl);
    const errors = validate(schema, doc, specifiedRules);

    if (errors.length === 0) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: errors.map((err) => ({
        line: err.locations?.[0]?.line || 1,
        column: err.locations?.[0]?.column || 1,
        message: err.message,
      })),
    };
  } catch (err: any) {
    const match = err.message?.match(/line (\d+), column (\d+)/);
    return {
      valid: false,
      errors: [
        {
          line: match ? parseInt(match[1], 10) : 1,
          column: match ? parseInt(match[2], 10) : 1,
          message: err.message || 'Invalid SDL syntax',
        },
      ],
    };
  }
}

export default {
  getDraftByUserAndSubgraph,
  getDraftsByUser,
  saveDraft,
  deleteDraft,
  logActivity,
  getActivityLogs,
  validateSDL,
};
