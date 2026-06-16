import { FastifyInstance } from 'fastify';
import { notificationService } from '../services/notification-service';
import { getTenantByName } from '../services/tenant-service';

export default async function websocketRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/ws/notifications',
    {
      websocket: true,
      config: {
        rateLimit: false,
      },
    },
    (connection, request) => {
      const socket = connection.socket;

      console.log('[WebSocket] New connection attempt from:', request.ip, 'URL:', request.url);

      socket.on('error', (err: Error) => {
        console.error('[WebSocket] Socket error:', err.message);
      });

      socket.on('close', (code: number, reason: Buffer) => {
        console.log('[WebSocket] Connection closed. Code:', code, 'Reason:', reason?.toString());
      });

      const setupConnection = async () => {
        try {
          const query = request.query as { tenant?: string; token?: string };
          const tenantName = query.tenant || (request.headers['x-tenant-id'] as string);
          const token = query.token || (request.headers['sec-websocket-protocol'] as string);

          console.log('[WebSocket] Auth - tenant provided:', !!tenantName, 'token provided:', !!token);

          if (!token) {
            console.log('[WebSocket] Closing: Missing authentication token');
            socket.close(1008, 'Missing authentication token');
            return;
          }

          if (!tenantName) {
            console.log('[WebSocket] Closing: Missing tenant identifier');
            socket.close(1008, 'Missing tenant identifier');
            return;
          }

          const tenant = await getTenantByName(tenantName);
          if (!tenant) {
            console.log('[WebSocket] Closing: Tenant not found -', tenantName);
            socket.close(1008, `Tenant "${tenantName}" not found`);
            return;
          }

          if (!tenant.is_active) {
            console.log('[WebSocket] Closing: Tenant is disabled -', tenantName);
            socket.close(1008, `Tenant "${tenantName}" is disabled`);
            return;
          }

          const tenantId = tenant.id;
          console.log('[WebSocket] Tenant resolved:', tenantName, '->', tenantId);

          const client = await notificationService.addConnection(
            socket,
            token,
            tenantId
          );

          if (!client) {
            console.log('[WebSocket] Closing: Invalid authentication token');
            socket.close(1008, 'Invalid authentication token');
            return;
          }

          console.log('[WebSocket] Connection established successfully for user:', client.userName);

          const heartbeatInterval = setInterval(() => {
            if (socket.readyState === 1) {
              try {
                socket.ping();
              } catch (err) {
                console.error('[WebSocket] Error sending ping:', err);
              }
            }
          }, 30000);

          socket.on('close', () => {
            clearInterval(heartbeatInterval);
          });
        } catch (err) {
          console.error('[WebSocket] Connection setup error:', err);
          try {
            socket.close(1011, 'Internal server error');
          } catch (closeErr) {
            console.error('[WebSocket] Error closing socket:', closeErr);
          }
        }
      };

      setupConnection();
    }
  );
}

