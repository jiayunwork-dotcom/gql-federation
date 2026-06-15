import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, getUserById } from '../services/auth-service';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);

  if (!decoded.valid || !decoded.userId) {
    reply.status(401).send({ error: 'Unauthorized: Invalid token' });
    return;
  }

  const user = await getUserById(decoded.userId);
  if (!user || !user.is_active) {
    reply.status(401).send({ error: 'Unauthorized: User not found or inactive' });
    return;
  }

  request.user = user;
}

export async function superAdminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as any;
  if (!user || user.role !== 'super_admin') {
    reply.status(403).send({ error: 'Forbidden: Super admin access required' });
    return;
  }
}

export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as any;
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    reply.status(403).send({ error: 'Forbidden: Admin access required' });
    return;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
    tenantId?: string;
  }
}

export default { authMiddleware, superAdminMiddleware, adminMiddleware };
