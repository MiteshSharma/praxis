import type { JobStatus } from '@shared/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Collapse, Descriptions, Drawer, Dropdown, Modal, Space, Tag, Typography } from 'antd';
import Markdown from 'react-markdown';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { JobPhaseBar } from '../components/JobPhaseBar';
import { PlanReviewCard } from '../components/PlanReviewCard';
import { StepProgress } from '../components/StepProgress';
import { rpc } from '../rpc';

interface StreamItem {
  id: string;
  seq?: number;
  event?: { kind: string; [k: string]: unknown };
  raw?: unknown;
}

function parseChunk(raw: unknown): { label: string; detail?: string; color: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;

  if (msg.type === 'system') {
    const model = msg.model as string | undefined;
    const cwd = msg.cwd as string | undefined;
    return {
      label: `Session started${model ? ` · ${model}` : ''}`,
      detail: cwd ? `cwd: ${cwd}` : undefined,
      color: 'gray',
    };
  }

  if (msg.type === 'assistant') {
    const message = msg.message as { content?: unknown[] } | undefined;
    const blocks = message?.content ?? [];
    const parts: string[] = [];
    let color = 'blue';
    let label = 'Assistant';

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'text') {
        const text = String(b.text ?? '').trim();
        if (text) parts.push(text.slice(0, 300) + (text.length > 300 ? '…' : ''));
      } else if (b.type === 'tool_use') {
        const name = String(b.name ?? 'tool');
        const input = b.input as Record<string, unknown> | undefined;
        const inputStr = input
          ? Object.values(input)
              .slice(0, 2)
              .map((v) => String(v).slice(0, 120))
              .join(', ')
          : '';
        parts.push(`${name}(${inputStr})`);
        label = 'Tool call';
        color = 'orange';
      }
    }

    if (parts.length === 0) return null;
    return { label, detail: parts.join('\n'), color };
  }

  if (msg.type === 'user') {
    const message = msg.message as { content?: unknown[] } | undefined;
    const blocks = message?.content ?? [];
    const results: string[] = [];
    let hasError = false;

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_result') {
        if (b.is_error) hasError = true;
        const content = b.content;
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content
                  .map((c) => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>).text ?? '' : c))
                  .join('')
              : '';
        const trimmed = String(text).trim().slice(0, 200);
        if (trimmed) results.push(trimmed + (String(text).length > 200 ? '…' : ''));
      }
    }

    if (results.length === 0) return null;
    return {
      label: hasError ? 'Tool error' : 'Tool result',
      detail: results.join('\n'),
      color: hasError ? 'red' : 'green',
    };
  }

  return null;
}

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
  checking: 'processing',
  learning: 'purple',
  publishing: 'purple',
  completed: 'success',
  failed: 'error',
};

const STREAM_STATUSES = new Set([
  'provisioning', 'preparing', 'building', 'plan_revising',
  'executing', 'checking', 'learning', 'publishing',
]);

const PLAN_REVIEW_STATUSES = new Set(['plan_ready', 'plan_review']);

const PLAN_VIEWABLE_STATUSES = new Set([
  'executing', 'checking', 'learning', 'publishing',
  'completed', 'failed', 'plan_rejected',
]);

