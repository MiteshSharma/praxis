import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
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
import type { ArtifactDto, JobDto } from '@shared/contracts';

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

function fmtK(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function JobInfoPanel({
  job,
  artifacts,
  jobId,
}: {
  job: JobDto;
  artifacts: ArtifactDto[];
  jobId: string;
}) {
  const prArtifact = artifacts.find((a) => a.kind === 'pr');
  const cost = job.totalCostUsd != null ? `$${job.totalCostUsd.toFixed(4)}` : null;
  const tokens =
    job.totalInputTokens != null || job.totalOutputTokens != null
      ? `${fmtK(job.totalInputTokens)} in / ${fmtK(job.totalOutputTokens)} out`
      : null;

  return (
    <div
      style={{
        background: '#fafafa',
        border: '1px solid #e8e8e8',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 13,
        minWidth: 200,
        maxWidth: 260,
      }}
    >
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Tag color={STATUS_COLORS[job.status] ?? 'default'}>{job.status}</Tag>
        <Link to={`/jobs/${jobId}`} style={{ fontSize: 13 }}>
          View Job →
        </Link>
        {prArtifact?.url && (
          <a href={prArtifact.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
            🔀 View Pull Request
          </a>
        )}
        {cost && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            💰 {cost}
          </Typography.Text>
        )}
        {tokens && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            🔢 {tokens}
          </Typography.Text>
        )}
        {job.completedAt && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ✅ {new Date(job.completedAt).toLocaleString()}
          </Typography.Text>
        )}
      </Space>
    </div>
  );
}

export function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [githubUrlOverride, setGithubUrlOverride] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (msgId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(msgId) ? next.delete(msgId) : next.add(msgId);
      return next;
    });
  };

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

  const messages = messagesQuery.data ?? [];

  // Collect unique job IDs from messages — must be before any early returns (Rules of Hooks)
  const jobIds = [...new Set(messages.flatMap((m) => (m.jobId ? [m.jobId] : [])))];

  const jobQueries = useQueries({
    queries: jobIds.map((jid) => ({
      queryKey: ['job', jid],
      queryFn: () => rpc.jobs.get({ jobId: jid }),
      staleTime: 10_000,
    })),
  });

  const artifactQueries = useQueries({
    queries: jobIds.map((jid) => ({
      queryKey: ['artifacts', jid],
      queryFn: () => rpc.jobs.listArtifacts({ jobId: jid }),
      staleTime: 30_000,
    })),
  });

  const jobMap = Object.fromEntries(jobIds.map((jid, i) => [jid, jobQueries[i]?.data]));
  const artifactMap = Object.fromEntries(jobIds.map((jid, i) => [jid, artifactQueries[i]?.data]));

  if (convQuery.isLoading) return <Spin />;
  if (convQuery.error) return <Alert type="error" message={String(convQuery.error)} />;
  const conv = convQuery.data;
  if (!conv) return null;

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

      {/* Compose — above thread */}
      <Card title="Send a message">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea
            rows={4}
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder={'Describe what you want done.\nFirst line becomes the job title.'}
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

      {/* Message thread */}
      <Card title="Thread">
        {messages.length === 0 ? (
          <Typography.Text type="secondary">No messages yet. Start the conversation above.</Typography.Text>
        ) : (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            {messages.map((msg) => {
              const isExpanded = expandedIds.has(msg.id);
              const isLong = msg.content.split('\n').length > 5 || msg.content.length > 400;
              const job = msg.jobId ? jobMap[msg.jobId] : undefined;
              const artifacts = msg.jobId ? (artifactMap[msg.jobId] ?? []) : [];

              return (
                <Card
                  key={msg.id}
                  size="small"
                  style={{ marginBottom: 12, borderColor: '#f0f0f0' }}
                >
                  {/* Header row: role + timestamp */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <Typography.Text strong>
                      {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Assistant' : 'System'}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(msg.createdAt).toLocaleString()}
                    </Typography.Text>
                  </div>

                  {/* Body row: message left, job panel right */}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    {/* Message text + expand toggle */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Paragraph
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          ...(isExpanded
                            ? {}
                            : {
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: 5,
                                WebkitBoxOrient: 'vertical',
                              }),
                        }}
                      >
                        {msg.content}
                      </Typography.Paragraph>
                      {isLong && (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => toggleExpand(msg.id)}
                          style={{ padding: 0, height: 'auto', marginTop: 4 }}
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </Button>
                      )}
                    </div>

                    {/* Job details panel */}
                    {msg.jobId && job && (
                      <JobInfoPanel job={job} artifacts={artifacts} jobId={msg.jobId} />
                    )}
                  </div>
                </Card>
              );
            })}
          </Space>
        )}
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
