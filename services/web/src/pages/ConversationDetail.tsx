import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtifactDto, JobDto, MessageDto } from '@shared/contracts';
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
  Tag,
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

export function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const threadRef = useRef<HTMLDivElement>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [olderMessages, setOlderMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [githubUrlOverride, setGithubUrlOverride] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);

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
    queryFn: async () => {
      const result = await rpc.conversations.listMessages({ conversationId: id ?? '', limit: 20 });
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
        jobOverrides:
          githubUrlOverride || autoApprove
            ? { githubUrl: githubUrlOverride || undefined, autoApprove: autoApprove || undefined }
            : undefined,
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

  const messages = [...olderMessages, ...(messagesQuery.data?.messages ?? [])];
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

  // Scroll to top when a new message arrives (newest is at top)
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = 0;
    }
  }, [messages.length]);

  if (convQuery.isLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  if (convQuery.error) return <Alert type="error" message={String(convQuery.error)} />;
  const conv = convQuery.data;
  if (!conv) return null;

  const handleSend = () => {
    const content = messageInput.trim();
    if (!content) return;
    if (!conv.defaultGithubUrl && !githubUrlOverride) {
      alert('No GitHub URL set. Add one in the conversation settings.');
      return;
    }
    sendMutation.mutate(content);
  };

  return (
    <div className="chat-shell">
      {/* Chat header */}
      <div className="chat-header">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/conversations')}
          style={{ marginRight: 4 }}
        >
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conv.title}
          </div>
          {conv.defaultGithubUrl && (
            <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
              {conv.defaultGithubUrl.replace('https://github.com/', '')}
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

      {/* Compose bar — at top, above messages */}
      <div className="chat-compose">
        {showAdvanced && (
          <div style={{ marginBottom: 8 }}>
            <Input
              placeholder="GitHub URL override (leave blank to use conversation default)"
              value={githubUrlOverride}
              onChange={(e) => setGithubUrlOverride(e.target.value)}
              size="small"
            />
          </div>
        )}
        {sendMutation.error && (
          <Alert type="error" message={String(sendMutation.error)} style={{ marginBottom: 8 }} closable />
        )}
        <div className="compose-input-row">
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
        </div>
        <div className="compose-actions">
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

      {/* Thread — scrolls below compose, newest first */}
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
          const isExpanded = expandedIds.has(msg.id);
          const isLong = msg.content.split('\n').length > 6 || msg.content.length > 500;
          const job = msg.jobId ? jobMap[msg.jobId] : undefined;
          const artifacts = msg.jobId ? (artifactMap[msg.jobId] ?? []) : [];
          const isUser = msg.role === 'user';
          const prArtifact = artifacts.find((a) => a.kind === 'pr');
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
              {/* Two-column body: message text left, job details right */}
              <div style={{ display: 'flex', gap: 0 }}>

                {/* Left: role label + content */}
                <div style={{ flex: 1, minWidth: 0, borderRight: msg.jobId ? '1px solid var(--c-border-subtle)' : 'none' }}>
                  <div className="msg-card-header">
                    <span className="msg-card-role">
                      {isUser ? 'You' : msg.role === 'assistant' ? 'Assistant' : 'System'}
                    </span>
                    <span className="msg-card-time">
                      {new Date(msg.createdAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="msg-card-body">
                    <p
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.6,
                        ...(isExpanded ? {} : {
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 6,
                          WebkitBoxOrient: 'vertical',
                        }),
                      }}
                    >
                      {msg.content}
                    </p>
                    {isLong && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(msg.id); }}
                        style={{ marginTop: 6, padding: 0, fontSize: 12 }}
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Right: job details panel */}
                {msg.jobId && (
                  <div className="msg-job-panel">
                    {statusStyle && (
                      <span
                        className="msg-job-status"
                        style={{ background: statusStyle.bg, color: statusStyle.text }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.dot, flexShrink: 0 }} />
                        {job?.status.replace(/_/g, ' ') ?? 'pending'}
                      </span>
                    )}

                    <div className="msg-job-detail-row">
                      <span className="msg-job-label">Time</span>
                      <span className="msg-job-value">
                        {new Date(msg.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {job?.model && (
                      <div className="msg-job-detail-row">
                        <span className="msg-job-label">Model</span>
                        <span className="msg-job-value" style={{ fontSize: 11 }}>{job.model.split('/').pop()}</span>
                      </div>
                    )}

                    {job?.totalCostUsd != null && (
                      <div className="msg-job-detail-row">
                        <span className="msg-job-label">Cost</span>
                        <span className="msg-job-value">${job.totalCostUsd.toFixed(4)}</span>
                      </div>
                    )}

                    {job?.totalInputTokens != null && (
                      <div className="msg-job-detail-row">
                        <span className="msg-job-label">Tokens</span>
                        <span className="msg-job-value">{fmtK(job.totalInputTokens)}↑ {fmtK(job.totalOutputTokens)}↓</span>
                      </div>
                    )}

                    <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--c-primary)',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        View job →
                      </span>
                      {prArtifact?.url && (
                        <a
                          href={prArtifact.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: 'var(--c-success)', fontWeight: 600, textDecoration: 'none' }}
                        >
                          View PR →
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Load older — at bottom since older messages go below */}
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
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      Default GitHub URL
                    </div>
                    <Input
                      defaultValue={conv.defaultGithubUrl ?? ''}
                      onBlur={(e) => {
                        const val = e.target.value.trim() || null;
                        updateMutation.mutate({ defaultGithubUrl: val });
                      }}
                      placeholder="https://github.com/you/your-repo"
                    />
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      Default workflow
                    </div>
                    <select
                      className="select"
                      defaultValue={conv.defaultWorkflowId ?? ''}
                      onChange={(e) => {
                        updateMutation.mutate({ defaultWorkflowId: e.target.value || null });
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
                      defaultValue={conv.model ?? ''}
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
                  </div>
                </div>
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
    </div>
  );
}
