import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  LineChartOutlined,
  ApiOutlined,
  BellOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from './store/auth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Subgraphs from './pages/Subgraphs';
import SchemaBrowser from './pages/SchemaBrowser';
import QueryAnalyzer from './pages/QueryAnalyzer';
import Metrics from './pages/Metrics';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import ChangeHistory from './pages/ChangeHistory';

const { Header, Sider, Content } = Layout;

function App() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div style={{ padding: 24 }}>加载中...</div>;
  }

  if (!user && location.pathname !== '/login') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (location.pathname === '/login') {
    return <Login />;
  }

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/subgraphs', icon: <AppstoreOutlined />, label: 'SubGraph 管理' },
    { key: '/schema', icon: <FileTextOutlined />, label: 'Schema 浏览' },
    { key: '/changes', icon: <LineChartOutlined />, label: '变更历史' },
    { key: '/query-analyzer', icon: <ApiOutlined />, label: '查询分析器' },
    { key: '/metrics', icon: <LineChartOutlined />, label: '监控指标' },
    { key: '/alerts', icon: <BellOutlined />, label: '告警配置' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={200}>
        <div className="logo">GraphQL 联邦</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => {
            window.location.href = key;
          }}
        />
      </Sider>
      <Layout className="site-layout">
        <Header className="site-layout-background" style={{ padding: '0 24px', background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>GraphQL Federation 管理平台</h2>
            <div>
              <span style={{ marginRight: 16 }}>租户: {localStorage.getItem('tenantId') || 'default'}</span>
              <span style={{ marginRight: 16 }}>{user?.name}</span>
            </div>
          </div>
        </Header>
        <Content style={{ margin: '24px', minHeight: 280 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/subgraphs" element={<Subgraphs />} />
            <Route path="/schema" element={<SchemaBrowser />} />
            <Route path="/changes" element={<ChangeHistory />} />
            <Route path="/query-analyzer" element={<QueryAnalyzer />} />
            <Route path="/metrics" element={<Metrics />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