export function JobView() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<StreamItem[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [promptModal, setPromptModal] = useState<{ phase: string; text: string } | null>(null);
  const [showPlanDrawer, setShowPlanDrawer] = useState(false);
  const showPrompt = useCallback((phase: string, text: string) => setPromptModal({ phase, text }), []);

  const restartMutation = useMutation({
    mutationFn: () => rpc.jobs.restart({ jobId: jobId ?? '' }),
    onSuccess: ({ jobId: newJobId }) => navigate(`/jobs/${newJobId}`),
  });

  const resumeMutation = useMutation({
    mutationFn: () => rpc.jobs.resumeFromPlan({ jobId: jobId ?? '' }),
    onSuccess: () => jobQuery.refetch(),
  });

  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => rpc.jobs.get({ jobId: jobId ?? '' }),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      const terminal = status === 'completed' || status === 'failed' || status === 'plan_rejected';
      return terminal ? false : 3000;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => rpc.jobs.delete({ jobId: jobId ?? '' }),
    onSuccess: () => {
      const conversationId = jobQuery.data?.conversationId;
      navigate(conversationId ? `/conversations/${conversationId}` : '/conversations');
    },
  });

  const latestPlanQuery = useQuery({
    queryKey: ['job', jobId, 'plan'],
    queryFn: () => rpc.jobs.getLatestPlan({ jobId: jobId ?? '' }),
    enabled: !!jobId && PLAN_VIEWABLE_STATUSES.has(jobQuery.data?.status ?? ''),
  });

  const artifactsQuery = useQuery({
    queryKey: ['job', jobId, 'artifacts'],
    queryFn: () => rpc.jobs.listArtifacts({ jobId: jobId ?? '' }),
    enabled: !!jobId && ['publishing', 'learning', 'completed'].includes(jobQuery.data?.status ?? ''),
  });

  useEffect(() => {
    if (!jobId) return;
    setItems([]);
    setStreamError(null);

    const source = new EventSource(`http://localhost:3000/sse/jobs/${jobId}`);
    source.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setItems((prev) => {
          const next = [...prev, { id: e.lastEventId, ...parsed }];
          if (parsed.seq !== undefined) {
            next.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
          }
          return next;
        });
      } catch (err) {
        setStreamError(String(err));
      }
    };
    source.onerror = () => setStreamError('stream disconnected');
    return () => source.close();
  }, [jobId]);

  const timelineItems = useMemo(
    () =>
      items.flatMap((item, idx) => {
        const kind = item.event?.kind ?? 'chunk';
        let label = kind;
        let detail: string | undefined;
        let color = 'gray';

        if (kind === 'status-changed') {
          const ev = item.event as { from?: string; to?: string };
          label = `${ev.from} → ${ev.to}`;
          color = 'blue';
        } else if (kind === 'chunk') {
          const raw = (item.event as { raw?: unknown })?.raw;
          const parsed = parseChunk(raw);
          if (!parsed) return [];
          label = parsed.label;
          detail = parsed.detail;
          color = parsed.color;
        } else if (kind === 'prompt-snapshot') {
          const ev = item.event as { phase?: string; systemPrompt?: string };
          const phase = ev.phase ?? 'unknown';
          const text = ev.systemPrompt ?? '';
          return [{
            id: `${item.id}-${idx}`,
            color: 'purple',
            label: `System prompt (${phase})`,
            detail: undefined,
            isPrompt: true,
            phase,
            text,
          }];
        } else if (kind === 'artifact-created') {
          const ev = item.event as { artifactKind?: string; url?: string };
          detail = `${ev.artifactKind}: ${ev.url ?? ''}`;
          color = 'green';
        } else if (kind === 'failed') {
          const ev = item.event as { error?: string };
          detail = ev.error;
          color = 'red';
        } else if (kind === 'completed') {
          color = 'green';
        }

        return [{ id: `${item.id}-${idx}`, color, label, detail, isPrompt: false, phase: '', text: '' }];
      }),
    [items],
  );

  const prUrlFromStream = useMemo(() => {
    for (const item of items) {
      const ev = item.event as { kind?: string; artifactKind?: string; url?: string } | undefined;
      if (ev?.kind === 'artifact-created' && ev.artifactKind === 'pr' && ev.url) return ev.url;
    }
    return undefined;
  }, [items]);

  if (jobQuery.isLoading) return (
    <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
      <span className="muted">Loading…</span>
    </div>
  );
  if (jobQuery.error) return <Alert type="error" message={String(jobQuery.error)} />;

  const job = jobQuery.data;
  if (!job) return null;

  const prUrl = prUrlFromStream ?? artifactsQuery.data?.find((a) => a.kind === 'pr')?.url;
  const showPlanReview = PLAN_REVIEW_STATUSES.has(job.status);
  const showStream = STREAM_STATUSES.has(job.status) || items.length > 0;

  const handleDelete = () => {
    Modal.confirm({
      title: 'Delete this job?',
      content: 'This cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => deleteMutation.mutate(),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── Static top section ─────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, padding: '16px 28px 0', background: 'var(--c-bg)' }}>
        {/* Breadcrumb */}
        {job.conversationId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(`/conversations/${job.conversationId}`)}
            style={{ paddingLeft: 0, marginBottom: 12 }}
          >
            ← Back to conversation
          </button>
        )}

        {/* Phase bar */}
        <div style={{ marginBottom: 14 }}>
          <JobPhaseBar status={job.status as JobStatus} />
        </div>

        {/* Job header */}
        <div
          style={{
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            borderRadius: 10,
            overflow: 'hidden',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: '1px solid var(--c-border-subtle)',
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.title}
            </div>
            <Space size={6}>
              <Tag color={STATUS_COLORS[job.status] ?? 'default'}>{job.status.toUpperCase()}</Tag>
              {latestPlanQuery.data && (
                <Button size="small" onClick={() => setShowPlanDrawer(true)}>View Plan</Button>
              )}
              {job.status === 'failed' && latestPlanQuery.data?.status === 'approved' && (
                <Button size="small" type="primary" onClick={() => resumeMutation.mutate()} loading={resumeMutation.isPending}>
                  Resume from plan
                </Button>
              )}
              <Button size="small" onClick={() => restartMutation.mutate()} loading={restartMutation.isPending}>
                Restart
              </Button>
              <Dropdown
                menu={{ items: [{ key: 'delete', label: 'Delete job', danger: true, onClick: handleDelete }] }}
                trigger={['click']}
              >
                <Button size="small">···</Button>
              </Dropdown>
            </Space>
          </div>

          <div style={{ padding: '10px 16px' }}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="Repo">
                <a href={job.githubUrl} target="_blank" rel="noreferrer">{job.githubUrl}</a>
                {' '}@ {job.githubBranch}
              </Descriptions.Item>
              {job.githubCommitSha && (
                <Descriptions.Item label="Commit">{job.githubCommitSha.slice(0, 12)}</Descriptions.Item>
              )}
              {job.totalCostUsd != null && (
                <Descriptions.Item label="Cost">
                  <Space size="middle">
                    <Typography.Text strong>${job.totalCostUsd.toFixed(4)}</Typography.Text>
                    {job.totalInputTokens != null && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {job.totalInputTokens.toLocaleString()} in · {(job.totalOutputTokens ?? 0).toLocaleString()} out
                      </Typography.Text>
                    )}
                  </Space>
                </Descriptions.Item>
              )}
              {job.description && (
                <Descriptions.Item label="Description" span={2}>
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {job.description}
                  </Typography.Paragraph>
                </Descriptions.Item>
              )}
              {job.errorMessage && (
                <Descriptions.Item label="Error" span={2}>
                  <Typography.Text type="danger">{job.errorMessage}</Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>
        </div>

        {/* Plan review */}
        {showPlanReview && jobId && <div style={{ marginBottom: 14 }}><PlanReviewCard jobId={jobId} /></div>}

        {/* Rejected */}
        {job.status === 'plan_rejected' && (
          <Alert type="error" message="Plan rejected" description="The plan was rejected. No code was changed." style={{ marginBottom: 14 }} />
        )}

        {/* PR banner */}
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              background: 'var(--c-success-bg)',
              border: '1px solid #A9EFC5',
              borderRadius: 10,
              color: 'var(--c-success)',
              fontWeight: 600,
              textDecoration: 'none',
              fontSize: 14,
              marginBottom: 14,
            }}
          >
            <span>Pull request created →</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-2)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prUrl}</span>
          </a>
        )}
      </div>

      {/* ── Fills remaining screen ──────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 0, padding: '0 28px 0' }}>

        {/* Timeline — grows to fill height */}
        {showStream && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: 28 }}>
            <div
              style={{
                flex: 1,
                background: 'var(--c-surface)',
                border: '1px solid var(--c-border)',
                borderRadius: 10,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--c-border-subtle)',
                  background: 'var(--c-surface-2)',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>Live timeline</span>
                {streamError && <Tag color="red">{streamError}</Tag>}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
                {timelineItems.length === 0 ? (
                  <p className="muted small" style={{ padding: '8px 0' }}>Waiting for events…</p>
                ) : (
                  <div className="timeline">
                    {[...timelineItems].reverse().map((item, idx) => (
                      <div key={item.id} className="timeline-item">
                        <div className="timeline-dot-col">
                          <div
                            className="timeline-dot"
                            style={{
                              background:
                                item.color === 'green' ? 'var(--c-success)'
                                : item.color === 'red' ? 'var(--c-error)'
                                : item.color === 'blue' ? 'var(--c-primary)'
                                : item.color === 'orange' ? 'var(--c-warning)'
                                : item.color === 'purple' ? '#7C3AED'
                                : 'var(--c-border)',
                            }}
                          />
                          {idx < timelineItems.length - 1 && <div className="timeline-line" />}
                        </div>
                        <div className="timeline-content">
                          <div className="timeline-label">
                            {item.label}
                            {item.isPrompt && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ marginLeft: 6, padding: '0 6px', fontSize: 11 }}
                                onClick={() => showPrompt(item.phase, item.text)}
                              >
                                View
                              </button>
                            )}
                          </div>
                          {item.detail && <div className="timeline-detail">{item.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Steps sidebar — same height as timeline */}
        {jobId && (
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', paddingBottom: 28, paddingLeft: showStream ? 16 : 0 }}>
            <div
              style={{
                flex: 1,
                background: 'var(--c-surface)',
                border: '1px solid var(--c-border)',
                borderRadius: 10,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--c-border-subtle)',
                  background: 'var(--c-surface-2)',
                  fontWeight: 600,
                  fontSize: 12,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.06em',
                  color: 'var(--c-text-3)',
                  flexShrink: 0,
                }}
              >
                Steps
              </div>
              <div style={{ overflowY: 'auto', padding: '10px 12px' }}>
                <StepProgress
                  jobId={jobId}
                  refetchInterval={
                    job.status === 'completed' || job.status === 'failed' ? undefined : 3000
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Plan viewer drawer */}
      <Drawer
        title={latestPlanQuery.data?.data.title ?? 'Plan'}
        open={showPlanDrawer}
        onClose={() => setShowPlanDrawer(false)}
        width={640}
      >
        {latestPlanQuery.data && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Summary">
                {latestPlanQuery.data.data.summary}
              </Descriptions.Item>
              {latestPlanQuery.data.data.affectedPaths.length > 0 && (
                <Descriptions.Item label="Affected files">
                  {latestPlanQuery.data.data.affectedPaths.map((p) => (
                    <Tag key={p} style={{ marginBottom: 2 }}>{p}</Tag>
                  ))}
                </Descriptions.Item>
              )}
              {(latestPlanQuery.data.data.risks ?? []).length > 0 && (
                <Descriptions.Item label="Risks">
                  {(latestPlanQuery.data.data.risks ?? []).map((r, i) => (
                    <Tag color="orange" key={i} style={{ marginBottom: 2 }}>{r}</Tag>
                  ))}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Collapse ghost items={[{
              key: 'body',
              label: 'Full plan details',
              children: (
                <div className="prose" style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <Markdown>{latestPlanQuery.data.data.bodyMarkdown}</Markdown>
                </div>
              ),
            }]} />

            <Typography.Title level={5}>Steps</Typography.Title>
            {latestPlanQuery.data.data.steps.map((step) => (
              <Space key={step.id} align="start">
                <Tag color={step.status === 'done' ? 'success' : step.status === 'skipped' ? 'default' : 'blue'}>
                  {step.status}
                </Tag>
                <Typography.Text>{step.content}</Typography.Text>
              </Space>
            ))}
          </Space>
        )}
      </Drawer>

      {/* System prompt modal */}
      <Modal
        title={`System prompt — ${promptModal?.phase}`}
        open={!!promptModal}
        onCancel={() => setPromptModal(null)}
        footer={null}
        width={720}
      >
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            maxHeight: '60vh',
            overflowY: 'auto',
            background: 'var(--c-surface-2)',
            padding: 12,
            borderRadius: 6,
            margin: 0,
            fontFamily: "'Fira Code', 'Consolas', monospace",
          }}
        >
          {promptModal?.text}
        </pre>
      </Modal>
    </div>
  );
}
