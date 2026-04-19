import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobDto, MessageDto } from '@shared/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Input,
  InputNumber,
  Popconfirm,
  Spin,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PluginsPanel } from '../components/PluginsPanel';
import { rpc } from '../rpc';

const JOB_STATUS_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  queued:        { bg: '#F2F4F7', text: '#475467', dot: '#98A2B3' },
  provisioning:  { bg: '#EFF8FF', text: '#1570EF', dot: '#1570EF' },
  preparing:     { bg: '#EFF8FF', text: '#1570EF', dot: '#1570EF' },
  building:      { bg: '#EFF8FF', text: '#1570EF', dot: '#1570EF' },
  plan_ready:    { bg: '#F0FDF4', text: '#079455', dot: '#079455' },
  plan_review:   { bg: '#FFF6ED', text: '#B54708', dot: '#F79009' },
  plan_revising: { bg: '#EFF8FF', text: '#1570EF', dot: '#1570EF' },
  plan_rejected: { bg: '#FEF3F2', text: '#B42318', dot: '#F04438' },
  executing:     { bg: '#EFF8FF', text: '#1570EF', dot: '#1570EF' },
  checking:      { bg: '#EFF8FF', text: '#1570EF', dot: '#1570EF' },
  publishing:    { bg: '#F9F5FF', text: '#6941C6', dot: '#7F56D9' },
  learning:      { bg: '#F9F5FF', text: '#6941C6', dot: '#7F56D9' },
  completed:     { bg: '#F0FDF4', text: '#079455', dot: '#079455' },
  failed:        { bg: '#FEF3F2', text: '#B42318', dot: '#F04438' },
};

