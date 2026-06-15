import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Modal, Form, Input, Select, Switch, message, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../api';

interface AlertConfig {
  id: string;
  name: string;
  type: string;
  threshold: number;
  comparison: string;
  channels: any[];
  is_enabled: boolean;
  last_triggered_at?: string;
}

function Alerts() {
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertConfig | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const response = await api.get('/alerts');
      setAlerts(response.data.alerts || []);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingAlert) {
        await api.put(`/alerts/${editingAlert.id}`, values);
        message.success('告警配置更新成功');
      } else {
        await api.post('/alerts', values);
        message.success('告警配置创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      loadAlerts();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const toggleAlert = async (id: string, enabled: boolean) => {
    try {
      await api.put(`/alerts/${id}`, { is_enabled: enabled });
      message.success(enabled ? '告警已启用' : '告警已禁用');
      loadAlerts();
    } catch (err) {
      message.error('操作失败');
    }
  };

  const columns = [
    {
      title: '告警名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const typeMap: Record<string, string> = {
          error_rate: '错误率',
          latency: '延迟',
          schema_change: 'Schema 变更',
        };
        return typeMap[type] || type;
      },
    },
    {
      title: '阈值',
      dataIndex: 'threshold',
      key: 'threshold',
      render: (val: number, record: AlertConfig) => {
        const comp = record.comparison === 'gt' ? '>' : '<';
        const unit = record.type === 'error_rate' ? '%' : 'ms';
        return `${comp} ${val}${unit}`;
      },
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      key: 'is_enabled',
      render: (enabled: boolean, record: AlertConfig) => (
        <Switch
          checked={enabled}
          onChange={(val) => toggleAlert(record.id, val)}
        />
      ),
    },
    {
      title: '最后触发',
      dataIndex: 'last_triggered_at',
      key: 'last_triggered_at',
      render: (date: string) => date ? new Date(date).toLocaleString() : '从未触发',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: AlertConfig) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => {
            setEditingAlert(record);
            form.setFieldsValue(record);
            setModalVisible(true);
          }}>
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>告警配置</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setEditingAlert(null);
          form.resetFields();
          setModalVisible(true);
        }}>
          新建告警
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={alerts}
        rowKey="id"
        loading={loading}
      />

      <Modal
        title={editingAlert ? '编辑告警' : '新建告警'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="告警名称" rules={[{ required: true }]}>
            <Input placeholder="告警名称" />
          </Form.Item>
          <Form.Item name="type" label="告警类型" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="error_rate">错误率告警</Select.Option>
              <Select.Option value="latency">延迟告警</Select.Option>
              <Select.Option value="schema_change">Schema 变更告警</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="threshold" label="阈值" rules={[{ required: true }]}>
            <Input type="number" placeholder="阈值" />
          </Form.Item>
          <Form.Item name="comparison" label="比较方式" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="gt">大于 (>)</Select.Option>
              <Select.Option value="lt">小于 (<)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="通知渠道">
            <Tag>邮件</Tag>
            <Tag>Slack</Tag>
            <Tag>Webhook</Tag>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              保存
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Alerts;
