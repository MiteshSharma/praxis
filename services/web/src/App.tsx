import { Layout, Typography } from 'antd';
import { Route, Routes } from 'react-router-dom';
import { CreateJob } from './pages/CreateJob';
import { JobView } from './pages/JobView';

const { Header, Content } = Layout;

export function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header>
        <Typography.Title level={3} style={{ color: 'white', margin: 0, lineHeight: '64px' }}>
          Praxis
        </Typography.Title>
      </Header>
      <Content style={{ padding: 24, maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Routes>
          <Route path="/" element={<CreateJob />} />
          <Route path="/jobs/:jobId" element={<JobView />} />
        </Routes>
      </Content>
    </Layout>
  );
}
