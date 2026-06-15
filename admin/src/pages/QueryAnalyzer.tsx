import React, { useState } from 'react';
import { Card, Row, Col, Button, Space, message, Descriptions, Tag } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import api from '../api';

interface QueryPlan {
  steps: any[];
}

interface AnalysisResult {
  queryPlan: QueryPlan;
  analysis: { depth: number; complexity: number; fields: any[] };
  supergraphVersion: number;
  subgraphs: { name: string; url: string }[];
}

function QueryAnalyzer() {
  const [query, setQuery] = useState<string>(`query {
  __typename
}`);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const response = await api.post('/graphql/explain', { query }, {
        baseURL: 'http://localhost:4000',
        headers: {
          'X-Tenant-ID': localStorage.getItem('tenantId') || 'default',
        },
      });
      setResult(response.data);
      message.success('分析完成');
    } catch (err: any) {
      message.error(err.response?.data?.error || '分析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Row gutter={16}>
        <Col span={12}>
          <Card 
            title="GraphQL 查询"
            extra={
              <Button 
                type="primary" 
                icon={<PlayCircleOutlined />} 
                onClick={handleAnalyze}
                loading={loading}
              >
                分析查询计划
              </Button>
            }
          >
            <div className="monaco-container" style={{ height: 500 }}>
              <Editor
                height={500}
                language="graphql"
                value={query}
                onChange={(v) => setQuery(v || '')}
                theme="vs-light"
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                }}
              />
            </div>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="查询分析结果">
            {result ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="SuperGraph 版本">
                    v{result.supergraphVersion}
                  </Descriptions.Item>
                  <Descriptions.Item label="查询深度">
                    <Tag color={result.analysis.depth > 10 ? 'orange' : 'green'}>
                      {result.analysis.depth} 层
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="查询复杂度">
                    <Tag color={result.analysis.complexity > 500 ? 'red' : result.analysis.complexity > 100 ? 'orange' : 'green'}>
                      {result.analysis.complexity}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="涉及字段数">
                    {result.analysis.fields?.length || 0} 个
                  </Descriptions.Item>
                  <Descriptions.Item label="涉及 SubGraph 数">
                    {result.subgraphs?.length || 0} 个
                  </Descriptions.Item>
                </Descriptions>

                <Card size="small" title="查询计划" style={{ marginTop: 16 }}>
                  <div className="query-plan-tree" style={{ maxHeight: 300, overflow: 'auto' }}>
                    <pre>{JSON.stringify(result.queryPlan, null, 2)}</pre>
                  </div>
                </Card>

                <Card size="small" title="涉及 SubGraph" style={{ marginTop: 16 }}>
                  {result.subgraphs?.map((sg, idx) => (
                    <div key={idx} style={{ marginBottom: 8 }}>
                      <Tag color="blue">{sg.name}</Tag>
                      <span style={{ color: '#999', fontSize: 12 }}>{sg.url}</span>
                    </div>
                  ))}
                </Card>
              </Space>
            ) : (
              <div style={{ textAlign: 'center', color: '#999', padding: 100 }}>
                输入查询并点击"分析查询计划"查看结果
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default QueryAnalyzer;
