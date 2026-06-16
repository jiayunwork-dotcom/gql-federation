import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Progress } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import api from '../api';
import dayjs from 'dayjs';

interface OverviewData {
  summary: {
    totalQueries: number;
    errorCount: number;
    avgDuration: number;
    p99Duration: number;
  };
  subgraphHealth: Array<{
    subgraph_name: string;
    avg_response_time_ms: number;
    p99_response_time_ms: number;
    error_rate: number;
    qps: number;
    total_requests: number;
    error_count: number;
  }>;
  topQueries: Array<{
    queryHash: string;
    operationName?: string;
    count: number;
    avgDuration: number;
    errorRate: number;
  }>;
}

function Dashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const response = await api.get('/metrics/overview');
      setData(response.data);
    } catch (err) {
      console.error('Failed to load overview:', err);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: 'SubGraph',
      dataIndex: 'subgraph_name',
      key: 'subgraph_name',
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => (
        record.error_rate > 5 
          ? <Tag icon={<ExclamationCircleOutlined />} color="error">异常</Tag>
          : <Tag icon={<CheckCircleOutlined />} color="success">健康</Tag>
      ),
    },
    {
      title: 'QPS',
      dataIndex: 'qps',
      key: 'qps',
      render: (val: number) => val?.toFixed(2) || 0,
    },
    {
      title: '平均延迟',
      dataIndex: 'avg_response_time_ms',
      key: 'avg_response_time_ms',
      render: (val: number) => `${val?.toFixed(0) || 0}ms`,
    },
    {
      title: 'P99 延迟',
      dataIndex: 'p99_response_time_ms',
      key: 'p99_response_time_ms',
      render: (val: number) => `${val?.toFixed(0) || 0}ms`,
    },
    {
      title: '错误率',
      dataIndex: 'error_rate',
      key: 'error_rate',
      render: (val: number) => (
        <Progress 
          percent={Number(val?.toFixed(2)) || 0} 
          size="small"
          status={val > 5 ? 'exception' : val > 2 ? 'normal' : 'success'}
        />
      ),
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="24小时查询总数"
              value={data?.summary.totalQueries || 0}
              precision={0}
              valueStyle={{ color: '#1677ff' }}
              prefix={<ArrowUpOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均响应时间"
              value={data?.summary.avgDuration || 0}
              precision={0}
              suffix="ms"
              valueStyle={{ color: '#389e0d' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="P99 延迟"
              value={data?.summary.p99Duration || 0}
              precision={0}
              suffix="ms"
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="错误率"
              value={data?.summary.errorCount ? (data.summary.errorCount / data.summary.totalQueries * 100).toFixed(2) : 0}
              suffix="%"
              valueStyle={{ color: '#cf1322' }}
              prefix={<ArrowDownOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="SubGraph 健康状态" style={{ marginBottom: 24 }}>
        <Table
          columns={columns}
          dataSource={data?.subgraphHealth || []}
          rowKey="subgraph_name"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Card title="热门查询 Top 10">
        <Table
          columns={[
            { title: '查询哈希', dataIndex: 'queryHash', key: 'queryHash', ellipsis: true },
            { title: '操作名', dataIndex: 'operationName', key: 'operationName' },
            { title: '调用次数', dataIndex: 'count', key: 'count', sorter: (a: any, b: any) => a.count - b.count },
            { title: '平均耗时', dataIndex: 'avgDuration', key: 'avgDuration', render: (v: number) => `${v?.toFixed(0)}ms` },
            { title: '错误率', dataIndex: 'errorRate', key: 'errorRate', render: (v: number) => `${v?.toFixed(2)}%` },
          ]}
          dataSource={data?.topQueries || []}
          rowKey="queryHash"
          loading={loading}
          pagination={false}
        />
      </Card>
    </div>
  );
}

export default Dashboard;
