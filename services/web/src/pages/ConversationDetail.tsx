import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Space,
  Spin,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PluginsPanel } from '../components/PluginsPanel';
import { rpc } from '../rpc';

const STATUS_COLORS: Record<string, string> = {
  queued: 'default',
  provisioning: 'blue',
  preparing: 'blue',
  building: 'processing',
  plan_ready: 'cyan',
  plan_review: 'orange',
  plan_revising: 'processing',
  plan_rejected: 'error',
  executing: 'processing',
  publishing: 'purple',
  completed: 'success',
  failed: 'error',
};

export function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [githubUrlOverride, setGithubUrlOverride] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const convQuery = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => rpc.conversations.get({ id: id ?? '' }),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const messagesQuery = useQuery({
    queryKey: ['conversation', id, 'messages'],
    queryFn: () => rpc.conversations.listMessages({ conversationId: id ?? '' }),
    enabled: !!id,
    refetchInterval: 3000,
  });

  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => rpc.workflows.list(),
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      rpc.conversations.sendMessage({
        conversationId: id ?? '',
        content,
        triggersJob: true,
        jobOverrides: githubUrlOverride
          ? { githubUrl: githubUrlOverride }
          : undefined,
      }),
    onSuccess: ({ jobId }) => {
      qc.invalidateQueries({ queryKey: ['conversation', id, 'messages'] });
      setMessageInput('');
      setGithubUrlOverride('');
      if (jobId) navigate(`/jobs/${jobId}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (patch: { defaultGithubUrl?: string | null; defaultWorkflowId?: string | null }) =>
      rpc.conversations.update({ id: id ?? '', ...patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversation', id] }),
  });

  if (convQuery.isLoading) return <Spin />;
  if (convQuery.error) return <Alert type="error" message={String(convQuery.error)} />;
  const conv = convQuery.data;
  if (!conv) return null;

  const messages = messagesQuery.data ?? [];

  const handleSend = () => {
    const content = messageInput.trim();
    if (!content) return;
    const githubUrl = githubUrlOverride.trim() || conv.defaultGithubUrl;
    if (!githubUrl) {
      alert('No GitHub URL set. Add one in the conversation settings or enter one below.');
      return;
    }
    sendMutation.mutate(content);
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Header */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {conv.title}
            </Typography.Title>
            <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
              <Descriptions.Item label="Default repo">
                {conv.defaultGithubUrl ? (
                  <Typography.Text type="secondary">{conv.defaultGithubUrl}</Typography.Text>
                ) : (
                  <Typography.Text type="secondary" italic>
                    not set
                  </Typography.Text>
                )}
              </Descriptions.Item>
            </Descriptions>
          </div>
          <Button onClick={() => setDrawerOpen(true)}>Settings & Plugins</Button>
        </div>
      </Card>

      {/* Message thread */}
      <Card title="Thread">
        <Space direction="vertical" style={{ width: '100%' }}>
          {messages.length === 0 && (
            <Typography.Text type="secondary">No messages yet. Start the conversation below.</Typography.Text>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                gap: 4,
              }}
            >
              <div
                style={{
                  background: msg.role === 'user' ? '#1677ff' : '#f5f5f5',
                  color: msg.role === 'user' ? 'white' : 'inherit',
                  borderRadius: 8,
                  padding: '8px 12px',
                  maxWidth: '80%',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>
              {msg.jobId && (
                <Link to={`/jobs/${msg.jobId}`}>
                  <Tag color="blue" style={{ cursor: 'pointer' }}>
                    View job →
                  </Tag>
                </Link>
              )}
            </div>
          ))}
        </Space>
      </Card>

      {/* Compose */}
      <Card title="Send a message">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea
            rows={4}
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder={
              'Describe what you want done.\nFirst line becomes the job title.'
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
            }}
          />
          <Button
            type="link"
            size="small"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ padding: 0 }}
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced options
          </Button>
          {showAdvanced && (
            <Input
              placeholder="GitHub URL override (leave blank to use conversation default)"
              value={githubUrlOverride}
              onChange={(e) => setGithubUrlOverride(e.target.value)}
            />
          )}
          {sendMutation.error && (
            <Alert type="error" message={String(sendMutation.error)} />
          )}
          <Button
            type="primary"
            loading={sendMutation.isPending}
            onClick={handleSend}
            disabled={!messageInput.trim()}
          >
            Send (⌘↵)
          </Button>
        </Space>
      </Card>

      {/* Settings drawer */}
      <Drawer
        title="Settings & Plugins"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={360}
      >
        <Tabs
          items={[
            {
              key: 'settings',
              label: 'Settings',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Typography.Text strong>Default GitHub URL</Typography.Text>
                  <Input
                    defaultValue={conv.defaultGithubUrl ?? ''}
                    onBlur={(e) => {
                      const val = e.target.value.trim() || null;
                      updateMutation.mutate({ defaultGithubUrl: val });
                    }}
                    placeholder="https://github.com/you/your-repo"
                  />

                  <Typography.Text strong>Default workflow</Typography.Text>
                  <select
                    defaultValue={conv.defaultWorkflowId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      updateMutation.mutate({ defaultWorkflowId: val });
                    }}
                    style={{ width: '100%', padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 6 }}
                  >
                    <option value="">Default (plan → execute)</option>
                    {workflowsQuery.data?.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name}
                      </option>
                    ))}
                  </select>
                </Space>
              ),
            },
            {
              key: 'plugins',
              label: 'Plugins',
              children: id ? <PluginsPanel conversationId={id} /> : null,
            },
          ]}
        />
      </Drawer>
    </Space>
  );
}
