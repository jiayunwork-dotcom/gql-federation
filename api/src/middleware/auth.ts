import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, getUserById } from '../services/auth-service';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);

  if (!decoded.valid || !decoded.userId) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid token' });
  }

  const user = await getUserById(decoded.userId);
  if (!user || !user.is_active) {
    return reply.status(401).send({ error: 'Unauthorized: User not found or inactive' });
  }

  request.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export async function superAdminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user || user.role !== 'super_admin') {
    return reply.status(403).send({ error: 'Forbidden: Super admin access required' });
  }
}

export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user || !['super_admin', 'admin'].includes(user.role)) {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' });
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
