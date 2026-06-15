import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import { query } from '../db';
import { AlertConfig } from '../types';

export default async function alertRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const result = await query<AlertConfig>(
      'SELECT * FROM alert_configs WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    return { alerts: result.rows };
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    const result = await query<AlertConfig>(
      'SELECT * FROM alert_configs WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (result.rows.length === 0) {
      reply.status(404).send({ error: 'Alert config not found' });
      return;
    }
    return { alert: result.rows[0] };
  });

  fastify.post('/', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const tenantId = request.tenantId!;

    const result = await query<AlertConfig>(
      `INSERT INTO alert_configs (tenant_id, name, type, subgraph_id, threshold, comparison, channels, is_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING *`,
      [
        tenantId,
        body.name,
        body.type,
        body.subgraphId || null,
        body.threshold,
        body.comparison || 'gt',
        JSON.stringify(body.channels || []),
      ]
    );

    reply.status(201).send({ alert: result.rows[0] });
  });

  fastify.put('/:id', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.threshold !== undefined) {
      fields.push(`threshold = $${idx++}`);
      values.push(body.threshold);
    }
    if (body.comparison !== undefined) {
      fields.push(`comparison = $${idx++}`);
      values.push(body.comparison);
    }
    if (body.is_enabled !== undefined) {
      fields.push(`is_enabled = $${idx++}`);
      values.push(body.is_enabled);
    }
    if (body.channels !== undefined) {
      fields.push(`channels = $${idx++}`);
      values.push(JSON.stringify(body.channels));
    }

    if (fields.length === 0) {
      const result = await query<AlertConfig>(
        'SELECT * FROM alert_configs WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );
      return { alert: result.rows[0] };
    }

    values.push(id, tenantId);

    const result = await query<AlertConfig>(
      `UPDATE alert_configs SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      reply.status(404).send({ error: 'Alert config not found' });
      return;
    }

    return { alert: result.rows[0] };
  });

  fastify.delete('/:id', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    
    await query(
      'DELETE FROM alert_configs WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    
    reply.status(204).send();
  });
}
