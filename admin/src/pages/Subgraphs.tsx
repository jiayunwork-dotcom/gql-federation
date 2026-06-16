import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Modal, Form, Input, Tag, message, Drawer, Descriptions, Timeline } from 'antd';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import api from '../api';
import dayjs from 'dayjs';

interface Subgraph {
  id: string;
  name: string;
  routing_url: string;
  owner_team: string;
  description?: string;
  is_active: boolean;
  current_version_id?: string;
  created_at: string;
}

interface SchemaVersion {
  id: string;
  version: number;
  sdl: string;
  schema_size_bytes: number;
  is_active: boolean;
  published_by?: string;
  published_at: string;
  change_summary: any;
}

function Subgraphs() {
  const [subgraphs, setSubgraphs] = useState<Subgraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [schemaModalVisible, setSchemaModalVisible] = useState(false);
  const [selectedSubgraph, setSelectedSubgraph] = useState<Subgraph | null>(null);
  const [versions, setVersions] = useState<SchemaVersion[]>([]);
  const [form] = Form.useForm();
  const [schemaForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSubgraphs();
  }, []);

  const loadSubgraphs = async () => {
    try {
      const response = await api.get('/subgraphs');
      setSubgraphs(response.data.subgraphs || []);
    } catch (err) {
      message.error('加载 SubGraph 列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadVersions = async (subgraphId: string) => {
    try {
      const response = await api.get(`/subgraphs/${subgraphId}/versions?limit=50`);
      setVersions(response.data.versions || []);
    } catch (err) {
      message.error('加载版本历史失败');
    }
  };

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      await api.post('/subgraphs', values);
      message.success('SubGraph 创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      loadSubgraphs();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewDetail = (subgraph: Subgraph) => {
    setSelectedSubgraph(subgraph);
    loadVersions(subgraph.id);
    setDetailVisible(true);
  };

  const handleRollback = async (versionId: string) => {
    if (!selectedSubgraph) return;
    try {
      await api.post(`/subgraphs/${selectedSubgraph.id}/versions/${versionId}/rollback`);
      message.success('回滚成功');
      loadVersions(selectedSubgraph.id);
      loadSubgraphs();
    } catch (err: any) {
      message.error(err.response?.data?.error || '回滚失败');
    }
  };

  const handleSubmitSchema = async (values: any) => {
    if (!selectedSubgraph) return;
    setSubmitting(true);
    try {
      await api.post(`/subgraphs/${selectedSubgraph.id}/schema`, {
        sdl: values.sdl,
        changelog: values.changelog,
      });
      message.success('Schema 变更已提交审批');
      setSchemaModalVisible(false);
      schemaForm.resetFields();
      loadVersions(selectedSubgraph.id);
    } catch (err: any) {
      message.error(err.response?.data?.error || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const openSchemaModal = (subgraph: Subgraph) => {
    setSelectedSubgraph(subgraph);
    schemaForm.resetFields();
    setSchemaModalVisible(true);
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '路由 URL',
      dataIndex: 'routing_url',
      key: 'routing_url',
      ellipsis: true,
    },
    {
      title: 'Owner 团队',
      dataIndex: 'owner_team',
      key: 'owner_team',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        active ? <Tag color="green">活跃</Tag> : <Tag color="red">禁用</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: Subgraph) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          <Button type="link" icon={<EditOutlined />} onClick={() => openSchemaModal(record)}>
            提交 Schema
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => {}}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>SubGraph 管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
          注册 SubGraph
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={subgraphs}
        rowKey="id"
        loading={loading}
      />

      <Modal
        title="注册 SubGraph"
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        footer={null}
        width={800}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="SubGraph 名称" />
          </Form.Item>
          <Form.Item name="routingUrl" label="路由 URL" rules={[{ required: true }]}>
            <Input placeholder="http://subgraph.example.com/graphql" />
          </Form.Item>
          <Form.Item name="ownerTeam" label="Owner 团队" rules={[{ required: true }]}>
            <Input placeholder="团队名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="SubGraph 描述" />
          </Form.Item>
          <Form.Item name="sdl" label="Schema SDL" rules={[{ required: true }]}>
            <div className="monaco-container" style={{ height: 300 }}>
              <Editor
                height={300}
                defaultLanguage="graphql"
                defaultValue={`type Query {\n  hello: String\n}`}
                onChange={(value) => form.setFieldValue('sdl', value)}
                theme="vs-light"
              />
            </div>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting}>
              注册
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="SubGraph 详情"
        width={720}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
      >
        {selectedSubgraph && (
          <>
            <Descriptions title="基本信息" column={1} style={{ marginBottom: 24 }}>
              <Descriptions.Item label="名称">{selectedSubgraph.name}</Descriptions.Item>
              <Descriptions.Item label="路由 URL">{selectedSubgraph.routing_url}</Descriptions.Item>
              <Descriptions.Item label="Owner 团队">{selectedSubgraph.owner_team}</Descriptions.Item>
              <Descriptions.Item label="描述">{selectedSubgraph.description || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {selectedSubgraph.is_active ? <Tag color="green">活跃</Tag> : <Tag color="red">禁用</Tag>}
              </Descriptions.Item>
            </Descriptions>

            <h3>版本历史</h3>
            <Timeline
              items={versions.map((v) => ({
                color: v.is_active ? 'green' : 'gray',
                children: (
                  <div>
                    <div style={{ fontWeight: 'bold' }}>
                      版本 v{v.version}
                      {v.is_active && <Tag color="green" style={{ marginLeft: 8 }}>当前版本</Tag>}
                    </div>
                    <div style={{ color: '#999', fontSize: 12, margin: '4px 0' }}>
                      {v.published_by ? `由 ${v.published_by} 发布` : ''} · {dayjs(v.published_at).format('YYYY-MM-DD HH:mm:ss')}
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      Schema 大小: {(v.schema_size_bytes / 1024).toFixed(2)} KB
                    </div>
                    {!v.is_active && (
                      <Button 
                        size="small" 
                        type="link" 
                        icon={<RollbackOutlined />}
                        onClick={() => handleRollback(v.id)}
                      >
                        回滚到此版本
                      </Button>
                    )}
                  </div>
                ),
              }))}
            />
          </>
        )}
      </Drawer>

      <Modal
        title={`提交 Schema 变更 - ${selectedSubgraph?.name || ''}`}
        open={schemaModalVisible}
        onCancel={() => setSchemaModalVisible(false)}
        footer={null}
        width={800}
      >
        <Form form={schemaForm} layout="vertical" onFinish={handleSubmitSchema}>
          <Form.Item 
            name="changelog" 
            label="变更说明"
            rules={[
              { required: true, message: '请填写变更说明' },
              { min: 2, message: '变更说明至少需要2个字符' },
              { validator: (_, value) => {
                if (value && typeof value === 'string' && value.trim().length < 2) {
                  return Promise.reject(new Error('变更说明不能为空白字符'));
                }
                return Promise.resolve();
              }}
            ]}
          >
            <Input.TextArea rows={3} placeholder="描述本次 Schema 变更内容..." />
          </Form.Item>
          <Form.Item name="sdl" label="新 Schema SDL" rules={[{ required: true }]}>
            <div className="monaco-container" style={{ height: 400 }}>
              <Editor
                height={400}
                defaultLanguage="graphql"
                defaultValue={`type Query {\n  hello: String\n}`}
                onChange={(value) => schemaForm.setFieldValue('sdl', value)}
                theme="vs-light"
              />
            </div>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting}>
              提交审批
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Subgraphs;
