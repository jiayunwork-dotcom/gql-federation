import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import {
  getPendingApprovals,
  getApprovalsByTenant,
  getApprovalById,
  getApprovalsBySubgraph,
  submitSchemaChange,
  approveSchemaChange,
  rejectSchemaChange,
  resubmitSchemaChange,
} from '../services/approval-service';

export default async function approvalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const { status, limit = 50 } = request.query as { status?: string; limit?: number };

    if (status === 'pending') {
      const approvals = await getPendingApprovals(tenantId);
      return { approvals };
    }

    const approvals = await getApprovalsByTenant(tenantId, Number(limit));
    return { approvals };
  });

  fastify.get('/pending', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const approvals = await getPendingApprovals(tenantId);
    return { approvals };
  });

  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    const approval = await getApprovalById(id, tenantId);

    if (!approval) {
      reply.status(404).send({ error: 'Approval not found' });
      return;
    }

    return { approval };
  });

  fastify.get('/subgraph/:subgraphId', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;
    const approvals = await getApprovalsBySubgraph(subgraphId, tenantId);
    return { approvals };
  });

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;

    try {
      const result = await submitSchemaChange({
        tenantId,
        subgraphId: body.subgraphId,
        sdl: body.sdl,
        submittedBy: user.email,
        changelog: body.changelog,
      });

      reply.status(201).send(result);
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/approve', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenantId!;
    const user = request.user!;

    try {
      const result = await approveSchemaChange(id, tenantId, user.email);

      if (!result.success) {
        reply.status(400).send({
          error: 'Composition validation failed',
          approval: result.approval,
          compositionErrors: result.compositionErrors,
        });
        return;
      }

      return result;
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/reject', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;

    if (!body.reason) {
      reply.status(400).send({ error: 'Rejection reason is required' });
      return;
    }

    try {
      const approval = await rejectSchemaChange(id, tenantId, user.email, body.reason);
      return { approval };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/resubmit', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;

    try {
      const result = await resubmitSchemaChange(id, tenantId, body.sdl, body.changelog, user.email);
      return result;
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });
}
