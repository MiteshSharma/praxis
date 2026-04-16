import { Layout, Menu, Typography } from 'antd';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AgentBrowse } from './pages/AgentBrowse';
import { ConversationDetail } from './pages/ConversationDetail';
import { ConversationList } from './pages/ConversationList';
import { CreateJob } from './pages/CreateJob';
import { JobView } from './pages/JobView';
import { WorkflowBrowse } from './pages/WorkflowBrowse';

const { Header, Content, Sider } = Layout;

const NAV_ITEMS = [
  { key: '/conversations', label: <Link to="/conversations">Conversations</Link> },
  { key: '/', label: <Link to="/">New job</Link> },
  { key: '/workflows', label: <Link to="/workflows">Workflows</Link> },
  { key: '/agents', label: <Link to="/agents">Agents</Link> },
];

export function App() {
  const location = useLocation();

  // Determine selected nav key (match on prefix for nested routes)
  const selectedKey =
    NAV_ITEMS.find(
      (item) => item.key !== '/' && location.pathname.startsWith(item.key),
    )?.key ?? (location.pathname === '/' ? '/' : undefined);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '0 24px' }}>
        <Typography.Title level={4} style={{ color: 'white', margin: 0 }}>
          Praxis
        </Typography.Title>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={NAV_ITEMS}
          style={{ flex: 1, border: 'none' }}
        />
      </Header>
      <Content style={{ padding: 24, maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Routes>
          <Route path="/" element={<CreateJob />} />
          <Route path="/jobs/:jobId" element={<JobView />} />
          <Route path="/conversations" element={<ConversationList />} />
          <Route path="/conversations/:id" element={<ConversationDetail />} />
          <Route path="/workflows" element={<WorkflowBrowse />} />
          <Route path="/agents" element={<AgentBrowse />} />
        </Routes>
      </Content>
    </Layout>
  );
}
