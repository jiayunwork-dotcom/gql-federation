import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { login, createUser, getUserById } from '../services/auth-service';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as { email: string; password: string };
    
    if (!email || !password) {
      reply.status(400).send({ error: 'Email and password are required' });
      return;
    }

    const result = await login(email, password);
    
    if (!result) {
      reply.status(401).send({ error: 'Invalid email or password' });
      return;
    }

    return result;
  });

  fastify.get('/me', { preHandler: [authMiddleware] }, async (request: FastifyRequest) => {
    const user = request.user;
    if (!user) {
      throw new Error('User not found');
    }
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  fastify.post('/users', { preHandler: [authMiddleware, superAdminMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password, name, role } = request.body as any;
    
    try {
      const user = await createUser({ email, password, name, role });
      const { password_hash: _, ...userWithoutPassword } = user;
      reply.status(201).send(userWithoutPassword);
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });
}
