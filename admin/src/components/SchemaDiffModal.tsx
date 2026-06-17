import React, { useMemo, useEffect, useState } from 'react';
import { Modal, Button, Space, Input, Tag, Checkbox, List, Alert, Spin } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CloseOutlined, WarningOutlined, DiffOutlined } from '@ant-design/icons';
import { SchemaDiffPreview, CompatibilityCheckItem } from '../types/collaboration';
import { getDiffPreview } from '../api/collaboration';

const { TextArea } = Input;

interface SchemaDiffModalProps {
  open: boolean;
  subgraphId: string | null;
  originalSdl: string;
  newSdl: string;
  onCancel: () => void;
  onBackToEdit: () => void;
  onConfirm: (changelog: string) => void;
  loading?: boolean;
}

const SchemaDiffModal: React.FC<SchemaDiffModalProps> = ({
  open,
  subgraphId,
  originalSdl,
  newSdl,
  onCancel,
  onBackToEdit,
  onConfirm,
  loading = false,
}) => {
  const [diffPreview, setDiffPreview] = useState<SchemaDiffPreview | null>(null);
  const [changelog, setChangelog] = useState('');
  const [confirmBreaking, setConfirmBreaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open && subgraphId) {
      setIsLoading(true);
      setChangelog('');
      setConfirmBreaking(false);
      getDiffPreview(subgraphId, newSdl)
        .then((data) => {
          setDiffPreview(data);
        })
        .catch((err) => {
          console.error('Load diff preview error:', err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, subgraphId, newSdl]);

  const hasBreakingChanges = diffPreview?.compatibility.hasBreakingChanges || false;
  const canSubmit = changelog.trim().length > 0 && (!hasBreakingChanges || confirmBreaking);

  const getLineBgColor = (type: string, side: 'left' | 'right') => {
    switch (type) {
      case 'removed':
        return side === 'left' ? '#fff1f0' : 'transparent';
      case 'added':
        return side === 'right' ? '#f6ffed' : 'transparent';
      case 'modified':
        return '#fff7e6';
      default:
        return 'transparent';
    }
  };

  const getLineBorderColor = (type: string, side: 'left' | 'right') => {
    switch (type) {
      case 'removed':
        return side === 'left' ? '#ffa39e' : 'transparent';
      case 'added':
        return side === 'right' ? '#b7eb8f' : 'transparent';
      case 'modified':
        return '#ffd591';
      default:
        return 'transparent';
    }
  };

  const getCompatibilityTagColor = (level: string) => {
    switch (level) {
      case 'COMPATIBLE':
        return 'green';
      case 'BREAKING':
        return 'red';
      case 'WARNING':
        return 'orange';
      default:
        return 'default';
    }
  };

  const maxLines = useMemo(() => {
    if (!diffPreview) return 0;
    return Math.max(diffPreview.leftLines.length, diffPreview.rightLines.length);
  }, [diffPreview]);

  const handleConfirm = () => {
    if (canSubmit) {
      onConfirm(changelog.trim());
    }
  };

  return (
    <Modal
      title={
        <Space>
          <DiffOutlined />
          <span>Schema变更对比预览</span>
          {diffPreview && (
            <Space size="small">
              <Tag color="green">+{diffPreview.stats.added} 新增</Tag>
              <Tag color="red">-{diffPreview.stats.removed} 删除</Tag>
              <Tag color="orange">~{diffPreview.stats.modified} 修改</Tag>
            </Space>
          )}
        </Space>
      }
      open={open}
      onCancel={onCancel}
      width="100vw"
      style={{ top: 0, padding: 0 }}
      bodyStyle={{
        height: 'calc(100vh - 180px)',
        padding: 0,
        overflow: 'hidden',
      }}
      footer={null}
      centered={false}
      maskClosable={false}
      destroyOnClose
    >
      <Spin spinning={isLoading} tip="正在生成变更对比...">
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              overflow: 'hidden',
              borderBottom: '1px solid #e8e8e8',
            }}
          >
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid #e8e8e8',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '8px 16px',
                  background: '#fafafa',
                  borderBottom: '1px solid #e8e8e8',
                  fontWeight: 'bold',
                  color: '#8c8c8c',
                  fontSize: 13,
                }}
              >
                <Space>
                  <CloseOutlined style={{ color: '#ff4d4f' }} />
                  当前线上活跃版本
                </Space>
              </div>
              <div style={{ flex: 1, overflow: 'auto', fontFamily: 'Monaco, Menlo, monospace', fontSize: 13 }}>
                {diffPreview && (
                  <div style={{ display: 'table', width: '100%' }}>
                    {diffPreview.leftLines.map((line, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'table-row',
                          backgroundColor: getLineBgColor(line.type, 'left'),
                        }}
                      >
                        <div
                          style={{
                            display: 'table-cell',
                            width: 50,
                            padding: '2px 8px',
                            textAlign: 'right',
                            color: '#8c8c8c',
                            userSelect: 'none',
                            borderLeft: `3px solid ${getLineBorderColor(line.type, 'left')}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {line.lineNumber}
                        </div>
                        <div
                          style={{
                            display: 'table-cell',
                            padding: '2px 8px 2px 12px',
                            whiteSpace: 'pre',
                            wordBreak: 'break-all',
                          }}
                        >
                          {line.content || '\u00A0'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '8px 16px',
                  background: '#fafafa',
                  borderBottom: '1px solid #e8e8e8',
                  fontWeight: 'bold',
                  color: '#8c8c8c',
                  fontSize: 13,
                }}
              >
                <Space>
                  <CheckOutlined style={{ color: '#52c41a' }} />
                  编辑后版本
                </Space>
              </div>
              <div style={{ flex: 1, overflow: 'auto', fontFamily: 'Monaco, Menlo, monospace', fontSize: 13 }}>
                {diffPreview && (
                  <div style={{ display: 'table', width: '100%' }}>
                    {diffPreview.rightLines.map((line, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'table-row',
                          backgroundColor: getLineBgColor(line.type, 'right'),
                        }}
                      >
                        <div
                          style={{
                            display: 'table-cell',
                            width: 50,
                            padding: '2px 8px',
                            textAlign: 'right',
                            color: '#8c8c8c',
                            userSelect: 'none',
                            borderLeft: `3px solid ${getLineBorderColor(line.type, 'right')}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {line.lineNumber}
                        </div>
                        <div
                          style={{
                            display: 'table-cell',
                            padding: '2px 8px 2px 12px',
                            whiteSpace: 'pre',
                            wordBreak: 'break-all',
                          }}
                        >
                          {line.content || '\u00A0'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {diffPreview && diffPreview.compatibility.items.length > 0 && (
            <div
              style={{
                maxHeight: 200,
                overflow: 'auto',
                padding: '12px 16px',
                borderBottom: '1px solid #e8e8e8',
                background: hasBreakingChanges ? '#fffbf0' : '#f6ffed',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                {hasBreakingChanges ? (
                  <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
                ) : (
                  <CheckOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                )}
                <strong>
                  兼容性检查
                  {hasBreakingChanges && (
                    <Tag color="red" style={{ marginLeft: 8 }}>
                      含破坏性变更
                    </Tag>
                  )}
                </strong>
                <Space size="small" style={{ marginLeft: 16 }}>
                  <Tag color="green">兼容: {diffPreview.compatibility.compatibleCount}</Tag>
                  <Tag color="red">破坏: {diffPreview.compatibility.breakingCount}</Tag>
                  {diffPreview.compatibility.warningCount > 0 && (
                    <Tag color="orange">警告: {diffPreview.compatibility.warningCount}</Tag>
                  )}
                </Space>
              </div>
              <List
                size="small"
                dataSource={diffPreview.compatibility.items}
                renderItem={(item: CompatibilityCheckItem) => (
                  <List.Item style={{ padding: '4px 0', border: 'none' }}>
                    <Space size="middle" style={{ width: '100%' }}>
                      <Tag color={getCompatibilityTagColor(item.level)}>{item.level}</Tag>
                      <span style={{ flex: 1 }}>{item.description}</span>
                      {item.path && (
                        <span style={{ color: '#8c8c8c', fontSize: 12, fontFamily: 'monospace' }}>
                          {item.path}
                        </span>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          )}

          <div style={{ padding: 16, background: '#fafafa' }}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 'bold' }}>变更说明 (changelog)</div>
                <TextArea
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  placeholder="请详细描述本次变更的内容和原因..."
                  rows={3}
                  maxLength={500}
                  showCount
                />
              </div>

              {hasBreakingChanges && (
                <Alert
                  type="warning"
                  showIcon
                  icon={<WarningOutlined />}
                  message={
                    <Checkbox checked={confirmBreaking} onChange={(e) => setConfirmBreaking(e.target.checked)}>
                      <span style={{ fontWeight: 'normal' }}>我确认已评估影响范围，允许提交破坏性变更</span>
                    </Checkbox>
                  }
                />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Button icon={<ArrowLeftOutlined />} onClick={onBackToEdit}>
                  返回编辑
                </Button>
                <Space>
                  <Button onClick={onCancel}>取消</Button>
                  <Button
                    type={hasBreakingChanges ? 'primary' : 'primary'}
                    danger={hasBreakingChanges}
                    style={hasBreakingChanges ? { backgroundColor: '#fa8c16', borderColor: '#fa8c16' } : {}}
                    onClick={handleConfirm}
                    disabled={!canSubmit || loading}
                    loading={loading}
                  >
                    {hasBreakingChanges ? '确认提交 (含破坏性变更)' : '确认提交'}
                  </Button>
                </Space>
              </div>
            </Space>
          </div>
        </div>
      </Spin>
    </Modal>
  );
};

export default SchemaDiffModal;
