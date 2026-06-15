import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Space, Modal, Form, Input, Descriptions, List, message, Drawer, Badge } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined, EditOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import api from '../api';
import dayjs from 'dayjs';
import { useAuth } from '../store/auth';

interface DiffSummary {
  addedFields: number;
  removedFields: number;
  modifiedTypes: number;
  addedTypes: number;
  removedTypes: number;
  details?: {
    addedFields: string[];
    removedFields: string[];
    modifiedTypes: string[];
    addedTypes: string[];
    removedTypes: string[];
  };
}

interface SchemaChangeApproval {
  id: string;
  subgraph_id: string;
  subgraph_name: string;
  schema_version_id: string;
  submitted_by: string;
  changelog?: string;
  diff_summary: DiffSummary;
  status: 'pending_approval' | 'approved' | 'rejected' | 'validation_failed' | 'resubmitted';
  reviewed_by?: string;
  review_comment?: string;
  reviewed_at?: string;
  composition_result?: any;
  created_at: string;
  updated_at: string;
}

function Approvals() {
  const [approvals, setApprovals] = useState<SchemaChangeApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApproval, setSelectedApproval] = useState<SchemaChangeApproval | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [resubmitModalVisible, setResubmitModalVisible] = useState(false);
  const [rejectForm] = Form.useForm();
  const [resubmitForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    loadApprovals();
  }, []);

  const loadApprovals = async () => {
    setLoading(true);
    try {
      const response = await api.get('/approvals');
      setApprovals(response.data.approvals || []);
    } catch (err) {
      message.error('加载审批列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (approvalId: string) => {
    try {
      await api.post(`/approvals/${approvalId}/approve`);
      message.success('审批已通过, Schema 已发布');
      loadApprovals();
      setDetailVisible(false);
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || '审批失败';
      const compositionErrors = err.response?.data?.compositionErrors;
      if (compositionErrors) {
        message.error(`${errorMsg}: ${compositionErrors.map((e: any) => e.message).join(', ')}`);
      } else {
        message.error(errorMsg);
      }
      loadApprovals();
    }
  };

  const handleReject = async (values: { reason: string }) => {
    if (!selectedApproval) return;
    setSubmitting(true);
    try {
      await api.post(`/approvals/${selectedApproval.id}/reject`, { reason: values.reason });
      message.success('已拒绝变更');
      setRejectModalVisible(false);
      rejectForm.resetFields();
      loadApprovals();
      setDetailVisible(false);
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResubmit = async (values: { sdl: string; changelog?: string }) => {
    if (!selectedApproval) return;
    setSubmitting(true);
    try {
      await api.post(`/approvals/${selectedApproval.id}/resubmit`, {
        sdl: values.sdl,
        changelog: values.changelog,
      });
      message.success('已重新提交审批');
      setResubmitModalVisible(false);
      resubmitForm.resetFields();
      loadApprovals();
      setDetailVisible(false);
    } catch (err: any) {
      message.error(err.response?.data?.error || '重新提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'pending_approval': return <Tag color="blue">待审批</Tag>;
      case 'approved': return <Tag color="green">已批准</Tag>;
      case 'rejected': return <Tag color="red">已拒绝</Tag>;
      case 'validation_failed': return <Tag color="orange">验证失败</Tag>;
      case 'resubmitted': return <Tag color="cyan">重新提交</Tag>;
      default: return <Tag>{status}</Tag>;
    }
  };

  const pendingCount = approvals.filter(a => a.status === 'pending_approval' || a.status === 'resubmitted').length;

  const columns = [
    {
      title: 'SubGraph',
      dataIndex: 'subgraph_name',
      key: 'subgraph_name',
    },
    {
      title: '提交人',
      dataIndex: 'submitted_by',
      key: 'submitted_by',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => getStatusTag(status),
    },
    {
      title: '变更摘要',
      key: 'diff_summary',
      render: (_: any, record: SchemaChangeApproval) => {
        const ds = record.diff_summary;
        return (
          <Space size={4}>
            {ds.addedFields > 0 && <Tag color="green">+{ds.addedFields} 字段</Tag>}
            {ds.removedFields > 0 && <Tag color="red">-{ds.removedFields} 字段</Tag>}
            {ds.modifiedTypes > 0 && <Tag color="orange">~{ds.modifiedTypes} 类型变更</Tag>}
            {ds.addedTypes > 0 && <Tag color="green">+{ds.addedTypes} 类型</Tag>}
            {ds.removedTypes > 0 && <Tag color="red">-{ds.removedTypes} 类型</Tag>}
          </Space>
        );
      },
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: SchemaChangeApproval) => {
        const isPending = record.status === 'pending_approval' || record.status === 'resubmitted';
        const canResubmit = (record.status === 'rejected' || record.status === 'validation_failed') && record.submitted_by === user?.email;

        return (
          <Space>
            <Button type="link" onClick={() => { setSelectedApproval(record); setDetailVisible(true); }}>
              详情
            </Button>
            {isAdmin && isPending && (
              <>
                <Button type="link" style={{ color: '#52c41a' }} icon={<CheckOutlined />} onClick={() => handleApprove(record.id)}>
                  批准
                </Button>
                <Button type="link" danger icon={<CloseOutlined />} onClick={() => { setSelectedApproval(record); setRejectModalVisible(true); }}>
                  拒绝
                </Button>
              </>
            )}
            {canResubmit && (
              <Button type="link" icon={<EditOutlined />} onClick={() => { setSelectedApproval(record); setResubmitModalVisible(true); }}>
                重新提交
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>
          Schema 变更审批
          {pendingCount > 0 && <Badge count={pendingCount} style={{ marginLeft: 8 }} />}
        </h2>
        <Button icon={<ReloadOutlined />} onClick={loadApprovals}>刷新</Button>
      </div>

      <Table
        columns={columns}
        dataSource={approvals}
        rowKey="id"
        loading={loading}
      />

      <Drawer
        title="审批详情"
        width={640}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
      >
        {selectedApproval && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="SubGraph">{selectedApproval.subgraph_name}</Descriptions.Item>
              <Descriptions.Item label="提交人">{selectedApproval.submitted_by}</Descriptions.Item>
              <Descriptions.Item label="状态">{getStatusTag(selectedApproval.status)}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{dayjs(selectedApproval.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              {selectedApproval.reviewed_by && (
                <Descriptions.Item label="审批人">{selectedApproval.reviewed_by}</Descriptions.Item>
              )}
              {selectedApproval.reviewed_at && (
                <Descriptions.Item label="审批时间">{dayjs(selectedApproval.reviewed_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              )}
            </Descriptions>

            {selectedApproval.changelog && (
              <Card size="small" title="变更说明" type="inner" style={{ marginTop: 16 }}>
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{selectedApproval.changelog}</pre>
              </Card>
            )}

            <Card size="small" title="差异摘要" type="inner" style={{ marginTop: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {selectedApproval.diff_summary.addedTypes > 0 && (
                  <div><Tag color="green">新增类型</Tag> {selectedApproval.diff_summary.details?.addedTypes?.join(', ')}</div>
                )}
                {selectedApproval.diff_summary.removedTypes > 0 && (
                  <div><Tag color="red">删除类型</Tag> {selectedApproval.diff_summary.details?.removedTypes?.join(', ')}</div>
                )}
                {selectedApproval.diff_summary.addedFields > 0 && (
                  <div><Tag color="green">新增字段</Tag> {selectedApproval.diff_summary.details?.addedFields?.join(', ')}</div>
                )}
                {selectedApproval.diff_summary.removedFields > 0 && (
                  <div><Tag color="red">删除字段</Tag> {selectedApproval.diff_summary.details?.removedFields?.join(', ')}</div>
                )}
                {selectedApproval.diff_summary.modifiedTypes > 0 && (
                  <div><Tag color="orange">类型变更</Tag> {selectedApproval.diff_summary.details?.modifiedTypes?.join(', ')}</div>
                )}
              </Space>
            </Card>

            {selectedApproval.review_comment && (
              <Card size="small" title="审批意见" type="inner" style={{ marginTop: 16 }}>
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{selectedApproval.review_comment}</pre>
              </Card>
            )}

            {selectedApproval.composition_result && !selectedApproval.composition_result.success && (
              <Card size="small" title="组合验证错误" type="inner" style={{ marginTop: 16 }}>
                <List
                  size="small"
                  dataSource={selectedApproval.composition_result.errors || []}
                  renderItem={(item: any) => (
                    <List.Item>
                      <Tag color="red">{item.subgraph}</Tag> {item.message}
                    </List.Item>
                  )}
                />
              </Card>
            )}
          </>
        )}
      </Drawer>

      <Modal
        title="拒绝变更"
        open={rejectModalVisible}
        onCancel={() => setRejectModalVisible(false)}
        footer={null}
      >
        <Form form={rejectForm} layout="vertical" onFinish={handleReject}>
          <Form.Item name="reason" label="拒绝原因" rules={[{ required: true, message: '请填写拒绝原因' }]}>
            <Input.TextArea rows={4} placeholder="请说明拒绝原因..." />
          </Form.Item>
          <Form.Item>
            <Button type="primary" danger htmlType="submit" loading={submitting}>
              确认拒绝
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重新提交 Schema 变更"
        open={resubmitModalVisible}
        onCancel={() => setResubmitModalVisible(false)}
        footer={null}
        width={800}
      >
        <Form form={resubmitForm} layout="vertical" onFinish={handleResubmit}>
          <Form.Item name="changelog" label="变更说明">
            <Input.TextArea rows={3} placeholder="描述本次修改内容..." />
          </Form.Item>
          <Form.Item name="sdl" label="新 Schema SDL" rules={[{ required: true }]}>
            <div style={{ height: 400 }}>
              <Editor
                height={400}
                defaultLanguage="graphql"
                theme="vs-light"
              />
            </div>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting}>
              重新提交
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default Approvals;