function fmtK(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function PlanReviewChannelsPanel({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const channelsQuery = useQuery({
    queryKey: ['channels', sessionId],
    queryFn: () => rpc.channels.list({ sessionId }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      rpc.channels.create({
        sessionId,
        type: 'webhook',
        name: newName.trim(),
        config: { url: newUrl.trim() },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels', sessionId] });
      setNewName('');
      setNewUrl('');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rpc.channels.toggle({ id, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', sessionId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpc.channels.delete({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', sessionId] }),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--c-text-2)', margin: 0 }}>
        When a plan is ready, Praxis POSTs the plan + a signed token to each enabled webhook.
      </p>

      {channelsQuery.data?.map((ch) => (
        <div
          key={ch.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
          }}
        >
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{ch.name}</div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
              {(ch.config as { url?: string }).url ?? '—'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--c-error)' }}>
                ✕
              </button>
            </Popconfirm>
          </div>
        </div>
      ))}

      <div style={{ fontWeight: 600, fontSize: 12, marginTop: 4 }}>Add webhook</div>
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
    </div>
  );
}

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const threadRef = useRef<HTMLDivElement>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [olderMessages, setOlderMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [githubUrlOverride, setGithubUrlOverride] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ['session', id],
    queryFn: () => rpc.sessions.get({ id: id ?? '' }),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const messagesQuery = useQuery({
    queryKey: ['session', id, 'messages'],
    queryFn: async () => {
      const result = await rpc.sessions.history({ sessionId: id ?? '', limit: 20 });
      setHasMore(result.hasMore);
      return result;
    },
    enabled: !!id,
    refetchInterval: 3000,
  });

  const loadOlderMessages = useCallback(async () => {
    if (!id) return;
    const allLoaded = [...olderMessages, ...(messagesQuery.data?.messages ?? [])];
    const oldest = allLoaded[0];
    if (!oldest) return;

    setLoadingOlder(true);
    try {
      const result = await rpc.sessions.history({
        sessionId: id,
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
      rpc.sessions.send({
        sessionId: id ?? '',
        message: content,
        githubUrl: githubUrlOverride || undefined,
        autoApprove: autoApprove || undefined,
      }),
    onSuccess: ({ jobId }) => {
      qc.invalidateQueries({ queryKey: ['session', id, 'messages'] });
      setMessageInput('');
      if (jobId) navigate(`/jobs/${jobId}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (patch: {
      title?: string;
      githubUrl?: string | null;
      workflowId?: string | null;
      planHoldHours?: number;
      model?: string | null;
    }) => rpc.sessions.update({ id: id ?? '', ...patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });

  const messages = [...olderMessages, ...(messagesQuery.data?.messages ?? [])];
  const jobIds = [...new Set(messages.flatMap((m) => (m.jobId ? [m.jobId] : [])))];

  const jobQueries = useQueries({
    queries: jobIds.map((jid) => ({
      queryKey: ['job', jid],
      queryFn: () => rpc.jobs.get({ jobId: jid }),
      staleTime: 10_000,
    })),
  });

  const jobMap = Object.fromEntries(jobIds.map((jid, i) => [jid, jobQueries[i]?.data]));

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = 0;
    }
  }, [messages.length]);

  if (sessionQuery.isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  if (sessionQuery.error) return <Alert type="error" message={String(sessionQuery.error)} />;
  const session = sessionQuery.data;
  if (!session) return null;

  const handleSend = () => {
    const content = messageInput.trim();
    if (!content) return;
    if (!session.defaultGithubUrl && !githubUrlOverride) {
      alert('No GitHub URL set. Add one in the session settings.');
      return;
    }
    sendMutation.mutate(content);
  };

  return (
    <div className="chat-shell">
      {/* Breadcrumb */}
      <div style={{ flexShrink: 0, padding: '16px 28px 0', background: 'var(--c-bg)' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/sessions')}
          style={{ paddingLeft: 0 }}
        >
          ← Back to sessions
        </button>
      </div>

      {/* Chat header */}
      <div className="chat-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title}
          </div>
          {session.defaultGithubUrl && (
            <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
              {session.defaultGithubUrl.replace('https://github.com/', '')}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setDrawerOpen(true)}
        >
          Settings
        </button>
      </div>

      {/* Compose bar */}
      <div className="chat-compose">
        {showAdvanced && (
          <div style={{ marginBottom: 8 }}>
            <Input
              placeholder="GitHub URL override (leave blank to use session default)"
              value={githubUrlOverride}
              onChange={(e) => setGithubUrlOverride(e.target.value)}
              size="small"
            />
          </div>
        )}
        {sendMutation.error && (
          <Alert type="error" message={String(sendMutation.error)} style={{ marginBottom: 8 }} closable />
        )}
        <div className="compose-box">
          <textarea
            className="compose-textarea"
            rows={3}
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder={'Describe what you want done…\nFirst line becomes the job title.'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
            }}
          />
          <div className="compose-footer">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Checkbox checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)}>
                <span style={{ fontSize: 13 }}>Auto-approve plan</span>
              </Checkbox>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? 'Hide options' : 'Options'}
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!messageInput.trim() || sendMutation.isPending}
              onClick={handleSend}
            >
              {sendMutation.isPending ? 'Sending…' : 'Send'}
              <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>⌘↵</span>
            </button>
          </div>
        </div>
      </div>

      {/* Thread */}
      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 && (
          <div className="empty-state" style={{ margin: 'auto' }}>
            <div className="empty-state-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M21 3H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h5l3 3 3-3h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="empty-state-title">No messages yet</p>
            <p className="empty-state-description">Your first task will appear here.</p>
          </div>
        )}

        {[...messages].reverse().map((msg) => {
          const job = msg.jobId ? jobMap[msg.jobId] : undefined;
          const isUser = msg.role === 'user';
          const statusStyle = job ? (JOB_STATUS_COLOR[job.status] ?? JOB_STATUS_COLOR.queued) : null;

          return (
            <div
              key={msg.id}
              className="msg-card"
              data-user={isUser ? 'true' : undefined}
              data-clickable={msg.jobId ? 'true' : undefined}
              onClick={msg.jobId ? () => navigate(`/jobs/${msg.jobId}`) : undefined}
              role={msg.jobId ? 'button' : undefined}
              tabIndex={msg.jobId ? 0 : undefined}
              onKeyDown={
                msg.jobId
                  ? (e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/jobs/${msg.jobId}`); }
                  : undefined
              }
            >
              <div className="msg-card-header">
                <span className="msg-card-role">
                  {isUser ? 'You' : msg.role === 'assistant' ? 'Assistant' : 'System'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {statusStyle && (
                    <span
                      className="msg-job-status"
                      style={{ background: statusStyle.bg, color: statusStyle.text }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.dot, flexShrink: 0 }} />
                      {job?.status.replace(/_/g, ' ') ?? 'pending'}
                    </span>
                  )}
                  <span className="msg-card-time">
                    {new Date(msg.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              <div className="msg-card-body">
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
                  {msg.content}
                </p>
              </div>

              {job && (job.model || job.totalCostUsd != null || job.totalInputTokens != null) && (
                <div className="msg-card-meta">
                  {job.model && (
                    <span className="msg-card-meta-chip">{job.model.split('/').pop()}</span>
                  )}
                  {job.totalCostUsd != null && (
                    <span className="msg-card-meta-chip">${job.totalCostUsd.toFixed(4)}</span>
                  )}
                  {job.totalInputTokens != null && (
                    <span className="msg-card-meta-chip">{fmtK(job.totalInputTokens)}↑ {fmtK(job.totalOutputTokens ?? 0)}↓</span>
                  )}
                </div>
              )}

              {msg.prArtifactUrl && (
                <div className="msg-card-pr-footer">
                  <a
                    href={msg.prArtifactUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="msg-card-pr-link"
                  >
                    View PR →
                  </a>
                </div>
              )}
            </div>
          );
        })}

        {hasMore && (
          <div style={{ textAlign: 'center', paddingTop: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={loadingOlder}
              onClick={loadOlderMessages}
            >
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}
      </div>

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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Name</div>
                    <Input
                      defaultValue={session.title}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val && val !== session.title) {
                          updateMutation.mutate({ title: val });
                        }
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      GitHub URL
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {session.defaultGithubUrl ?? '—'}
                    </Typography.Text>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      Default workflow
                    </div>
                    <select
                      className="select"
                      defaultValue={session.defaultWorkflowId ?? ''}
                      onChange={(e) => {
                        updateMutation.mutate({ workflowId: e.target.value || null });
                      }}
                    >
                      <option value="">Default (plan → execute)</option>
                      {workflowsQuery.data?.map((wf) => (
                        <option key={wf.id} value={wf.id}>
                          {wf.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Model</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                      Override the default model. Leave blank for claude-sonnet-4-6.
                    </Typography.Text>
                    <Input
                      defaultValue={session.model ?? ''}
                      onBlur={(e) => {
                        const val = e.target.value.trim() || null;
                        updateMutation.mutate({ model: val });
                      }}
                      placeholder="e.g. gpt-4o or claude-opus-4-6"
                    />
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      Plan review hold (hours)
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                      How long to wait for plan approval. Max 168h.
                    </Typography.Text>
                    <InputNumber
                      min={1}
                      max={168}
                      defaultValue={session.planHoldHours}
                      onBlur={(e) => {
                        const val = Number.parseInt(e.target.value, 10);
                        if (!Number.isNaN(val) && val >= 1 && val <= 168) {
                          updateMutation.mutate({ planHoldHours: val });
                        }
                      }}
                      style={{ width: '100%' }}
                      addonAfter="hours"
                    />
                  </div>
                </div>
              ),
            },
            {
              key: 'channels',
              label: 'Review channels',
              children: id ? <PlanReviewChannelsPanel sessionId={id} /> : null,
            },
            {
              key: 'plugins',
              label: 'Plugins',
              children: id ? <PluginsPanel sessionId={id} /> : null,
            },
          ]}
        />
      </Drawer>
    </div>
  );
}
