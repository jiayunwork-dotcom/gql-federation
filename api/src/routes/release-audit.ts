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

const exportQuerySchema = z.object({
  subgraphId: z.string().optional(),
  actionType: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  canaryReleaseId: z.string().optional(),
});

const actionTypeMap: Record<string, string> = {
  start_canary: '启动灰度',
  adjust_percent: '调整比例',
  full_release: '全量发布',
  rollback: '回滚',
  version_published: '版本发布',
};

const statusMap: Record<string, string> = {
  pending: '待发布',
  canary: '灰度中',
  full_rollout: '已全量',
  rolled_back: '已回滚',
  failed: '失败',
};

function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(date: Date | string): string {
  if (date instanceof Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  const str = String(date);
  
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    const [, year, month, day, hours, minutes, seconds] = isoMatch;
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  return str;
}

function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

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

  fastify.get('/export/csv', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const queryParams = exportQuerySchema.parse(request.query);
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
      const total = parseInt(countResult.rows[0]?.count || '0', 10);

      const dataResult = await query<ReleaseAuditLog>(
        `SELECT * FROM release_audit_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++}`,
        [...params, 1000]
      );

      const rows = dataResult.rows;

      const headers = [
        '操作时间',
        '操作类型',
        'SubGraph名称',
        '源版本号',
        '目标版本号',
        '灰度比例',
        '操作人',
        '最终状态',
      ];

      const csvRows: string[] = [headers.map(escapeCsvValue).join(',')];

      for (const row of rows) {
        const percentStr = row.old_percent !== undefined && row.new_percent !== undefined
          ? `${row.old_percent}% → ${row.new_percent}%`
          : '';

        const finalStatus = row.canary_release_id
          ? (statusMap[row.metadata?.finalStatus] || '')
          : '';

        const csvRow = [
          formatDate(row.created_at),
          actionTypeMap[row.action_type] || row.action_type,
          row.subgraph_name,
          row.old_version_string || '',
          row.new_version_string || '',
          percentStr,
          row.operator,
          finalStatus,
        ].map(escapeCsvValue).join(',');

        csvRows.push(csvRow);
      }

      if (total > 1000) {
        csvRows.push(`"数据已截断,共${total}条记录仅导出最近1000条"`);
      }

      const csvContent = csvRows.join('\n');
      const filename = `release-audit-${formatDateForFilename(new Date())}.csv`;

      reply.type('text/csv');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'text/csv; charset=utf-8');

      return '\ufeff' + csvContent;
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
