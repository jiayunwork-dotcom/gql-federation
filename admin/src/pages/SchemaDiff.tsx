import React, { useState, useEffect } from 'react';
import { Card, Select, Tag, Space, Collapse, List, Spin, message, Empty } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
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
    try {
      const response = await api.get(`/schema-diff/versions/${subgraphId}`);
      setVersions(response.data.versions || []);
    } catch (err) {
      message.error('加载版本列表失败');
    }
  };

  const loadDiff = async () => {
    if (!leftVersionId || !rightVersionId) return;
    setLoading(true);
    try {
      const response = await api.get('/schema-diff/compare', {
        params: { leftVersionId, rightVersionId },
      });
      setDiff(response.data.diff);
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载 Diff 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (leftVersionId && rightVersionId && leftVersionId !== rightVersionId) {
      loadDiff();
    }
  }, [leftVersionId, rightVersionId]);

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

  const getLineBgColor = (type: string) => {
    switch (type) {
      case 'added': return '#e6ffed';
      case 'removed': return '#ffebe9';
      case 'modified': return '#fff8c5';
      default: return 'transparent';
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
    if (!line.typeName || line.type === 'unchanged') return true;
    return !isTypeCollapsed(line.typeName);
  };

  const renderDiffPanel = (lines: DiffLine[], side: 'left' | 'right') => {
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
        background: '#fff',
      }}>
        {visibleLines.map((line, idx) => (
          <div
            key={`${side}-${line.lineNumber}-${idx}`}
            style={{
              display: 'flex',
              backgroundColor: getLineBgColor(line.type),
              color: getLineTextColor(line.type),
              minHeight: 20,
            }}
          >
            <span style={{
              width: 40,
              textAlign: 'right',
              paddingRight: 8,
              color: '#959da5',
              userSelect: 'none',
              borderRight: '1px solid #d0d7de',
              flexShrink: 0,
            }}>
              {line.lineNumber}
            </span>
            <span style={{
              width: 20,
              textAlign: 'center',
              color: getLineTextColor(line.type),
              userSelect: 'none',
              flexShrink: 0,
              fontWeight: 'bold',
            }}>
              {getLinePrefix(line.type)}
            </span>
            <span style={{ paddingLeft: 4, whiteSpace: 'pre' }}>
              {line.content}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <Card title="Schema 版本 Diff 对比" style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%' }} size={16} wrap>
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>SubGraph</div>
            <Select
              style={{ width: 200 }}
              placeholder="选择 SubGraph"
              loading={subgraphsLoading}
              onChange={loadVersions}
              options={subgraphs.map(s => ({ label: s.name, value: s.id }))}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>基础版本 (左)</div>
            <Select
              style={{ width: 260 }}
              placeholder="选择基础版本"
              value={leftVersionId}
              onChange={setLeftVersionId}
              options={versions.map(v => ({
                label: `v${v.version} - ${dayjs(v.publishedAt).format('YYYY-MM-DD HH:mm')}${v.publishedBy ? ` (${v.publishedBy})` : ''}`,
                value: v.id,
              }))}
            />
          </div>
          <SwapOutlined style={{ color: '#999', marginTop: 20 }} />
          <div>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>对比版本 (右)</div>
            <Select
              style={{ width: 260 }}
              placeholder="选择对比版本"
              value={rightVersionId}
              onChange={setRightVersionId}
              options={versions.map(v => ({
                label: `v${v.version} - ${dayjs(v.publishedAt).format('YYYY-MM-DD HH:mm')}${v.publishedBy ? ` (${v.publishedBy})` : ''}`,
                value: v.id,
              }))}
            />
          </div>
        </Space>
      </Card>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      )}

      {!loading && diff && (
        <>
          <Card title="变更摘要" size="small" style={{ marginBottom: 16 }}>
            <Space wrap>
              {diff.structuredSummary.addedTypes.length > 0 && (
                <Tag color="green">新增类型: {diff.structuredSummary.addedTypes.join(', ')}</Tag>
              )}
              {diff.structuredSummary.removedTypes.length > 0 && (
                <Tag color="red">删除类型: {diff.structuredSummary.removedTypes.join(', ')}</Tag>
              )}
              {diff.structuredSummary.addedFields.length > 0 && (
                <Tag color="green">新增字段: {diff.structuredSummary.addedFields.join(', ')}</Tag>
              )}
              {diff.structuredSummary.removedFields.length > 0 && (
                <Tag color="red">删除字段: {diff.structuredSummary.removedFields.join(', ')}</Tag>
              )}
              {diff.structuredSummary.typeChanges.length > 0 && (
                <Tag color="orange">类型变更: {diff.structuredSummary.typeChanges.map(tc => `${tc.path}: ${tc.fromType} → ${tc.toType}`).join(', ')}</Tag>
              )}
            </Space>
            {diff.structuredSummary.typeChanges.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ fontSize: 13 }}>类型变更详情</h4>
                <List
                  size="small"
                  dataSource={diff.structuredSummary.typeChanges}
                  renderItem={tc => (
                    <List.Item>
                      <Tag color="orange">{tc.path}</Tag>
                      <span style={{ textDecoration: 'line-through', color: '#cb2431', marginRight: 8 }}>{tc.fromType}</span>
                      <span style={{ color: '#22863a' }}>{tc.toType}</span>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Card>

          {diff.typeSections.length > 0 && (
            <Card title="按类型折叠/展开" size="small" style={{ marginBottom: 16 }}>
              <Space wrap>
                {diff.typeSections.map(section => (
                  <Tag
                    key={section.typeName}
                    color={isTypeCollapsed(section.typeName) ? 'default' : 'blue'}
                    style={{ cursor: 'pointer' }}
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
              <div style={{ flex: 1 }}>
                <div style={{ textAlign: 'center', marginBottom: 4, fontWeight: 'bold', color: '#666' }}>基础版本</div>
                {renderDiffPanel(diff.leftLines, 'left')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ textAlign: 'center', marginBottom: 4, fontWeight: 'bold', color: '#666' }}>对比版本</div>
                {renderDiffPanel(diff.rightLines, 'right')}
              </div>
            </div>
          </Card>
        </>
      )}

      {!loading && !diff && leftVersionId && rightVersionId && leftVersionId === rightVersionId && (
        <Card><Empty description="请选择两个不同的版本进行对比" /></Card>
      )}

      {!loading && !diff && (!leftVersionId || !rightVersionId) && selectedSubgraph && versions.length > 0 && (
        <Card><Empty description="请选择基础版本和对比版本" /></Card>
      )}

      {!loading && selectedSubgraph && versions.length === 0 && (
        <Card><Empty description="该 SubGraph 暂无版本历史" /></Card>
      )}
    </div>
  );
}

export default SchemaDiff;
