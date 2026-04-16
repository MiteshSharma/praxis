import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Space, Spin, Tabs, Typography, notification } from 'antd';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams } from 'react-router-dom';
import { rpc } from '../rpc';

const { Title, Text } = Typography;

export function MemoryEditor() {
  // Route is /memories/* so repoKey may contain slashes (github.com/user/repo)
  const params = useParams<{ '*': string }>();
  const repoKey = params['*'] ?? '';

  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'view' | 'edit'>('view');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['memories', 'get', repoKey],
    queryFn: () => rpc.memories.get({ repoKey }),
    enabled: !!repoKey,
  });

  // Initialise draft when data loads (only if no unsaved changes)
  useEffect(() => {
    if (data?.content !== undefined && draft === null) {
      setDraft(data.content);
    }
  }, [data?.content, draft]);

  const saveContent = draft ?? data?.content ?? '';

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => rpc.memories.update({ repoKey, content: saveContent }),
    onSuccess: ({ sizeBytes, entryCount }) => {
      notification.success({
        message: 'Memory saved',
        description: `${entryCount} entries · ${(sizeBytes / 1024).toFixed(1)} KB`,
      });
      queryClient.invalidateQueries({ queryKey: ['memories', 'get', repoKey] });
      queryClient.invalidateQueries({ queryKey: ['memories', 'list'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      notification.error({ message: 'Save failed', description: msg, duration: 0 });
    },
  });

  const handleCancel = () => {
    setDraft(data?.content ?? null);
  };

  const handleReload = async () => {
    setDraft(null);
    await refetch();
  };

  if (isLoading) return <Spin />;

  if (!data) {
    return (
      <Space direction="vertical">
        <Title level={4}>Not found</Title>
        <Text>No memory file exists for <Text code>{repoKey}</Text>.</Text>
      </Space>
    );
  }

  const isDirty = draft !== null && draft !== data.content;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Space direction="vertical" size={2}>
        <Title level={4} style={{ margin: 0 }}>
          Repository Memory: {repoKey}
        </Title>
        <Text type="secondary">
          {data.entryCount} entries · {(data.sizeBytes / 1024).toFixed(1)} KB · updated{' '}
          {new Date(data.updatedAt).toLocaleString()}
        </Text>
      </Space>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'view' | 'edit')}
        items={[
          {
            key: 'view',
            label: 'View',
            children: (
              <div style={{ fontFamily: 'inherit', lineHeight: 1.6 }}>
                <ReactMarkdown>{saveContent}</ReactMarkdown>
              </div>
            ),
          },
          {
            key: 'edit',
            label: 'Edit',
            children: (
              <Input.TextArea
                value={saveContent}
                onChange={(e) => setDraft(e.target.value)}
                autoSize={{ minRows: 20 }}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            ),
          },
        ]}
      />

      <Space>
        <Button
          type="primary"
          onClick={() => save()}
          loading={saving}
          disabled={!isDirty}
        >
          Save
        </Button>
        <Button onClick={handleCancel} disabled={!isDirty}>
          Cancel
        </Button>
        <Button onClick={handleReload}>Reload from server</Button>
      </Space>

      <Text type="secondary" style={{ fontSize: 12 }}>
        Note: this file may be edited by the next learning pass. Hand-edits are durable
        until the next job on this repo completes.
      </Text>
    </Space>
  );
}
