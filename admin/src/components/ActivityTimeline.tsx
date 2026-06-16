import React, { useRef, useEffect } from 'react';
import { List, Avatar, Tag } from 'antd';
import {
  EditOutlined,
  SaveOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserOutlined,
  SwapOutlined,
  SendOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { ActivityLog, ActionType } from '../types/collaboration';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface ActivityTimelineProps {
  logs: ActivityLog[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

const actionConfig: Record<ActionType, { icon: React.ReactNode; color: string; label: string }> = {
  lock_acquired: {
    icon: <EditOutlined />,
    color: 'blue',
    label: '获取编辑权',
  },
  lock_released: {
    icon: <LogoutOutlined />,
    color: 'default',
    label: '释放编辑权',
  },
  lock_transferred: {
    icon: <SwapOutlined />,
    color: 'purple',
    label: '编辑权转让',
  },
  draft_saved: {
    icon: <SaveOutlined />,
    color: 'orange',
    label: '保存草稿',
  },
  change_submitted: {
    icon: <SendOutlined />,
    color: 'cyan',
    label: '提交变更',
  },
  change_approved: {
    icon: <CheckCircleOutlined />,
    color: 'green',
    label: '变更批准',
  },
  change_rejected: {
    icon: <CloseCircleOutlined />,
    color: 'red',
    label: '变更拒绝',
  },
  user_joined: {
    icon: <UserOutlined />,
    color: 'green',
    label: '用户加入',
  },
  user_left: {
    icon: <UserOutlined />,
    color: 'default',
    label: '用户离开',
  },
};

const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  logs,
  loading = false,
  hasMore = false,
  onLoadMore,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !loading && onLoadMore) {
            onLoadMore();
          }
        },
        { threshold: 0.1 }
      );

      const lastItem = listRef.current.querySelector('.activity-item:last-child');
      if (lastItem) {
        observer.observe(lastItem);
      }

      return () => observer.disconnect();
    }
  }, [logs, hasMore, loading, onLoadMore]);

  const renderActionText = (log: ActivityLog) => {
    const config = actionConfig[log.action_type] || actionConfig.user_joined;
    const userName = log.user_name || '系统';

    switch (log.action_type) {
      case 'lock_acquired':
        return `${userName} 获取了编辑权`;
      case 'lock_released':
        return `${userName} 释放了编辑权`;
      case 'lock_transferred':
        return `编辑权从 ${log.payload?.from?.userName || '未知'} 转让给 ${log.payload?.to?.userName || '未知'}`;
      case 'draft_saved':
        return `${userName} 保存了草稿 (${log.payload?.sdlLength || 0} 字符)`;
      case 'change_submitted':
        return `${userName} 提交了变更: ${log.payload?.changelog?.substring(0, 50) || '无描述'}${(log.payload?.changelog?.length || 0) > 50 ? '...' : ''}`;
      case 'change_approved':
        return `${userName} 批准了变更: ${log.payload?.changelog?.substring(0, 50) || '无描述'}`;
      case 'change_rejected':
        return `${userName} 拒绝了变更: ${log.payload?.reason?.substring(0, 50) || '无原因'}`;
      case 'user_joined':
        return `${userName} 加入了编辑`;
      case 'user_left':
        return `${userName} 离开了编辑`;
      default:
        return `${userName} 执行了 ${log.action_type}`;
    }
  };

  const getAvatarColor = (log: ActivityLog) => {
    const config = actionConfig[log.action_type] || actionConfig.user_joined;
    const colorMap: Record<string, string> = {
      blue: '#1890ff',
      green: '#52c41a',
      red: '#ff4d4f',
      orange: '#fa8c16',
      purple: '#722ed1',
      cyan: '#13c2c2',
      default: '#8c8c8c',
    };
    return colorMap[config.color] || '#1890ff';
  };

  return (
    <div className="activity-timeline" ref={listRef}>
      <List
        loading={loading}
        dataSource={logs}
        locale={{ emptyText: '暂无活动记录' }}
        renderItem={(log, index) => {
          const config = actionConfig[log.action_type] || actionConfig.user_joined;
          return (
            <List.Item
              key={log.id}
              className="activity-item"
              style={{
                animation: index === 0 ? 'slideIn 0.3s ease-out' : 'none',
                padding: '12px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <List.Item.Meta
                avatar={
                  <Avatar
                    style={{ backgroundColor: getAvatarColor(log) }}
                    icon={config.icon}
                  />
                }
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Tag color={config.color}>{config.label}</Tag>
                    <span style={{ fontSize: '12px', color: '#8c8c8c' }}>
                      {dayjs(log.created_at).fromNow()}
                    </span>
                  </div>
                }
                description={
                  <div>
                    <div style={{ color: '#262626' }}>{renderActionText(log)}</div>
                    <div style={{ fontSize: '11px', color: '#bfbfbf', marginTop: '4px' }}>
                      {dayjs(log.created_at).format('YYYY-MM-DD HH:mm:ss')}
                    </div>
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />
      {hasMore && !loading && (
        <div style={{ textAlign: 'center', padding: '12px', color: '#8c8c8c' }}>
          加载更多...
        </div>
      )}
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default ActivityTimeline;
