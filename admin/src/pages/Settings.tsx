import React, { useState, useEffect } from 'react';
import { Card, Form, Input, InputNumber, Switch, Button, message, Select, Table, Space, Modal } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../api';
import { useAuth } from '../store/auth';

function Settings() {
  const { user, logout, setTenantId, tenantId } = useAuth();
  const [tenants, setTenants] = useState<any[]>([]);
  const [tenantModalVisible, setTenantModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [currentTenant, setCurrentTenant] = useState<any>(null);

  useEffect(() => {
    loadTenants();
    loadCurrentTenant();
  }, []);

  const loadTenants = async () => {
    if (user?.role !== 'super_admin') return;
    try {
      const response = await api.get('/tenants');
      setTenants(response.data.tenants || []);
    } catch (err) {
      console.error('Failed to load tenants:', err);
    }
  };

  const loadCurrentTenant = async () => {
    try {
      const response = await api.get('/tenants');
      const all = response.data.tenants || [];
      const found = all.find((t: any) => t.name === tenantId);
      setCurrentTenant(found || null);
    } catch (err) {
      console.error('Failed to load current tenant:', err);
    }
  };

  const handleCreateTenant = async (values: any) => {
    try {
      await api.post('/tenants', values);
      message.success('租户创建成功');
      setTenantModalVisible(false);
      form.resetFields();
      loadTenants();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    }
  };

  const handleTenantChange = (value: string) => {
    setTenantId(value);
    message.success(`已切换到租户: ${value}`);
    window.location.reload();
  };

  const tenantColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '显示名', dataIndex: 'display_name', key: 'display_name' },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Switch checked={active} size="small" disabled />
      ),
    },
    { title: '最大查询深度', dataIndex: 'max_query_depth', key: 'max_query_depth' },
    { title: '最大复杂度', dataIndex: 'max_complexity', key: 'max_complexity' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />}>编辑</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card title="当前租户设置" style={{ marginBottom: 24 }}>
        <Form layout="vertical" initialValues={currentTenant || {}}>
          <Form.Item label="当前租户">
            <Select
              value={tenantId}
              onChange={handleTenantChange}
              style={{ width: 200 }}
            >
              {tenants.length > 0 ? (
                tenants.map(t => (
                  <Select.Option key={t.id} value={t.name}>{t.display_name}</Select.Option>
                ))
              ) : (
                <Select.Option value="default">Default</Select.Option>
              )}
            </Select>
          </Form.Item>
          <Form.Item label="最大查询深度">
            <InputNumber min={1} max={100} defaultValue={currentTenant?.max_query_depth || 15} disabled />
          </Form.Item>
          <Form.Item label="最大查询复杂度">
            <InputNumber min={1} max={10000} defaultValue={currentTenant?.max_complexity || 1000} disabled />
          </Form.Item>
          <Form.Item label="Schema 大小限制 (KB)">
            <InputNumber min={1} max={10000} defaultValue={currentTenant?.max_schema_size_kb || 500} disabled />
          </Form.Item>
        </Form>
      </Card>

      {user?.role === 'super_admin' && (
        <Card 
          title="租户管理" 
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setTenantModalVisible(true)}>
              新建租户
            </Button>
          }
          style={{ marginBottom: 24 }}
        >
          <Table
            columns={tenantColumns}
            dataSource={tenants}
            rowKey="id"
            pagination={false}
          />
        </Card>
      )}

      <Card title="账户信息">
        <Form layout="vertical">
          <Form.Item label="用户名">
            <Input value={user?.name} disabled />
          </Form.Item>
          <Form.Item label="邮箱">
            <Input value={user?.email} disabled />
          </Form.Item>
          <Form.Item label="角色">
            <Input 
              value={user?.role === 'super_admin' ? '超级管理员' : user?.role === 'admin' ? '管理员' : '查看者'} 
              disabled 
            />
          </Form.Item>
          <Form.Item>
            <Button danger onClick={logout}>退出登录</Button>
          </Form.Item>
        </Form>
      </Card>

      <Modal
        title="新建租户"
        open={tenantModalVisible}
        onCancel={() => setTenantModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateTenant}>
          <Form.Item name="name" label="租户标识" rules={[{ required: true }]}>
            <Input placeholder="英文标识，如 my-tenant" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="显示名称" />
          </Form.Item>
          <Form.Item name="maxQueryDepth" label="最大查询深度">
            <InputNumber min={1} max={100} defaultValue={15} />
          </Form.Item>
          <Form.Item name="maxComplexity" label="最大复杂度">
            <InputNumber min={1} max={10000} defaultValue={1000} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              创建
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Settings;
