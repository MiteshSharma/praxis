import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Divider, Form, Input, Select, Space, Switch, Tag, Typography } from 'antd';
import { rpc } from '../rpc';

interface PluginsPanelProps {
  conversationId: string;
}

interface CreatePluginForm {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
}

export function PluginsPanel({ conversationId }: PluginsPanelProps) {
  const qc = useQueryClient();
  const [form] = Form.useForm<CreatePluginForm>();

  const pluginsQuery = useQuery({
    queryKey: ['plugins', conversationId],
    queryFn: () => rpc.plugins.list({ conversationId }),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreatePluginForm) =>
      rpc.plugins.create({ conversationId, ...values }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugins', conversationId] });
      form.resetFields();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rpc.plugins.toggle({ id, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins', conversationId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpc.plugins.delete({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins', conversationId] }),
  });

  const transport = Form.useWatch('transport', form);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text strong>Active plugins</Typography.Text>

      {pluginsQuery.data?.length === 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          No plugins added yet.
        </Typography.Text>
      )}

      {pluginsQuery.data?.map((p) => (
        <div
          key={p.id}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Switch
            size="small"
            checked={p.enabled}
            onChange={(enabled) => toggleMutation.mutate({ id: p.id, enabled })}
          />
          <Typography.Text style={{ flex: 1 }}>{p.name}</Typography.Text>
          <Tag>{p.transport}</Tag>
          <Button
            size="small"
            danger
            type="text"
            onClick={() => deleteMutation.mutate(p.id)}
          >
            ×
          </Button>
        </div>
      ))}

      <Divider style={{ margin: '12px 0' }} />

      <Typography.Text strong style={{ fontSize: 12 }}>
        Add plugin
      </Typography.Text>

      <Form form={form} layout="vertical" size="small" onFinish={(v) => createMutation.mutate(v)}>
        <Form.Item name="name" rules={[{ required: true }]}>
          <Input placeholder="Plugin name (e.g. filesystem)" />
        </Form.Item>
        <Form.Item name="transport" initialValue="stdio" rules={[{ required: true }]}>
          <Select options={[{ value: 'stdio', label: 'stdio' }, { value: 'http', label: 'http' }]} />
        </Form.Item>
        {transport === 'stdio' || !transport ? (
          <Form.Item name="command" rules={[{ required: true }]}>
            <Input placeholder="npx @modelcontextprotocol/server-filesystem /workspace" />
          </Form.Item>
        ) : (
          <Form.Item name="url" rules={[{ required: true, type: 'url' }]}>
            <Input placeholder="http://mcp-server:3000" />
          </Form.Item>
        )}
        {createMutation.error && (
          <Alert type="error" message={String(createMutation.error)} style={{ marginBottom: 8 }} />
        )}
        <Button type="primary" htmlType="submit" size="small" loading={createMutation.isPending}>
          Add
        </Button>
      </Form>
    </Space>
  );
}
