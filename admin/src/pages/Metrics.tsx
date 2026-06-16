import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Progress, Select, DatePicker } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import api from '../api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

function Metrics() {
  const [data, setData] = useState<any>(null);
  const [fieldUsage, setFieldUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [overviewRes, fieldsRes] = await Promise.all([
        api.get('/metrics/overview'),
        api.get('/metrics/fields?limit=50'),
      ]);
      setData(overviewRes.data);
      setFieldUsage(fieldsRes.data.fieldUsage || []);
    } catch (err) {
      console.error('Failed to load metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const fieldColumns = [
    {
      title: '类型',
      dataIndex: 'type_name',
      key: 'type_name',
    },
    {
      title: '字段名',
      dataIndex: 'field_name',
      key: 'field_name',
    },
    {
      title: 'SubGraph',
      dataIndex: 'subgraph_name',
      key: 'subgraph_name',
      render: (v: string) => v || '-',
    },
    {
      title: '使用次数',
      dataIndex: 'usage_count',
      key: 'usage_count',
      sorter: (a: any, b: any) => a.usage_count - b.usage_count,
    },
    {
      title: '最后使用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '从未使用',
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总查询数 (24h)"
              value={data?.summary?.totalQueries || 0}
              valueStyle={{ color: '#1677ff' }}
              prefix={<ArrowUpOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="错误数 (24h)"
              value={data?.summary?.errorCount || 0}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均响应时间"
              value={data?.summary?.avgDuration || 0}
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
              value={data?.summary?.p99Duration || 0}
              precision={0}
              suffix="ms"
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="SubGraph 健康状况" style={{ marginBottom: 24 }}>
        <Table
          columns={[
            { title: 'SubGraph', dataIndex: 'subgraph_name', key: 'subgraph_name' },
            {
              title: 'QPS',
              dataIndex: 'qps',
              key: 'qps',
              render: (v: number) => v?.toFixed(2) || 0,
            },
            {
              title: '平均延迟',
              dataIndex: 'avg_response_time_ms',
              key: 'avg_response_time_ms',
              render: (v: number) => `${v?.toFixed(0) || 0}ms`,
            },
            {
              title: 'P99 延迟',
              dataIndex: 'p99_response_time_ms',
              key: 'p99_response_time_ms',
              render: (v: number) => `${v?.toFixed(0) || 0}ms`,
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
          ]}
          dataSource={data?.subgraphHealth || []}
          rowKey="subgraph_name"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Card title="字段使用统计 Top 50">
        <Table
          columns={fieldColumns}
          dataSource={fieldUsage}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  );
}

export default Metrics;
