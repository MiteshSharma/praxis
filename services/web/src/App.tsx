import { Layout, Typography } from 'antd';
import { Home } from './pages/Home';

const { Header, Content } = Layout;

export function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header>
        <Typography.Title level={3} style={{ color: 'white', margin: 0, lineHeight: '64px' }}>
          Praxis
        </Typography.Title>
      </Header>
      <Content style={{ padding: 24 }}>
        <Home />
      </Content>
    </Layout>
  );
}
