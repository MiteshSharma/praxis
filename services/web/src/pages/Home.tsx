import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Spin } from 'antd';
import { rpc } from '../rpc';

export function Home() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: () => rpc.health(),
  });

  return (
    <Card title="Backend health">
      {query.isLoading && <Spin tip="connecting..." />}
      {query.isError && <Alert type="error" message={String(query.error)} />}
      {query.data && (
        <Alert
          type="success"
          message={`ok: ${query.data.ok}`}
          description={`service: ${query.data.service}`}
        />
      )}
    </Card>
  );
}
