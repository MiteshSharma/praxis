import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

interface CreateForm {
  title: string;
  defaultGithubUrl?: string;
}

export function ConversationList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form] = Form.useForm<CreateForm>();

  const listQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => rpc.conversations.list(),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) =>
      rpc.conversations.create({
        title: values.title,
        defaultGithubUrl: values.defaultGithubUrl || undefined,
      }),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setShowCreate(false);
      form.resetFields();
      navigate(`/conversations/${conv.id}`);
    },
  });

  const columns = [
    {
      title: 'Title',
      dataIndex: 'title',
      render: (text: string, row: { id: string }) => (
        <Button type="link" onClick={() => navigate(`/conversations/${row.id}`)}>
          {text}
        </Button>
      ),
    },
    {
      title: 'Default repo',
      dataIndex: 'defaultGithubUrl',
      render: (url: string | null) =>
        url ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {url.replace('https://github.com/', '')}
          </Typography.Text>
        ) : (
          <Tag>none</Tag>
        ),
    },
    {
      title: 'Updated',
      dataIndex: 'updatedAt',
      render: (ts: string) => new Date(ts).toLocaleString(),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Conversations
        </Typography.Title>
        <Button type="primary" onClick={() => setShowCreate(true)}>
          New conversation
        </Button>
      </div>

      {listQuery.error && <Alert type="error" message={String(listQuery.error)} />}

      <Card>
        <Table
          dataSource={listQuery.data ?? []}
          columns={columns}
          rowKey="id"
          loading={listQuery.isLoading}
          pagination={false}
          locale={{ emptyText: 'No conversations yet — create one to get started.' }}
        />
      </Card>

      <Modal
        title="New conversation"
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Rate limiting work" />
          </Form.Item>
          <Form.Item
            name="defaultGithubUrl"
            label="Default GitHub URL"
            extra="Optional — jobs in this conversation use this repo by default."
          >
            <Input placeholder="https://github.com/you/your-repo" />
          </Form.Item>
          {createMutation.error && (
            <Alert type="error" message={String(createMutation.error)} style={{ marginBottom: 16 }} />
          )}
          <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
            Create
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
