import { FastifyInstance } from 'fastify';
import { notificationService } from '../services/notification-service';

export default async function websocketRoutes(fastify: FastifyInstance) {
  fastify.get('/ws/notifications', { websocket: true }, async (connection, request) => {
    const token = request.headers['sec-websocket-protocol'] as string;
    const tenantId = request.headers['x-tenant-id'] as string;

    if (!token) {
      connection.socket.close(1008, 'Missing authentication token');
      return;
    }

    if (!tenantId) {
      connection.socket.close(1008, 'Missing tenant ID');
      return;
    }

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
