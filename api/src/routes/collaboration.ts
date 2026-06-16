import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { tenantMiddleware } from '../middleware/tenant';
import {
  getLockStatus,
  acquireLock,
  releaseLock,
  refreshLock,
  cancelWait,
} from '../services/lock-service';
import {
  getDraftByUserAndSubgraph,
  getDraftsByUser,
  saveDraft,
  deleteDraft,
  getActivityLogs,
  validateSDL,
  logActivity,
} from '../services/collaboration-service';
import { submitSchemaChange } from '../services/approval-service';
import { getSubgraphById, getActiveSchemaVersion, getSchemaVersionById, getLatestSchemaVersion } from '../services/subgraph-service';
import { notificationService } from '../services/notification-service';

export default async function collaborationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', tenantMiddleware);

  fastify.get('/drafts', async (request: FastifyRequest) => {
    const tenantId = request.tenantId!;
    const userId = request.user!.id;
    const drafts = await getDraftsByUser(tenantId, userId);
    return { drafts };
  });

  fastify.get('/drafts/:subgraphId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;
    const userId = request.user!.id;

    const draft = await getDraftByUserAndSubgraph(tenantId, subgraphId, userId);
    if (!draft) {
      reply.status(404).send({ error: 'Draft not found' });
      return;
    }
    return { draft };
  });

  fastify.post('/drafts/:subgraphId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;

    try {
      const draft = await saveDraft(
        tenantId,
        subgraphId,
        user.id,
        user.email,
        user.name,
        body.sdl
      );
      return { draft };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  fastify.delete('/drafts/:subgraphId', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;
    const userId = request.user!.id;

    await deleteDraft(tenantId, subgraphId, userId);
    return { success: true };
  });

  fastify.get('/locks/:subgraphId', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;
    const status = await getLockStatus(tenantId, subgraphId);
    return { lockStatus: status };
  });

  fastify.post('/locks/:subgraphId/acquire', async (request: FastifyRequest, reply: FastifyReply) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;
    const user = request.user!;

    const result = await acquireLock(tenantId, subgraphId, user.id, user.name, user.email);

    if (result.success) {
      const subgraph = await getSubgraphById(subgraphId, tenantId);
      if (subgraph) {
        await logActivity(tenantId, subgraphId, subgraph.name, user.id, user.email, user.name, 'lock_acquired');
      }
    }

    return result;
  });

  fastify.post('/locks/:subgraphId/release', async (request: FastifyRequest, reply: FastifyReply) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;

    const result = await releaseLock(tenantId, subgraphId, user.id);

    if (result.success) {
      const subgraph = await getSubgraphById(subgraphId, tenantId);
      if (subgraph) {
        await logActivity(tenantId, subgraphId, subgraph.name, user.id, user.email, user.name, 'lock_released', {
          saveDraft: body.saveDraft,
        });

        if (result.transferredTo) {
          await logActivity(
            tenantId,
            subgraphId,
            subgraph.name,
            result.transferredTo.userId,
            result.transferredTo.userEmail,
            result.transferredTo.userName,
            'lock_transferred',
            {
              from: { userId: user.id, userName: user.name },
              to: { userId: result.transferredTo.userId, userName: result.transferredTo.userName },
            }
          );
        }
      }
    }

    return result;
  });

  fastify.post('/locks/:subgraphId/refresh', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;
    const userId = request.user!.id;

    const success = await refreshLock(tenantId, subgraphId, userId);
    return { success };
  });

  fastify.post('/locks/:subgraphId/cancel-wait', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;
    const userId = request.user!.id;

    const result = await cancelWait(tenantId, subgraphId, userId);
    return result;
  });

  fastify.get('/activity/:subgraphId', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const query = request.query as any;
    const tenantId = request.tenantId!;
    const limit = parseInt(query.limit || '50', 10);
    const offset = parseInt(query.offset || '0', 10);

    const result = await getActivityLogs(tenantId, subgraphId, limit, offset);
    return result;
  });

  fastify.post('/validate-sdl', async (request: FastifyRequest) => {
    const body = request.body as any;
    const result = validateSDL(body.sdl || '');
    return { validation: result };
  });

  fastify.get('/online-users/:subgraphId', async (request: FastifyRequest) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const users = notificationService.getOnlineUsersForSubgraph(subgraphId);
    return { users };
  });

  fastify.get('/schema/:subgraphId/current', async (request: FastifyRequest, reply: FastifyReply) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const tenantId = request.tenantId!;

    const subgraph = await getSubgraphById(subgraphId, tenantId);
    if (!subgraph) {
      reply.status(404).send({ error: 'Subgraph not found' });
      return;
    }

    let version = null;

    if (subgraph.current_version_id) {
      version = await getSchemaVersionById(subgraph.current_version_id);
    }

    if (!version) {
      version = await getActiveSchemaVersion(subgraphId);
    }

    if (!version) {
      version = await getLatestSchemaVersion(subgraphId);
    }

    if (!version) {
      return { sdl: '', versionId: null, version: 0 };
    }

    return { sdl: version.sdl, versionId: version.id, version: version.version };
  });

  fastify.post('/submit/:subgraphId', { preHandler: [adminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { subgraphId } = request.params as { subgraphId: string };
    const body = request.body as any;
    const tenantId = request.tenantId!;
    const user = request.user!;

    try {
      const result = await submitSchemaChange({
        tenantId,
        subgraphId,
        sdl: body.sdl,
        submittedBy: user.email,
        changelog: body.changelog,
      });

      const subgraph = await getSubgraphById(subgraphId, tenantId);
      if (subgraph) {
        await logActivity(tenantId, subgraphId, subgraph.name, user.id, user.email, user.name, 'change_submitted', {
          changelog: body.changelog,
          approvalId: result.approval.id,
        });
      }

      await releaseLock(tenantId, subgraphId, user.id);

      return {
        message: 'Schema change submitted for approval',
        approval: result.approval,
        versionId: result.versionId,
      };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });
}
