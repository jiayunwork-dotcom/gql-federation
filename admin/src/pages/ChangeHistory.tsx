import React, { useState, useEffect } from 'react';
import { Card, Timeline, Tag, Descriptions, Modal, List } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, WarningOutlined } from '@ant-design/icons';
import api from '../api';
import dayjs from 'dayjs';

interface CompositionLog {
  id: string;
  trigger_type: string;
  status: string;
  errors: any[];
  warnings: any[];
  breaking_changes: any[];
  duration_ms: number;
  created_at: string;
  triggered_by?: string;
}

function ChangeHistory() {
  const [logs, setLogs] = useState<CompositionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<CompositionLog | null>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      const response = await api.get('/supergraph/composition/logs?limit=50');
      setLogs(response.data.logs || []);
    } catch (err) {
      console.error('Failed to load composition logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'green';
      case 'failed': return 'red';
      case 'partial': return 'orange';
      default: return 'gray';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'failed': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default: return <WarningOutlined style={{ color: '#faad14' }} />;
    }
  };

  return (
    <div>
      <Card title="Schema 变更历史">
        <Timeline
          mode="left"
          items={logs.map(log => ({
            color: getStatusColor(log.status),
            dot: getStatusIcon(log.status),
            children: (
              <Card 
                size="small" 
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedLog(log)}
                hoverable
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Tag color={getStatusColor(log.status)} style={{ marginRight: 8 }}>
                      {log.status === 'success' ? '成功' : log.status === 'failed' ? '失败' : log.status}
                    </Tag>
                    <strong>{log.trigger_type === 'schema_change' ? 'Schema 变更' : log.trigger_type === 'rollback' ? '回滚' : log.trigger_type}</strong>
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>
                    {dayjs(log.created_at).format('YYYY-MM-DD HH:mm:ss')}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                  耗时: {log.duration_ms || 0}ms
                  {log.triggered_by && ` · 触发者: ${log.triggered_by}`}
                  {log.errors?.length > 0 && ` · 错误: ${log.errors.length}`}
                  {log.breaking_changes?.length > 0 && ` · Breaking Changes: ${log.breaking_changes.length}`}
                </div>
              </Card>
            ),
          }))}
        />
      </Card>

      <Modal
        title="变更详情"
        open={!!selectedLog}
        onCancel={() => setSelectedLog(null)}
        footer={null}
        width={800}
      >
        {selectedLog && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                <Tag color={getStatusColor(selectedLog.status)}>
                  {selectedLog.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="触发类型">
                {selectedLog.trigger_type}
              </Descriptions.Item>
              <Descriptions.Item label="触发者">
                {selectedLog.triggered_by || '系统'}
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {selectedLog.duration_ms || 0}ms
              </Descriptions.Item>
            </Descriptions>

            {selectedLog.breaking_changes?.length > 0 && (
              <Card size="small" title="Breaking Changes" type="inner" style={{ marginBottom: 8 }}>
                <List
                  size="small"
                  dataSource={selectedLog.breaking_changes}
                  renderItem={(item: any) => (
                    <List.Item>
                      <Tag color="red">{item.type}</Tag>
                      {item.description}
                      {item.path && <span style={{ color: '#999', marginLeft: 8 }}>({item.path})</span>}
                    </List.Item>
                  )}
                />
              </Card>
            )}

            {selectedLog.errors?.length > 0 && (
              <Card size="small" title="错误" type="inner" style={{ marginBottom: 8 }}>
                <List
                  size="small"
                  dataSource={selectedLog.errors}
                  renderItem={(item: any) => (
                    <List.Item>
                      <Tag color="red">{item.subgraph}</Tag>
                      {item.message}
                    </List.Item>
                  )}
                />
              </Card>
            )}

            {selectedLog.warnings?.length > 0 && (
              <Card size="small" title="警告" type="inner">
                <List
                  size="small"
                  dataSource={selectedLog.warnings}
                  renderItem={(item: any) => (
                    <List.Item>
                      <Tag color="orange">{item.type}</Tag>
                      {item.message}
                    </List.Item>
                  )}
                />
              </Card>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

export default ChangeHistory;
