import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Input,
  Select,
  DatePicker,
  Modal,
  List,
  Empty,
  Spin,
  message,
  Tooltip,
} from 'antd';
import {
  HistoryOutlined,
  SearchOutlined,
  RocketOutlined,
  RollbackOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ReleaseAuditLog, CanaryRelease } from '../types/version-management';
import { getReleaseAuditLogs, getCanaryById } from '../api/version-management';

const { RangePicker } = DatePicker;
const { Option } = Select;

const ReleaseHistory: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<ReleaseAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [subgraphName, setSubgraphName] = useState('');
  const [actionType, setActionType] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ReleaseAuditLog | null>(null);
  const [canaryDetail, setCanaryDetail] = useState<CanaryRelease | null>(null);
  const [canaryLoading, setCanaryLoading] = useState(false);

  const loadAuditLogs = async () => {
    setLoading(true);
    try {
      const params: any = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      };
      if (actionType) {
        params.actionType = actionType;
      }
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.startTime = dateRange[0].toISOString();
        params.endTime = dateRange[1].toISOString();
      }
      const result = await getReleaseAuditLogs(params);
      
      if (subgraphName) {
        const filtered = result.rows.filter((log) =>
          log.subgraph_name.toLowerCase().includes(subgraphName.toLowerCase())
        );
        setAuditLogs(filtered);
        setTotal(filtered.length);
      } else {
        setAuditLogs(result.rows);
        setTotal(result.total);
      }
    } catch (err: any) {
      message.error('加载发布记录失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [page, pageSize]);

  const handleSearch = () => {
    setPage(1);
    loadAuditLogs();
  };

  const handleViewDetail = async (log: ReleaseAuditLog) => {
    setSelectedLog(log);
    setDetailModalVisible(true);
    
    if (log.canary_release_id) {
      setCanaryLoading(true);
      try {
        const canary = await getCanaryById(log.canary_release_id);
        setCanaryDetail(canary);
      } catch (err: any) {
        console.error('加载灰度详情失败:', err);
      } finally {
        setCanaryLoading(false);
      }
    } else {
      setCanaryDetail(null);
    }
  };

  const getActionTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      start_canary: '启动灰度',
      adjust_percent: '调整比例',
      full_release: '全量发布',
      rollback: '回滚',
      version_published: '版本发布',
    };
    return typeMap[type] || type;
  };

  const getActionTypeColor = (type: string) => {
    const colorMap: Record<string, string> = {
      start_canary: 'blue',
      adjust_percent: 'cyan',
      full_release: 'green',
      rollback: 'red',
      version_published: 'purple',
    };
    return colorMap[type] || 'default';
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'start_canary':
        return <PlayCircleOutlined />;
      case 'adjust_percent':
        return <RocketOutlined />;
      case 'full_release':
        return <CheckCircleOutlined />;
      case 'rollback':
        return <RollbackOutlined />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  const columns = [
    {
      title: '操作时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作类型',
      dataIndex: 'action_type',
      key: 'action_type',
      width: 120,
      render: (type: string) => (
        <Tag color={getActionTypeColor(type)} icon={getActionIcon(type)}>
          {getActionTypeText(type)}
        </Tag>
      ),
    },
    {
      title: 'SubGraph',
      dataIndex: 'subgraph_name',
      key: 'subgraph_name',
      width: 150,
    },
    {
      title: '版本变更',
      key: 'version',
      width: 200,
      render: (_: any, record: ReleaseAuditLog) => {
        if (record.old_version_string && record.new_version_string) {
          return (
            <Space>
              <Tag color="default">{record.old_version_string}</Tag>
              <span>→</span>
              <Tag color="blue">{record.new_version_string}</Tag>
            </Space>
          );
        }
        return '-';
      },
    },
    {
      title: '灰度比例变化',
      key: 'percent',
      width: 150,
      render: (_: any, record: ReleaseAuditLog) => {
        if (record.old_percent !== undefined && record.new_percent !== undefined) {
          return (
            <Space>
              <span>{record.old_percent}%</span>
              <span>→</span>
              <span style={{ color: record.new_percent > record.old_percent ? '#52c41a' : '#ff4d4f' }}>
                {record.new_percent}%
              </span>
            </Space>
          );
        }
        return '-';
      },
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 120,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>{text || '-'}</Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: ReleaseAuditLog) => (
        <Button type="link" onClick={() => handleViewDetail(record)}>
          详情
        </Button>
      ),
    },
  ];

  const renderDetailModal = () => (
    <Modal
      title="发布记录详情"
      open={detailModalVisible}
      onCancel={() => setDetailModalVisible(false)}
      footer={null}
      width={600}
    >
      {selectedLog && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <h4 style={{ marginBottom: 8 }}>基本信息</h4>
            <List size="small">
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>操作时间:</span>
                <span>{dayjs(selectedLog.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>
              </List.Item>
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>操作类型:</span>
                <Tag color={getActionTypeColor(selectedLog.action_type)}>
                  {getActionTypeText(selectedLog.action_type)}
                </Tag>
              </List.Item>
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>SubGraph:</span>
                <span>{selectedLog.subgraph_name}</span>
              </List.Item>
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>操作人:</span>
                <span>{selectedLog.operator}</span>
              </List.Item>
              {selectedLog.old_version_string && selectedLog.new_version_string && (
                <List.Item>
                  <span style={{ color: '#8c8c8c', width: 100 }}>版本变更:</span>
                  <Space>
                    <Tag color="default">{selectedLog.old_version_string}</Tag>
                    <span>→</span>
                    <Tag color="blue">{selectedLog.new_version_string}</Tag>
                  </Space>
                </List.Item>
              )}
              {selectedLog.old_percent !== undefined && selectedLog.new_percent !== undefined && (
                <List.Item>
                  <span style={{ color: '#8c8c8c', width: 100 }}>灰度比例:</span>
                  <Space>
                    <span>{selectedLog.old_percent}%</span>
                    <span>→</span>
                    <span>{selectedLog.new_percent}%</span>
                  </Space>
                </List.Item>
              )}
              {selectedLog.reason && (
                <List.Item>
                  <span style={{ color: '#8c8c8c', width: 100 }}>原因:</span>
                  <span>{selectedLog.reason}</span>
                </List.Item>
              )}
            </List>
          </div>

          {selectedLog.canary_release_id && (
            <div>
              <h4 style={{ marginBottom: 8 }}>灰度发布详情</h4>
              {canaryLoading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <Spin />
                </div>
              ) : canaryDetail ? (
                <List size="small">
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>状态:</span>
                    <Tag>{canaryDetail.status}</Tag>
                  </List.Item>
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>当前比例:</span>
                    <span>{canaryDetail.current_percent}%</span>
                  </List.Item>
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>发起人:</span>
                    <span>{canaryDetail.started_by}</span>
                  </List.Item>
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>开始时间:</span>
                    <span>{dayjs(canaryDetail.started_at).format('YYYY-MM-DD HH:mm:ss')}</span>
                  </List.Item>
                  {canaryDetail.completed_at && (
                    <List.Item>
                      <span style={{ color: '#8c8c8c', width: 100 }}>结束时间:</span>
                      <span>{dayjs(canaryDetail.completed_at).format('YYYY-MM-DD HH:mm:ss')}</span>
                    </List.Item>
                  )}
                  {canaryDetail.rollback_reason && (
                    <List.Item>
                      <span style={{ color: '#8c8c8c', width: 100 }}>回滚原因:</span>
                      <span>{canaryDetail.rollback_reason}</span>
                    </List.Item>
                  )}
                  {canaryDetail.percent_history && canaryDetail.percent_history.length > 0 && (
                    <List.Item>
                      <span style={{ color: '#8c8c8c', width: 100, verticalAlign: 'top', paddingTop: 4 }}>
                        调整轨迹:
                      </span>
                      <div style={{ flex: 1 }}>
                        {canaryDetail.percent_history.slice().reverse().map((item, idx) => (
                          <div key={idx} style={{ marginBottom: 4 }}>
                            <Tag color="blue">{item.percent}%</Tag>
                            <span style={{ marginLeft: 8, fontSize: 12, color: '#8c8c8c' }}>
                              {dayjs(item.changedAt).format('YYYY-MM-DD HH:mm:ss')}
                            </span>
                            <span style={{ marginLeft: 8, fontSize: 12 }}>{item.reason}</span>
                          </div>
                        ))}
                      </div>
                    </List.Item>
                  )}
                </List>
              ) : (
                <Empty description="暂无灰度详情" />
              )}
            </div>
          )}
        </Space>
      )}
    </Modal>
  );

  return (
    <div>
      <Card
        title={
          <Space>
            <HistoryOutlined />
            <span>发布记录</span>
          </Space>
        }
        extra={
          <Space>
            <Input
              placeholder="搜索 SubGraph 名称"
              prefix={<SearchOutlined />}
              value={subgraphName}
              onChange={(e) => setSubgraphName(e.target.value)}
              style={{ width: 200 }}
              onPressEnter={handleSearch}
            />
            <Select
              placeholder="操作类型"
              value={actionType}
              onChange={setActionType}
              style={{ width: 150 }}
              allowClear
            >
              <Option value="start_canary">启动灰度</Option>
              <Option value="adjust_percent">调整比例</Option>
              <Option value="full_release">全量发布</Option>
              <Option value="rollback">回滚</Option>
              <Option value="version_published">版本发布</Option>
            </Select>
            <RangePicker
              value={dateRange as any}
              onChange={(dates) => setDateRange(dates as any)}
              style={{ width: 280 }}
            />
            <Button type="primary" onClick={handleSearch}>
              筛选
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={auditLogs}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条记录`,
          }}
        />
      </Card>

      {renderDetailModal()}
    </div>
  );
};

export default ReleaseHistory;
