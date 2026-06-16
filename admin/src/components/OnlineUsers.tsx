import React from 'react';
import { Avatar, Tooltip, Space } from 'antd';
import { UserOutlined } from '@ant-design/icons';

interface OnlineUser {
  userId: string;
  userName: string;
  userEmail: string;
}

interface OnlineUsersProps {
  users: OnlineUser[];
  currentUserId?: string;
  maxVisible?: number;
}

const OnlineUsers: React.FC<OnlineUsersProps> = ({
  users,
  currentUserId,
  maxVisible = 5,
}) => {
  const visibleUsers = users.slice(0, maxVisible);
  const hiddenCount = Math.max(0, users.length - maxVisible);
  const otherUsers = users.filter(u => u.userId !== currentUserId);

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
        {visibleUsers.map((user) => (
          <Tooltip
            key={user.userId}
            title={
              <div>
                <div style={{ fontWeight: 'bold' }}>{user.userName}</div>
                <div style={{ fontSize: '11px' }}>{user.userEmail}</div>
                {user.userId === currentUserId && (
                  <div style={{ fontSize: '11px', color: '#52c41a' }}>(你)</div>
                )}
              </div>
            }
          >
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
          </Tooltip>
        ))}
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
