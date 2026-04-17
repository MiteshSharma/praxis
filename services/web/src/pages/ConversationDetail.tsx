import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtifactDto, JobDto, MessageDto } from '@shared/contracts';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import { useState, useCallback } from 'react';
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
        {job.model && <Tag style={{ fontSize: 11 }}>{job.model}</Tag>}
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

function PlanReviewChannelsPanel({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const channelsQuery = useQuery({
    queryKey: ['channels', conversationId],
    queryFn: () => rpc.channels.list({ conversationId }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      rpc.channels.create({
        conversationId,
        type: 'webhook',
        name: newName.trim(),
        config: { url: newUrl.trim() },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels', conversationId] });
      setNewName('');
      setNewUrl('');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rpc.channels.toggle({ id, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', conversationId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpc.channels.delete({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', conversationId] }),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        When a plan is ready for review, Praxis POSTs the plan data + a signed callback token to
        each enabled webhook. The receiver calls <code>POST /plan-review/respond</code> to approve,
        revise, or reject.
      </Typography.Text>

      {channelsQuery.data?.map((ch) => (
        <Card key={ch.id} size="small" style={{ borderColor: '#f0f0f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                {ch.name}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {(ch.config as { url?: string }).url ?? '—'}
              </Typography.Text>
            </div>
            <Space>
              <Switch
                size="small"
                checked={ch.enabled}
                onChange={(enabled) => toggleMutation.mutate({ id: ch.id, enabled })}
              />
              <Popconfirm
                title="Delete this channel?"
                onConfirm={() => deleteMutation.mutate(ch.id)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Button size="small" danger type="text">
                  ✕
                </Button>
              </Popconfirm>
            </Space>
          </div>
        </Card>
      ))}

      <Typography.Text strong style={{ fontSize: 12 }}>
        Add webhook
      </Typography.Text>
      <Input
        placeholder="Name (e.g. Slack bot)"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        size="small"
      />
      <Input
        placeholder="Webhook URL"
        value={newUrl}
        onChange={(e) => setNewUrl(e.target.value)}
        size="small"
      />
      {createMutation.error && <Alert type="error" message={String(createMutation.error)} />}
      <Button
        size="small"
        type="primary"
        loading={createMutation.isPending}
        disabled={!newName.trim() || !newUrl.trim()}
        onClick={() => createMutation.mutate()}
      >
        Add
      </Button>
    </Space>
  );
}

export function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [olderMessages, setOlderMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [githubUrlOverride, setGithubUrlOverride] = useState('');

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

  // Newest 20 messages — polled every 3 s
  const messagesQuery = useQuery({
    queryKey: ['conversation', id, 'messages'],
    queryFn: async () => {
      const result = await rpc.conversations.listMessages({ conversationId: id ?? '', limit: 20 });
      // On first load, initialise hasMore from the response
      setHasMore(result.hasMore);
      return result;
    },
    enabled: !!id,
    refetchInterval: 3000,
  });

  const loadOlderMessages = useCallback(async () => {
    if (!id) return;
    // Oldest message we currently have (from olderMessages, else from latest page)
    const allLoaded = [...olderMessages, ...(messagesQuery.data?.messages ?? [])];
    const oldest = allLoaded[0];
    if (!oldest) return;

    setLoadingOlder(true);
    try {
      const result = await rpc.conversations.listMessages({
        conversationId: id,
        limit: 20,
        before: oldest.createdAt,
      });
      setOlderMessages((prev) => [...result.messages, ...prev]);
      setHasMore(result.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [id, olderMessages, messagesQuery.data]);

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
        jobOverrides: githubUrlOverride ? { githubUrl: githubUrlOverride } : undefined,
      }),
    onSuccess: ({ jobId }) => {
      qc.invalidateQueries({ queryKey: ['conversation', id, 'messages'] });
      setMessageInput('');
      if (jobId) navigate(`/jobs/${jobId}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (patch: {
      defaultGithubUrl?: string | null;
      defaultWorkflowId?: string | null;
      planHoldHours?: number;
      model?: string | null;
    }) => rpc.conversations.update({ id: id ?? '', ...patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversation', id] }),
  });

  // Combine older pages (prepended) with the latest page
  const messages = [...olderMessages, ...(messagesQuery.data?.messages ?? [])];

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
    const githubUrl = conv.defaultGithubUrl;
    if (!githubUrl) {
      alert('No GitHub URL set. Add one in the conversation settings.');
      return;
    }
    sendMutation.mutate(content);
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Button type="link" style={{ padding: 0 }} onClick={() => navigate('/conversations')}>
        ← Back to conversations
      </Button>

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
          {sendMutation.error && <Alert type="error" message={String(sendMutation.error)} />}
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
          <Typography.Text type="secondary">
            No messages yet. Start the conversation above.
          </Typography.Text>
        ) : (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            {[...messages].reverse().map((msg) => {
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
                      {msg.role === 'user'
                        ? 'You'
                        : msg.role === 'assistant'
                          ? 'Assistant'
                          : 'System'}
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
                                lineClamp: 5,
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
            {/* Load older messages */}
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <Button size="small" loading={loadingOlder} onClick={loadOlderMessages}>
                  Load older messages
                </Button>
              </div>
            )}
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
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      border: '1px solid #d9d9d9',
                      borderRadius: 6,
                    }}
                  >
                    <option value="">Default (plan → execute)</option>
                    {workflowsQuery.data?.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name}
                      </option>
                    ))}
                  </select>

                  <Typography.Text strong>Model</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Override the default model for all jobs in this conversation. Leave blank to use
                    the system default (claude-sonnet-4-6).
                  </Typography.Text>
                  <Input
                    defaultValue={conv.model ?? ''}
                    onBlur={(e) => {
                      const val = e.target.value.trim() || null;
                      updateMutation.mutate({ model: val });
                    }}
                    placeholder="e.g. gpt-4o or claude-opus-4-6"
                  />

                  <Typography.Text strong>Plan review hold (hours)</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    How long to wait for plan approval before timing out. Max 168h (7 days).
                  </Typography.Text>
                  <InputNumber
                    min={1}
                    max={168}
                    defaultValue={conv.planHoldHours}
                    onBlur={(e) => {
                      const val = Number.parseInt(e.target.value, 10);
                      if (!Number.isNaN(val) && val >= 1 && val <= 168) {
                        updateMutation.mutate({ planHoldHours: val });
                      }
                    }}
                    style={{ width: '100%' }}
                    addonAfter="hours"
                  />
                </Space>
              ),
            },
            {
              key: 'channels',
              label: 'Review channels',
              children: id ? <PlanReviewChannelsPanel conversationId={id} /> : null,
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
