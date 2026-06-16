import { FastifyInstance } from 'fastify';
import { notificationService } from '../services/notification-service';
import { getTenantByName } from '../services/tenant-service';

export default async function websocketRoutes(fastify: FastifyInstance) {
  fastify.get('/ws/notifications', { websocket: true }, async (connection, request) => {
    const token = request.headers['sec-websocket-protocol'] as string;
    const query = request.query as { tenant?: string };
    const tenantName = query.tenant || request.headers['x-tenant-id'] as string;

    if (!token) {
      connection.socket.close(1008, 'Missing authentication token');
      return;
    }

    if (!tenantName) {
      connection.socket.close(1008, 'Missing tenant identifier');
      return;
    }

    const tenant = await getTenantByName(tenantName);
    if (!tenant) {
      connection.socket.close(1008, `Tenant "${tenantName}" not found`);
      return;
    }

    if (!tenant.is_active) {
      connection.socket.close(1008, `Tenant "${tenantName}" is disabled`);
      return;
    }

    const tenantId = tenant.id;

    const client = await notificationService.addConnection(
      connection.socket,
      token,
      tenantId
    );

    if (!client) {
      connection.socket.close(1008, 'Invalid authentication token');
      return;
    }

    const heartbeatInterval = setInterval(() => {
      if (connection.socket.readyState === 1) {
        connection.socket.ping();
      }
    }, 30000);

    connection.socket.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  });
}
