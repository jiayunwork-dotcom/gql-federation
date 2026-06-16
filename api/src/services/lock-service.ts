import { getRedisClient } from '../cache';
import { LockStatus } from '../types';
import { notificationService } from './notification-service';
import { getSubgraphById } from './subgraph-service';

const LOCK_TTL_SECONDS = 300;
const LOCK_KEY_PREFIX = 'lock';
const WAIT_QUEUE_PREFIX = 'wait_queue';

interface LockHolder {
  userId: string;
  userName: string;
  userEmail: string;
  acquiredAt: number;
}

interface WaitQueueItem {
  userId: string;
  userName: string;
  userEmail: string;
  queuedAt: number;
}

function getLockKey(tenantId: string, subgraphId: string): string {
  return `${LOCK_KEY_PREFIX}:${tenantId}:${subgraphId}`;
}

function getWaitQueueKey(tenantId: string, subgraphId: string): string {
  return `${WAIT_QUEUE_PREFIX}:${tenantId}:${subgraphId}`;
}

async function notifyLockChange(tenantId: string, subgraphId: string) {
  const subgraph = await getSubgraphById(subgraphId, tenantId);
  const status = await getLockStatus(tenantId, subgraphId);
  if (subgraph) {
    notificationService.notifyLockStatusChanged(
      tenantId,
      subgraphId,
      subgraph.name,
      status
    );
  }
}

