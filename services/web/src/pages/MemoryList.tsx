import { useQuery } from '@tanstack/react-query';
import { Button, Empty, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

const { Title, Text } = Typography;

interface RepoRow {
  repoKey: string;
  sizeBytes: number;
  entryCount: number;
  updatedAt: string;
}

export function MemoryList() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['memories', 'list'],
    queryFn: () => rpc.memories.listRepos(),
  });

  const columns: ColumnsType<RepoRow> = [
    {
      title: 'Repository',
      dataIndex: 'repoKey',
      key: 'repoKey',
      render: (key: string) => <Text code>{key}</Text>,
    },
    {
      title: 'Entries',
      dataIndex: 'entryCount',
      key: 'entryCount',
      width: 90,
      align: 'right',
    },
    {
      title: 'Size',
      dataIndex: 'sizeBytes',
      key: 'sizeBytes',
      width: 100,
      align: 'right',
      render: (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`,
    },
    {
      title: 'Last updated',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 200,
      render: (iso: string) => new Date(iso).toLocaleString(),
    },
    {
      title: '',
      key: 'action',
      width: 80,
      render: (_: unknown, row: RepoRow) => (
        <Button
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/memories/${row.repoKey}`);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Title level={3} style={{ margin: 0 }}>
        Repository Memory
      </Title>

      <Text type="secondary">
        Memory is created automatically when a job completes on a repo. To pre-seed a repo, run
        a job first or use the API directly.
      </Text>

      <Table
        columns={columns}
        dataSource={data ?? []}
        rowKey="repoKey"
        loading={isLoading}
        locale={{ emptyText: <Empty description="No repo memories yet" /> }}
        onRow={(row) => ({
          style: { cursor: 'pointer' },
          onClick: () => navigate(`/memories/${row.repoKey}`),
        })}
        pagination={false}
        size="small"
      />
    </Space>
  );
}
