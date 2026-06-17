import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { query } from '../db';
import { ReleaseAuditLog } from '../types';

const querySchema = z.object({
  subgraphId: z.string().optional(),
  actionType: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  canaryReleaseId: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
});

export default async function releaseAuditRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const queryParams = querySchema.parse(request.query);
      const tenantId = (request as any).tenantId;

      let whereClause = 'WHERE tenant_id = $1';
      const params: any[] = [tenantId];
      let paramIndex = 2;

      if (queryParams.subgraphId) {
        whereClause += ` AND subgraph_id = $${paramIndex++}`;
        params.push(queryParams.subgraphId);
      }

      if (queryParams.actionType) {
        whereClause += ` AND action_type = $${paramIndex++}`;
        params.push(queryParams.actionType);
      }

      if (queryParams.startTime) {
        whereClause += ` AND created_at >= $${paramIndex++}`;
        params.push(new Date(queryParams.startTime));
      }

      if (queryParams.endTime) {
        whereClause += ` AND created_at <= $${paramIndex++}`;
        params.push(new Date(queryParams.endTime));
      }

      if (queryParams.canaryReleaseId) {
        whereClause += ` AND canary_release_id = $${paramIndex++}`;
        params.push(queryParams.canaryReleaseId);
      }

      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM release_audit_logs ${whereClause}`,
        params
      );

      const dataResult = await query<ReleaseAuditLog>(
        `SELECT * FROM release_audit_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...params, queryParams.limit, queryParams.offset]
      );

      return {
        success: true,
        data: dataResult.rows,
        total: parseInt(countResult.rows[0]?.count || '0', 10),
      };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = (request as any).tenantId;

      const result = await query<ReleaseAuditLog>(
        'SELECT * FROM release_audit_logs WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        reply.status(404).send({ success: false, error: 'Audit log not found' });
        return;
      }

      return { success: true, data: result.rows[0] };
    } catch (err: any) {
      reply.status(400).send({ success: false, error: err.message });
    }
  });
}