export async function getLockStatus(
  tenantId: string,
  subgraphId: string
): Promise<LockStatus> {
  const redis = getRedisClient();
  const lockKey = getLockKey(tenantId, subgraphId);
  const waitQueueKey = getWaitQueueKey(tenantId, subgraphId);

  const lockValue = await redis.get(lockKey);
  const waitQueueData = await redis.lrange(waitQueueKey, 0, -1);

  let holder: LockHolder | undefined;
  if (lockValue) {
    try {
      holder = JSON.parse(lockValue) as LockHolder;
    } catch {
      holder = undefined;
    }
  }

  const waitingQueue: LockStatus['waitingQueue'] = waitQueueData.map((item, index) => {
    try {
      const parsed = JSON.parse(item) as WaitQueueItem;
      return {
        userId: parsed.userId,
        userName: parsed.userName,
        userEmail: parsed.userEmail,
        position: index + 1,
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as LockStatus['waitingQueue'];

  return {
    isLocked: !!holder,
    holder,
    waitingQueue,
  };
}

export async function acquireLock(
  tenantId: string,
  subgraphId: string,
  userId: string,
  userName: string,
  userEmail: string
): Promise<{ success: boolean; position?: number; message: string }> {
  const redis = getRedisClient();
  const lockKey = getLockKey(tenantId, subgraphId);
  const waitQueueKey = getWaitQueueKey(tenantId, subgraphId);

  const existingLock = await redis.get(lockKey);
  if (!existingLock) {
    const holder: LockHolder = {
      userId,
      userName,
      userEmail,
      acquiredAt: Date.now(),
    };
    await redis.setex(lockKey, LOCK_TTL_SECONDS, JSON.stringify(holder));
    await notifyLockChange(tenantId, subgraphId);
    return { success: true, message: '编辑权获取成功' };
  }

  try {
    const holder = JSON.parse(existingLock) as LockHolder;
    if (holder.userId === userId) {
      await redis.expire(lockKey, LOCK_TTL_SECONDS);
      return { success: true, message: '你已经持有编辑权' };
    }
  } catch {
    const holder: LockHolder = {
      userId,
      userName,
      userEmail,
      acquiredAt: Date.now(),
    };
    await redis.setex(lockKey, LOCK_TTL_SECONDS, JSON.stringify(holder));
    await notifyLockChange(tenantId, subgraphId);
    return { success: true, message: '编辑权获取成功' };
  }

  const existingQueue = await redis.lrange(waitQueueKey, 0, -1);
  const userInQueue = existingQueue.some((item) => {
    try {
      const parsed = JSON.parse(item) as WaitQueueItem;
      return parsed.userId === userId;
    } catch {
      return false;
    }
  });

  if (userInQueue) {
    const position = existingQueue.findIndex((item) => {
      try {
        const parsed = JSON.parse(item) as WaitQueueItem;
        return parsed.userId === userId;
      } catch {
        return false;
      }
    }) + 1;
    return { success: false, position, message: `你已在等待队列中，当前是第${position}位` };
  }

  const queueItem: WaitQueueItem = {
    userId,
    userName,
    userEmail,
    queuedAt: Date.now(),
  };
  await redis.rpush(waitQueueKey, JSON.stringify(queueItem));

  const queueLength = await redis.llen(waitQueueKey);
  await notifyLockChange(tenantId, subgraphId);
  return { success: false, position: queueLength, message: `已加入等待队列，你是第${queueLength}位等待者` };
}

export async function releaseLock(
  tenantId: string,
  subgraphId: string,
  userId: string
): Promise<{ success: boolean; message: string; transferredTo?: { userId: string; userName: string; userEmail: string } }> {
  const redis = getRedisClient();
  const lockKey = getLockKey(tenantId, subgraphId);
  const waitQueueKey = getWaitQueueKey(tenantId, subgraphId);

  const existingLock = await redis.get(lockKey);
  if (!existingLock) {
    return { success: true, message: '当前没有持有的编辑锁' };
  }

  try {
    const holder = JSON.parse(existingLock) as LockHolder;
    if (holder.userId !== userId) {
      return { success: false, message: '你没有持有此编辑锁' };
    }
  } catch {
    await redis.del(lockKey);
    await notifyLockChange(tenantId, subgraphId);
    return { success: true, message: '编辑锁已释放' };
  }

  const nextWaiter = await redis.lpop(waitQueueKey);
  if (nextWaiter) {
    try {
      const waiter = JSON.parse(nextWaiter) as WaitQueueItem;
      const newHolder: LockHolder = {
        userId: waiter.userId,
        userName: waiter.userName,
        userEmail: waiter.userEmail,
        acquiredAt: Date.now(),
      };
      await redis.setex(lockKey, LOCK_TTL_SECONDS, JSON.stringify(newHolder));
      await notifyLockChange(tenantId, subgraphId);
      return {
        success: true,
        message: '编辑锁已释放并转让给下一位等待者',
        transferredTo: {
          userId: waiter.userId,
          userName: waiter.userName,
          userEmail: waiter.userEmail,
        },
      };
    } catch {
      await redis.del(lockKey);
      await notifyLockChange(tenantId, subgraphId);
      return { success: true, message: '编辑锁已释放' };
    }
  } else {
    await redis.del(lockKey);
    await notifyLockChange(tenantId, subgraphId);
    return { success: true, message: '编辑锁已释放' };
  }
}

export async function refreshLock(
  tenantId: string,
  subgraphId: string,
  userId: string
): Promise<boolean> {
  const redis = getRedisClient();
  const lockKey = getLockKey(tenantId, subgraphId);

  const existingLock = await redis.get(lockKey);
  if (!existingLock) {
    return false;
  }

  try {
    const holder = JSON.parse(existingLock) as LockHolder;
    if (holder.userId !== userId) {
      return false;
    }
    await redis.expire(lockKey, LOCK_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

export async function cancelWait(
  tenantId: string,
  subgraphId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  const redis = getRedisClient();
  const waitQueueKey = getWaitQueueKey(tenantId, subgraphId);

  const existingQueue = await redis.lrange(waitQueueKey, 0, -1);
  const itemIndex = existingQueue.findIndex((item) => {
    try {
      const parsed = JSON.parse(item) as WaitQueueItem;
      return parsed.userId === userId;
    } catch {
      return false;
    }
  });

  if (itemIndex === -1) {
    return { success: true, message: '你不在等待队列中' };
  }

  await redis.lrem(waitQueueKey, 1, existingQueue[itemIndex]);
  await notifyLockChange(tenantId, subgraphId);
  return { success: true, message: '已取消等待' };
}

export default {
  getLockStatus,
  acquireLock,
  releaseLock,
  refreshLock,
  cancelWait,
};
