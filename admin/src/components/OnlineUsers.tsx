import React from 'react';
import { Avatar, Tooltip, Space } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { RemoteCursor } from '../types/collaboration';

interface OnlineUser {
  userId: string;
  userName: string;
  userEmail: string;
}

interface OnlineUsersProps {
  users: OnlineUser[];
  currentUserId?: string;
  maxVisible?: number;
  remoteCursors?: RemoteCursor[];
}

const OnlineUsers: React.FC<OnlineUsersProps> = ({
  users,
  currentUserId,
  maxVisible = 5,
  remoteCursors = [],
}) => {
  const visibleUsers = users.slice(0, maxVisible);
  const hiddenCount = Math.max(0, users.length - maxVisible);
  const otherUsers = users.filter(u => u.userId !== currentUserId);

  const getCursorForUser = (userId: string) => {
    return remoteCursors.find(c => c.userId === userId);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const getAvatarColor = (email: string) => {
    const colors = [
      '#f56a00', '#7265e6', '#ffbf00', '#00a2ae',
      '#1890ff', '#52c41a', '#eb2f96', '#fa8c16',
    ];
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="online-users">
      <div style={{ fontSize: '12px', color: '#8c8c8c', marginBottom: '8px' }}>
        正在查看 ({otherUsers.length} 人在线)
      </div>
      <Space size={-8}>
        {visibleUsers.map((user) => {
          const cursor = getCursorForUser(user.userId);
          return (
            <Tooltip
              key={user.userId}
              title={
                <div>
                  <div style={{ fontWeight: 'bold' }}>{user.userName}</div>
                  <div style={{ fontSize: '11px' }}>{user.userEmail}</div>
                  {cursor && (
                    <div style={{ fontSize: '11px', color: '#1890ff', marginTop: 4 }}>
                      当前位置: 第{cursor.lineNumber}行, 第{cursor.columnNumber}列
                    </div>
                  )}
                  {user.userId === currentUserId && (
                    <div style={{ fontSize: '11px', color: '#52c41a' }}>(你)</div>
                  )}
                </div>
              }
            >
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Avatar
                  size="small"
                  style={{
                    backgroundColor: getAvatarColor(user.userEmail),
                    border: '2px solid #fff',
                    opacity: user.userId === currentUserId ? 1 : 0.85,
                  }}
                >
                  {getInitials(user.userName)}
                </Avatar>
                {cursor && user.userId !== currentUserId && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -4,
                      right: -4,
                      fontSize: '10px',
                      backgroundColor: getAvatarColor(user.userEmail),
                      color: '#fff',
                      borderRadius: 10,
                      padding: '1px 4px',
                      border: '1px solid #fff',
                      lineHeight: 1,
                    }}
                  >
                    {cursor.lineNumber}
                  </div>
                )}
              </div>
            </Tooltip>
          );
        })}
        {hiddenCount > 0 && (
          <Tooltip title={`还有 ${hiddenCount} 人`}>
            <Avatar
              size="small"
              style={{
                backgroundColor: '#8c8c8c',
                border: '2px solid #fff',
              }}
            >
              +{hiddenCount}
            </Avatar>
          </Tooltip>
        )}
      </Space>
    </div>
  );
};

export default OnlineUsers;
