import React, { useState, useEffect } from 'react';
import { Card, Select, Tag, Space, Button, List, Spin, message, Empty, Alert, Tabs } from 'antd';
import { SwapOutlined, DiffOutlined } from '@ant-design/icons';
import api from '../api';
import dayjs from 'dayjs';

interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  typeName?: string;
}

interface DiffResult {
  leftLines: DiffLine[];
  rightLines: DiffLine[];
  structuredSummary: {
    addedTypes: string[];
    removedTypes: string[];
    addedFields: string[];
    removedFields: string[];
    typeChanges: Array<{ path: string; fromType: string; toType: string }>;
  };
  typeSections: Array<{
    typeName: string;
    leftRange: { start: number; end: number };
    rightRange: { start: number; end: number };
  }>;
}

interface VersionOption {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy?: string;
}

function SchemaDiff() {
  const [subgraphs, setSubgraphs] = useState<any[]>([]);
  const [selectedSubgraph, setSelectedSubgraph] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [leftVersionId, setLeftVersionId] = useState<string | null>(null);
  const [rightVersionId, setRightVersionId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [subgraphsLoading, setSubgraphsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setSubgraphsLoading(false);
    }
  };

  const loadVersions = async (subgraphId: string) => {
    setSelectedSubgraph(subgraphId);
    setLeftVersionId(null);
    setRightVersionId(null);
    setDiff(null);
    setError(null);
    try {
      const response = await api.get(`/schema-diff/versions/${subgraphId}`);
      setVersions(response.data.versions || []);
    } catch (err) {
      message.error('加载版本列表失败');
    }
  };

  const handleCompare = async () => {
    if (!leftVersionId || !rightVersionId) {
      message.warning('请选择两个版本进行对比');
      return;
    }

    if (leftVersionId === rightVersionId) {
      message.warning('请选择两个不同的版本');
      return;
    }

    setLoading(true);
    setError(null);
    setDiff(null);

    try {
      const response = await api.get('/schema-diff/compare', {
        params: { leftVersionId, rightVersionId },
      });
      const diffData = response.data.diff;
      
      if (!diffData || !diffData.leftLines || !diffData.rightLines) {
        setError('Diff 数据格式不正确');
        return;
      }
      
      setDiff(diffData);
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || '加载 Diff 失败';
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const toggleCollapse = (typeName: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev);
      if (next.has(typeName)) {
        next.delete(typeName);
      } else {
        next.add(typeName);
      }
      return next;
    });
  };

  const toggleAllCollapse = (collapse: boolean) => {
    if (diff) {
      if (collapse) {
        setCollapsedTypes(new Set(diff.typeSections.map(s => s.typeName)));
      } else {
        setCollapsedTypes(new Set());
      }
    }
  };

  const getLineBgColor = (type: string) => {
    switch (type) {
      case 'added': return '#e6ffed';
      case 'removed': return '#ffebe9';
      case 'modified': return '#fff8c5';
      default: return '#ffffff';
    }
  };

  const getLineTextColor = (type: string) => {
    switch (type) {
      case 'added': return '#22863a';
      case 'removed': return '#cb2431';
      case 'modified': return '#7c6f08';
      default: return '#24292e';
    }
  };

  const getLinePrefix = (type: string) => {
    switch (type) {
      case 'added': return '+';
      case 'removed': return '-';
      case 'modified': return '~';
      default: return ' ';
    }
  };

  const isTypeCollapsed = (typeName: string) => collapsedTypes.has(typeName);

  const shouldShowLine = (line: DiffLine) => {
    if (!line.typeName) return true;
    if (line.type === 'unchanged') return !isTypeCollapsed(line.typeName);
    return !isTypeCollapsed(line.typeName);
  };

  const renderDiffPanel = (lines: DiffLine[], side: 'left' | 'right') => {
    if (!lines || lines.length === 0) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
          无内容
        </div>
      );
    }

    const visibleLines = lines.filter(shouldShowLine);

    return (
      <div style={{
        flex: 1,
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
        fontSize: 12,
        lineHeight: '20px',
        border: '1px solid #d0d7de',
        borderRadius: 6,
        overflow: 'auto',
        maxHeight: 600,
        background: '#ffffff',
      }}>
        {visibleLines.map((line, idx) => (
          <div
            key={`${side}-${line.lineNumber}-${idx}`}
            style={{
              display: 'flex',
              backgroundColor: getLineBgColor(line.type),
              color: getLineTextColor(line.type),
              minHeight: 20,
              height: 20,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              display: 'inline-block',
              width: 50,
              textAlign: 'right',
              paddingRight: 8,
              color: '#959da5',
              userSelect: 'none',
              borderRight: '1px solid #d0d7de',
              flexShrink: 0,
              backgroundColor: '#f6f8fa',
            }}>
              {line.lineNumber}
            </span>
            <span style={{
              display: 'inline-block',
              width: 20,
              textAlign: 'center',
              color: getLineTextColor(line.type),
              userSelect: 'none',
              flexShrink: 0,
              fontWeight: 'bold',
            }}>
              {getLinePrefix(line.type)}
            </span>
            <span style={{ 
              paddingLeft: 8, 
              paddingRight: 8,
              display: 'inline-block',
              color: getLineTextColor(line.type),
              visibility: line.content ? 'visible' : 'visible',
            }}>
              {line.content || ' '}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const canCompare = leftVersionId && rightVersionId && leftVersionId !== rightVersionId;

  return (
    <div>
      <Card title="Schema 版本 Diff 对比" style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%' }} size={16} wrap align="end">
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>SubGraph</div>
            <Select
              style={{ width: 220 }}
              placeholder="选择 SubGraph"
              loading={subgraphsLoading}
              value={selectedSubgraph}
              onChange={loadVersions}
              options={subgraphs.map(s => ({ label: s.name, value: s.id }))}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>基础版本 (旧)</div>
            <Select
              style={{ width: 280 }}
              placeholder="选择基础版本"
              value={leftVersionId}
              onChange={setLeftVersionId}
              disabled={!selectedSubgraph}
              options={versions.map(v => ({
                label: `v${v.version} - ${dayjs(v.publishedAt).format('YYYY-MM-DD HH:mm')}${v.publishedBy ? ` (${v.publishedBy})` : ''}`,
                value: v.id,
              }))}
            />
          </div>
          <SwapOutlined style={{ color: '#999' }} />
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>对比版本 (新)</div>
            <Select
              style={{ width: 280 }}
              placeholder="选择对比版本"
              value={rightVersionId}
              onChange={setRightVersionId}
              disabled={!selectedSubgraph}
              options={versions.map(v => ({
                label: `v${v.version} - ${dayjs(v.publishedAt).format('YYYY-MM-DD HH:mm')}${v.publishedBy ? ` (${v.publishedBy})` : ''}`,
                value: v.id,
              }))}
            />
          </div>
          <Button
            type="primary"
            icon={<DiffOutlined />}
            onClick={handleCompare}
            disabled={!canCompare}
            loading={loading}
          >
            开始对比
          </Button>
        </Space>
      </Card>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" tip="正在计算 Diff..." /></div>
      )}

      {error && !loading && (
        <Alert message="对比失败" description={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {!loading && diff && !error && (
        <>
          <Card title="变更摘要" size="small" style={{ marginBottom: 16 }}>
            <Space wrap style={{ marginBottom: 12 }}>
              {diff.structuredSummary.addedTypes.length > 0 && (
                <Tag color="green">新增类型: {diff.structuredSummary.addedTypes.length} 个</Tag>
              )}
              {diff.structuredSummary.removedTypes.length > 0 && (
                <Tag color="red">删除类型: {diff.structuredSummary.removedTypes.length} 个</Tag>
              )}
              {diff.structuredSummary.addedFields.length > 0 && (
                <Tag color="green">新增字段: {diff.structuredSummary.addedFields.length} 个</Tag>
              )}
              {diff.structuredSummary.removedFields.length > 0 && (
                <Tag color="red">删除字段: {diff.structuredSummary.removedFields.length} 个</Tag>
              )}
              {diff.structuredSummary.typeChanges.length > 0 && (
                <Tag color="orange">类型变更: {diff.structuredSummary.typeChanges.length} 处</Tag>
              )}
              {diff.structuredSummary.addedTypes.length === 0 &&
                diff.structuredSummary.removedTypes.length === 0 &&
                diff.structuredSummary.addedFields.length === 0 &&
                diff.structuredSummary.removedFields.length === 0 &&
                diff.structuredSummary.typeChanges.length === 0 && (
                <Tag>无实质性变更</Tag>
              )}
            </Space>

            {diff.structuredSummary.addedTypes.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>新增类型：</strong>
                {diff.structuredSummary.addedTypes.map(t => (
                  <Tag key={t} color="green">{t}</Tag>
                ))}
              </div>
            )}
            {diff.structuredSummary.removedTypes.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>删除类型：</strong>
                {diff.structuredSummary.removedTypes.map(t => (
                  <Tag key={t} color="red">{t}</Tag>
                ))}
              </div>
            )}
            {diff.structuredSummary.addedFields.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>新增字段：</strong>
                {diff.structuredSummary.addedFields.map(f => (
                  <Tag key={f} color="green">{f}</Tag>
                ))}
              </div>
            )}
            {diff.structuredSummary.removedFields.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>删除字段：</strong>
                {diff.structuredSummary.removedFields.map(f => (
                  <Tag key={f} color="red">{f}</Tag>
                ))}
              </div>
            )}

            {diff.structuredSummary.typeChanges.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ fontSize: 13, marginBottom: 8 }}>类型变更详情</h4>
                <List
                  size="small"
                  bordered
                  dataSource={diff.structuredSummary.typeChanges}
                  renderItem={(tc: any) => (
                    <List.Item>
                      <span style={{ fontWeight: 'bold', marginRight: 8 }}>{tc.path}</span>
                      <span style={{ color: '#cb2431', textDecoration: 'line-through' }}>{tc.fromType}</span>
                      <span style={{ margin: '0 8px' }}>→</span>
                      <span style={{ color: '#22863a', fontWeight: 'bold' }}>{tc.toType}</span>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Card>

          {diff.typeSections && diff.typeSections.length > 0 && (
            <Card
              title="按类型折叠"
              size="small"
              style={{ marginBottom: 16 }}
              extra={
                <Space>
                  <Button size="small" onClick={() => toggleAllCollapse(false)}>全部展开</Button>
                  <Button size="small" onClick={() => toggleAllCollapse(true)}>全部折叠</Button>
                </Space>
              }
            >
              <Space wrap>
                {diff.typeSections.map(section => (
                  <Tag
                    key={section.typeName}
                    color={isTypeCollapsed(section.typeName) ? 'default' : 'blue'}
                    style={{ cursor: 'pointer', padding: '4px 8px' }}
                    onClick={() => toggleCollapse(section.typeName)}
                  >
                    {isTypeCollapsed(section.typeName) ? '▶' : '▼'} {section.typeName}
                  </Tag>
                ))}
              </Space>
            </Card>
          )}

          <Card title="SDL 差异对比" size="small">
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ textAlign: 'center', marginBottom: 8, fontWeight: 'bold', color: '#666' }}>
                  基础版本
                </div>
                {renderDiffPanel(diff.leftLines, 'left')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ textAlign: 'center', marginBottom: 8, fontWeight: 'bold', color: '#666' }}>
                  对比版本
                </div>
                {renderDiffPanel(diff.rightLines, 'right')}
              </div>
            </div>
          </Card>
        </>
      )}

      {!loading && !diff && !error && selectedSubgraph && versions.length > 0 && (
        <Card>
          <Empty description="请选择两个版本，然后点击「开始对比」按钮" />
        </Card>
      )}

      {!loading && selectedSubgraph && versions.length === 0 && (
        <Card>
          <Empty description="该 SubGraph 暂无版本历史" />
        </Card>
      )}

      {!loading && !selectedSubgraph && (
        <Card>
          <Empty description="请先选择一个 SubGraph" />
        </Card>
      )}
    </div>
  );
}

export default SchemaDiff;
