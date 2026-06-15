import React, { useState, useEffect } from 'react';
import { Card, Select, Spin, Tabs } from 'antd';
import Editor from '@monaco-editor/react';
import api from '../api';

const { Option } = Select;
const { TabPane } = Tabs;

interface Subgraph {
  id: string;
  name: string;
}

function SchemaBrowser() {
  const [subgraphs, setSubgraphs] = useState<Subgraph[]>([]);
  const [selectedSubgraph, setSelectedSubgraph] = useState<string>('supergraph');
  const [schema, setSchema] = useState<string>('');
  const [supergraphSchema, setSupergraphSchema] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedSubgraph === 'supergraph') {
      setSchema(supergraphSchema);
    } else {
      loadSubgraphSchema(selectedSubgraph);
    }
  }, [selectedSubgraph, supergraphSchema]);

  const loadData = async () => {
    try {
      const [subgraphsRes, supergraphRes] = await Promise.all([
        api.get('/subgraphs'),
        api.get('/supergraph/current'),
      ]);
      setSubgraphs(subgraphsRes.data.subgraphs || []);
      setSupergraphSchema(supergraphRes.data.supergraph?.sdl || '');
      setSchema(supergraphRes.data.supergraph?.sdl || '');
    } catch (err) {
      console.error('Failed to load schema:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSubgraphSchema = async (id: string) => {
    try {
      const response = await api.get(`/subgraphs/${id}/versions?limit=1`);
      const versions = response.data.versions || [];
      if (versions.length > 0) {
        setSchema(versions[0].sdl);
      }
    } catch (err) {
      console.error('Failed to load subgraph schema:', err);
    }
  };

  return (
    <div>
      <Card title="Schema 浏览器" extra={
        <Select
          style={{ width: 200 }}
          value={selectedSubgraph}
          onChange={setSelectedSubgraph}
        >
          <Option value="supergraph">SuperGraph (聚合)</Option>
          {subgraphs.map(sg => (
            <Option key={sg.id} value={sg.id}>{sg.name}</Option>
          ))}
        </Select>
      }>
        <Spin spinning={loading}>
          <div className="monaco-container" style={{ height: 'calc(100vh - 250px)', minHeight: 500 }}>
            <Editor
              height="100%"
              language="graphql"
              value={schema}
              theme="vs-light"
              options={{
                readOnly: true,
                minimap: { enabled: true },
                fontSize: 12,
                lineNumbers: 'on',
              }}
            />
          </div>
        </Spin>
      </Card>
    </div>
  );
}

export default SchemaBrowser;
