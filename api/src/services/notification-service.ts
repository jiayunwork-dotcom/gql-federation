import { WebSocket } from 'ws';
import { NotificationMessage, NotificationEventType, OnlineUser, RemoteCursor } from '../types';
import { verifyToken, getUserById } from './auth-service';

interface ClientConnection {
  socket: WebSocket;
  userId: string;
  userName: string;
  userEmail: string;
  tenantId: string;
  subgraphId?: string;
  lastHeartbeat: number;
  cursor?: {
    lineNumber: number;
    columnNumber: number;
    lastUpdate: number;
  };
}

const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 60000;

class NotificationService {
  private connections: Map<string, ClientConnection> = new Map();
  private tenantConnections: Map<string, Set<string>> = new Map();
  private subgraphConnections: Map<string, Set<string>> = new Map();

  constructor() {
    setInterval(() => this.cleanupStaleConnections(), HEARTBEAT_INTERVAL);
  }

  async addConnection(
    socket: WebSocket,
    token: string,
    tenantId: string
  ): Promise<ClientConnection | null> {
    const decoded = verifyToken(token);
    if (!decoded.valid || !decoded.userId) {
      return null;
    }

    const user = await getUserById(decoded.userId);
    if (!user) {
      return null;
    }

    const connectionId = `${tenantId}:${decoded.userId}:${Date.now()}`;
    const connection: ClientConnection = {
      socket,
      userId: decoded.userId,
      userName: user.name,
      userEmail: user.email,
      tenantId,
      lastHeartbeat: Date.now(),
    };

    this.connections.set(connectionId, connection);

    if (!this.tenantConnections.has(tenantId)) {
      this.tenantConnections.set(tenantId, new Set());
    }
    this.tenantConnections.get(tenantId)!.add(connectionId);

    socket.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(connectionId, message);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    });

    socket.on('close', () => {
      this.removeConnection(connectionId);
    });

    socket.on('pong', () => {
      const conn = this.connections.get(connectionId);
      if (conn) {
        conn.lastHeartbeat = Date.now();
      }
    });

    this.sendToConnection(connectionId, {
      type: 'user_presence_changed',
      timestamp: new Date().toISOString(),
      payload: {
        action: 'connected',
        onlineUsers: this.getOnlineUsersForTenant(tenantId),
      },
    });

    this.broadcastUserPresence(tenantId, decoded.userId, user.name, 'joined');

    return connection;
  }

  private handleClientMessage(connectionId: string, message: any) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.lastHeartbeat = Date.now();

    switch (message.type) {
      case 'heartbeat':
        this.sendToConnection(connectionId, {
          type: 'heartbeat_ack',
          timestamp: new Date().toISOString(),
          payload: { serverTime: Date.now() },
        });
        break;

      case 'subscribe_subgraph':
        if (message.subgraphId) {
          this.subscribeToSubgraph(connectionId, message.subgraphId);
        }
        break;

      case 'unsubscribe_subgraph':
        if (message.subgraphId) {
          this.unsubscribeFromSubgraph(connectionId, message.subgraphId);
        }
        break;

      case 'ping':
        this.sendToConnection(connectionId, {
          type: 'pong',
          timestamp: new Date().toISOString(),
          payload: { clientTime: message.timestamp },
        });
        break;

      case 'cursor_position':
        if (message.subgraphId && message.lineNumber !== undefined && message.columnNumber !== undefined) {
          this.updateCursorPosition(connectionId, message.subgraphId, message.lineNumber, message.columnNumber);
        }
        break;
    }
  }

  private updateCursorPosition(
    connectionId: string,
    subgraphId: string,
    lineNumber: number,
    columnNumber: number
  ) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.subgraphId !== subgraphId) return;

    connection.cursor = {
      lineNumber,
      columnNumber,
      lastUpdate: Date.now(),
    };

    this.broadcastCursorPositions(subgraphId, connectionId);
  }

  private broadcastCursorPositions(subgraphId: string, excludeConnectionId?: string) {
    const subgraphConns = this.subgraphConnections.get(subgraphId);
    if (!subgraphConns) return;

    const cursors: RemoteCursor[] = [];
    for (const connId of subgraphConns) {
      if (connId === excludeConnectionId) continue;
      const conn = this.connections.get(connId);
      if (conn && conn.cursor) {
        cursors.push({
          userId: conn.userId,
          userName: conn.userName,
          userEmail: conn.userEmail,
          subgraphId,
          lineNumber: conn.cursor.lineNumber,
          columnNumber: conn.cursor.columnNumber,
          lastUpdate: conn.cursor.lastUpdate,
        });
      }
    }

    for (const connId of subgraphConns) {
      this.sendToConnection(connId, {
        type: 'cursor_position_changed',
        timestamp: new Date().toISOString(),
        subgraphId,
        payload: {
          subgraphId,
          cursors,
        },
      });
    }
  }

  getRemoteCursorsForSubgraph(subgraphId: string, excludeUserId?: string): RemoteCursor[] {
    const subgraphConns = this.subgraphConnections.get(subgraphId);
    if (!subgraphConns) return [];

    const cursors: RemoteCursor[] = [];
    for (const connId of subgraphConns) {
      const conn = this.connections.get(connId);
      if (conn && conn.cursor && conn.userId !== excludeUserId) {
        cursors.push({
          userId: conn.userId,
          userName: conn.userName,
          userEmail: conn.userEmail,
          subgraphId,
          lineNumber: conn.cursor.lineNumber,
          columnNumber: conn.cursor.columnNumber,
          lastUpdate: conn.cursor.lastUpdate,
        });
      }
    }
    return cursors;
  }

  private subscribeToSubgraph(connectionId: string, subgraphId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.subgraphId = subgraphId;

    if (!this.subgraphConnections.has(subgraphId)) {
      this.subgraphConnections.set(subgraphId, new Set());
    }
    this.subgraphConnections.get(subgraphId)!.add(connectionId);

    this.broadcastSubgraphPresence(subgraphId);
  }

  private unsubscribeFromSubgraph(connectionId: string, subgraphId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.subgraphId = undefined;

    const subgraphConns = this.subgraphConnections.get(subgraphId);
    if (subgraphConns) {
      subgraphConns.delete(connectionId);
      if (subgraphConns.size === 0) {
        this.subgraphConnections.delete(subgraphId);
      }
    }

    this.broadcastSubgraphPresence(subgraphId);
  }

  private removeConnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { tenantId, userId, userName, subgraphId } = connection;

    this.connections.delete(connectionId);

    const tenantConns = this.tenantConnections.get(tenantId);
    if (tenantConns) {
      tenantConns.delete(connectionId);
      if (tenantConns.size === 0) {
        this.tenantConnections.delete(tenantId);
      }
    }

    if (subgraphId) {
      const subgraphConns = this.subgraphConnections.get(subgraphId);
      if (subgraphConns) {
        subgraphConns.delete(connectionId);
        if (subgraphConns.size === 0) {
          this.subgraphConnections.delete(subgraphId);
        }
      }
      this.broadcastSubgraphPresence(subgraphId);
    }

    this.broadcastUserPresence(tenantId, userId, userName, 'left');
  }

  private cleanupStaleConnections() {
    const now = Date.now();
    for (const [connectionId, connection] of this.connections.entries()) {
      if (now - connection.lastHeartbeat > HEARTBEAT_TIMEOUT) {
        try {
          connection.socket.close();
        } catch (err) {
          console.error('Error closing stale connection:', err);
        }
        this.removeConnection(connectionId);
      }
    }
  }

  sendToConnection(connectionId: string, message: NotificationMessage) {
    const connection = this.connections.get(connectionId);
    if (connection && connection.socket.readyState === 1) {
      connection.socket.send(JSON.stringify(message));
    }
  }

  broadcastToTenant(tenantId: string, message: NotificationMessage) {
    const tenantConns = this.tenantConnections.get(tenantId);
    if (!tenantConns) return;

    for (const connectionId of tenantConns) {
      this.sendToConnection(connectionId, message);
    }
  }

  broadcastToSubgraph(subgraphId: string, message: NotificationMessage) {
    const subgraphConns = this.subgraphConnections.get(subgraphId);
    if (!subgraphConns) return;

    for (const connectionId of subgraphConns) {
      this.sendToConnection(connectionId, message);
    }
  }

  broadcastEvent(
    tenantId: string,
    type: NotificationEventType,
    payload: Record<string, any>,
    subgraphName?: string,
    subgraphId?: string
  ) {
    const message: NotificationMessage = {
      type,
      timestamp: new Date().toISOString(),
      subgraphName,
      subgraphId,
      payload,
    };

    this.broadcastToTenant(tenantId, message);

    if (subgraphId) {
      this.broadcastToSubgraph(subgraphId, message);
    }
  }

  private broadcastUserPresence(
    tenantId: string,
    userId: string,
    userName: string,
    action: 'joined' | 'left'
  ) {
    this.broadcastToTenant(tenantId, {
      type: 'user_presence_changed',
      timestamp: new Date().toISOString(),
      payload: {
        action,
        userId,
        userName,
        onlineUsers: this.getOnlineUsersForTenant(tenantId),
      },
    });
  }

  private broadcastSubgraphPresence(subgraphId: string) {
    const viewers = this.getOnlineUsersForSubgraph(subgraphId);
    const subgraphConns = this.subgraphConnections.get(subgraphId);
    if (!subgraphConns) return;

    for (const connectionId of subgraphConns) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        this.sendToConnection(connectionId, {
          type: 'user_presence_changed',
          timestamp: new Date().toISOString(),
          subgraphId,
          payload: {
            action: 'viewers_updated',
            subgraphId,
            viewers,
          },
        });
      }
    }
  }

  getOnlineUsersForTenant(tenantId: string): OnlineUser[] {
    const tenantConns = this.tenantConnections.get(tenantId);
    if (!tenantConns) return [];

    const users: OnlineUser[] = [];
    const seenUsers = new Set<string>();

    for (const connectionId of tenantConns) {
      const conn = this.connections.get(connectionId);
      if (conn && !seenUsers.has(conn.userId)) {
        seenUsers.add(conn.userId);
        users.push({
          userId: conn.userId,
          userName: conn.userName,
          userEmail: conn.userEmail,
          subgraphId: conn.subgraphId,
          lastHeartbeat: conn.lastHeartbeat,
        });
      }
    }

    return users;
  }

  getOnlineUsersForSubgraph(subgraphId: string): Array<{ userId: string; userName: string; userEmail: string }> {
    const subgraphConns = this.subgraphConnections.get(subgraphId);
    if (!subgraphConns) return [];

    const users: Array<{ userId: string; userName: string; userEmail: string }> = [];
    const seenUsers = new Set<string>();

    for (const connectionId of subgraphConns) {
      const conn = this.connections.get(connectionId);
      if (conn && !seenUsers.has(conn.userId)) {
        seenUsers.add(conn.userId);
        users.push({
          userId: conn.userId,
          userName: conn.userName,
          userEmail: conn.userEmail,
        });
      }
    }

    return users;
  }

  notifyApprovalStatusChanged(
    tenantId: string,
    subgraphId: string,
    subgraphName: string,
    oldStatus: string,
    newStatus: string,
    reviewedBy?: string
  ) {
    this.broadcastEvent(tenantId, 'approval_status_changed', {
      subgraphId,
      subgraphName,
      oldStatus,
      newStatus,
      reviewedBy,
    }, subgraphName, subgraphId);
  }

  notifySupergraphPublished(
    tenantId: string,
    version: number,
    compositionResult: any
  ) {
    this.broadcastEvent(tenantId, 'supergraph_published', {
      version,
      compositionResult,
    });
  }

  notifySubgraphHealthAlert(
    tenantId: string,
    subgraphId: string,
    subgraphName: string,
    alertType: string,
    currentValue: number,
    threshold: number
  ) {
    this.broadcastEvent(tenantId, 'subgraph_health_alert', {
      subgraphId,
      subgraphName,
      alertType,
      currentValue,
      threshold,
    }, subgraphName, subgraphId);
  }

  notifyGrayscaleProgress(
    tenantId: string,
    version: number,
    percent: number,
    errorCount: number,
    totalCount: number
  ) {
    this.broadcastEvent(tenantId, 'grayscale_progress', {
      version,
      percent,
      errorCount,
      totalCount,
    });
  }

  notifyLockStatusChanged(
    tenantId: string,
    subgraphId: string,
    subgraphName: string,
    lockStatus: any
  ) {
    this.broadcastEvent(tenantId, 'lock_status_changed', {
      subgraphId,
      subgraphName,
      lockStatus,
    }, subgraphName, subgraphId);
  }
}

export const notificationService = new NotificationService();
export default notificationService;
