import type { JobStatus, ReviewCommentDto, TimelineEventDto } from '@shared/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Collapse, Descriptions, Drawer, Dropdown, Input, Modal, Space, Tag, Typography } from 'antd';
import Markdown from 'react-markdown';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileChangesSidebar } from '../components/FileChangesSidebar';
import type { FileChange } from '../components/FileChangesSidebar';
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

type ParsedChunk =
  | { kind: 'text'; label: string; detail: string; color: string }
  | { kind: 'tool'; name: string; input: Record<string, unknown>; color: string }
  | { kind: 'tool_result'; text: string; isError: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'system'; label: string };

function parseChunk(raw: unknown): ParsedChunk[] {
  if (!raw || typeof raw !== 'object') return [];
  const msg = raw as Record<string, unknown>;

  if (msg.type === 'system') {
    const model = msg.model as string | undefined;
    return [{ kind: 'system', label: `Session started${model ? ` · ${model}` : ''}` }];
  }

  if (msg.type === 'assistant') {
    const blocks = (msg.message as { content?: unknown[] } | undefined)?.content ?? [];
    const out: ParsedChunk[] = [];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;

      if (b.type === 'thinking') {
        const text = String(b.thinking ?? '').trim();
        if (text) out.push({ kind: 'thinking', text });
      } else if (b.type === 'text') {
        const text = String(b.text ?? '').trim();
        if (text) out.push({ kind: 'text', label: 'Assistant', detail: text, color: 'blue' });
      } else if (b.type === 'tool_use') {
        out.push({ kind: 'tool', name: String(b.name ?? 'tool'), input: (b.input as Record<string, unknown>) ?? {}, color: 'orange' });
      }
    }
    return out;
  }

  if (msg.type === 'user') {
    const blocks = (msg.message as { content?: unknown[] } | undefined)?.content ?? [];
    const out: ParsedChunk[] = [];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type !== 'tool_result') continue;
      const isError = !!b.is_error;
      const content = b.content;
      const rawText =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((c) => (typeof c === 'object' && c !== null ? (c as Record<string, unknown>).text ?? '' : c)).join('')
            : '';
      // Phase 2: structured JSON from executor
      let displayText = rawText;
      try {
        const parsed = JSON.parse(rawText) as { path?: string; status?: string };
        if (parsed.path && parsed.status) {
          displayText = parsed.status === 'added' ? `Created ${parsed.path}` : `Modified ${parsed.path}`;
        }
      } catch { /* not JSON */ }
      const trimmed = displayText.trim().slice(0, 300);
      if (trimmed) out.push({ kind: 'tool_result', text: trimmed + (displayText.length > 300 ? '…' : ''), isError });
    }
    return out;
  }

  return [];
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'default',
  provisioning: '#5B5BD6',
  preparing: '#5B5BD6',
  building: '#5B5BD6',
  plan_ready: 'cyan',
  plan_review: 'orange',
  plan_revising: '#5B5BD6',
  plan_rejected: 'error',
  executing: '#5B5BD6',
  checking: '#5B5BD6',
  learning: 'purple',
  publishing: 'purple',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

const STREAM_STATUSES = new Set([
  'provisioning', 'preparing', 'building', 'plan_revising',
  'executing', 'checking', 'learning', 'publishing',
]);

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'plan_rejected']);

function normalizeTimelineEvents(events: TimelineEventDto[]): StreamItem[] {
  return events.map((e) => {
    const kind = e.type;
    const eventPayload =
      kind === 'chunk'
        ? { kind: 'chunk', raw: (e.payload as { chunk?: unknown }).chunk }
        : { kind, ...e.payload };
    return { id: `pg-${e.seq}`, seq: e.seq, event: eventPayload };
  });
}

function extractFileChanges(items: StreamItem[]): Map<string, FileChange> {
  const changes = new Map<string, FileChange>();
  // Fallback cwd: used only for events stored before the backend stripping was
  // deployed (absolute paths already in Postgres).  New events arrive pre-stripped.
  let fallbackCwd = '';

  // macOS: /var is a symlink to /private/var — normalise before prefix-stripping
  const depriv = (s: string) => (s.startsWith('/private/') ? s.slice('/private'.length) : s);
  function toRelative(p: string): string {
    if (!p.startsWith('/') || !fallbackCwd) return p;
    const pNorm = depriv(p);
    const wdNorm = depriv(fallbackCwd);
    return pNorm.startsWith(wdNorm) ? pNorm.slice(wdNorm.length).replace(/^\//, '') : p;
  }

  for (const item of items) {
    if (item.event?.kind !== 'chunk') continue;
    const raw = (item.event as { raw?: unknown }).raw;
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;

    if (msg.type === 'system') {
      fallbackCwd = (msg.cwd as string | undefined) ?? fallbackCwd;
      continue;
    }

    // tool_use: detect write/edit calls from both providers.
    // Paths are stripped by the backend; toRelative() handles any pre-fix events.
    //   Claude SDK  → tool names 'Write' / 'Edit', path field 'file_path'
    //   OpenAI/Demo → tool names 'write_file' / 'edit_file', path field 'path'
    if (msg.type === 'assistant') {
      const blocks = (msg.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type !== 'tool_use') continue;
        const isWrite = b.name === 'Write' || b.name === 'write_file';
        const isEdit = b.name === 'Edit' || b.name === 'edit_file';
        if (!isWrite && !isEdit) continue;
        const input = b.input as Record<string, unknown> | undefined;
        const rawPath = (input?.file_path ?? input?.path) as string | undefined;
        if (!rawPath) continue;
        const path = toRelative(rawPath);
        const existing = changes.get(path);
        changes.set(path, {
          path,
          status: existing?.status ?? 'modified',
          touchCount: (existing?.touchCount ?? 0) + 1,
        });
      }
    }

    // tool_result: Phase 2 — structured JSON from executor updates added/modified status
    if (msg.type === 'user') {
      const blocks = (msg.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type !== 'tool_result' || b.is_error) continue;
        const text = typeof b.content === 'string' ? b.content : '';
        try {
          const parsed = JSON.parse(text) as { path?: string; status?: string };
          if (parsed.path && parsed.status) {
            const relPath = toRelative(parsed.path);
            const existing = changes.get(relPath);
            if (existing) {
              changes.set(relPath, { ...existing, status: parsed.status === 'added' ? 'added' : 'modified' });
            }
          }
        } catch {
          // not structured JSON — Phase 1, no update needed
        }
      }
    }
  }

  return changes;
}

function ExpandableText({ text, color }: { text: string; color?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="timeline-detail" style={{ whiteSpace: 'pre-wrap', color }}>
      {expanded ? text : text.slice(0, 120).trimEnd()}
      {!expanded && '… '}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ padding: '0 4px', fontSize: 11, verticalAlign: 'baseline' }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'less' : 'more'}
      </button>
    </div>
  );
}

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

  const [reviewModal, setReviewModal] = useState(false);
  const [followupTask, setFollowupTask] = useState('');

  const cancelMutation = useMutation({
    mutationFn: () => rpc.jobs.cancel({ jobId: jobId ?? '' }),
    onSuccess: () => jobQuery.refetch(),
  });

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
      return status && TERMINAL_STATUSES.has(status) ? false : 3000;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => rpc.jobs.delete({ jobId: jobId ?? '' }),
    onSuccess: () => {
      const sessionId = jobQuery.data?.sessionId;
      navigate(sessionId ? `/sessions/${sessionId}` : '/sessions');
    },
  });

  const latestPlanQuery = useQuery({
    queryKey: ['job', jobId, 'plan'],
    queryFn: () => rpc.jobs.planGet({ jobId: jobId ?? '' }),
    enabled: !!jobId && PLAN_VIEWABLE_STATUSES.has(jobQuery.data?.status ?? ''),
  });

  const artifactsQuery = useQuery({
    queryKey: ['job', jobId, 'artifacts'],
    queryFn: () => rpc.jobs.listArtifacts({ jobId: jobId ?? '' }),
    enabled: !!jobId && ['publishing', 'learning', 'completed'].includes(jobQuery.data?.status ?? ''),
  });

  const reviewCommentsQuery = useQuery({
    queryKey: ['job', jobId, 'reviewComments'],
    queryFn: () => rpc.jobs.getReviewComments({ jobId: jobId ?? '' }),
    enabled: !!jobId && reviewModal,
  });

  const createFollowupMutation = useMutation({
    mutationFn: () => rpc.jobs.createFollowup({ jobId: jobId ?? '', task: followupTask }),
    onSuccess: ({ jobId: newJobId }) => {
      setReviewModal(false);
      setFollowupTask('');
      navigate(`/jobs/${newJobId}`);
    },
  });

  const isTerminal = TERMINAL_STATUSES.has(jobQuery.data?.status ?? '');

  const timelineQuery = useQuery({
    queryKey: ['job', jobId, 'timeline'],
    queryFn: () => rpc.timeline.get({ jobId: jobId ?? '', limit: 500 }),
    enabled: !!jobId && isTerminal,
  });

  useEffect(() => {
    if (!jobId || isTerminal) return;
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
  }, [jobId, isTerminal]);

  const resolvedItems = useMemo(
    () => isTerminal ? normalizeTimelineEvents(timelineQuery.data?.events ?? []) : items,
    [isTerminal, timelineQuery.data, items],
  );

  const fileChanges = useMemo(() => extractFileChanges(resolvedItems), [resolvedItems]);

  type TLItem =
    | { itemType: 'default'; id: string; color: string; label: string; detail?: string; isPrompt: boolean; phase: string; text: string }
    | { itemType: 'tool'; id: string; name: string; input: Record<string, unknown> }
    | { itemType: 'tool_result'; id: string; text: string; isError: boolean }
    | { itemType: 'thinking'; id: string; text: string };

  const timelineItems = useMemo(
    () =>
      resolvedItems.flatMap((item, idx) => {
        const kind = item.event?.kind ?? 'chunk';

        if (kind === 'status-changed') {
          const ev = item.event as { from?: string; to?: string };
          return [{ itemType: 'default' as const, id: `${item.id}-${idx}`, color: 'blue', label: `${ev.from} → ${ev.to}`, isPrompt: false, phase: '', text: '' }];
        }

        if (kind === 'chunk') {
          const raw = (item.event as { raw?: unknown })?.raw;
          const chunks = parseChunk(raw);
          return chunks.map((c, ci): TLItem => {
            const id = `${item.id}-${idx}-${ci}`;
            if (c.kind === 'tool') return { itemType: 'tool', id, name: c.name, input: c.input };
            if (c.kind === 'tool_result') return { itemType: 'tool_result', id, text: c.text, isError: c.isError };
            if (c.kind === 'thinking') return { itemType: 'thinking', id, text: c.text };
            if (c.kind === 'system') return { itemType: 'default', id, color: 'gray', label: c.label, isPrompt: false, phase: '', text: '' };
            // text
            return { itemType: 'default', id, color: c.color, label: c.label, detail: c.detail, isPrompt: false, phase: '', text: '' };
          });
        }

        if (kind === 'prompt-snapshot') {
          const ev = item.event as { phase?: string; systemPrompt?: string };
          const phase = ev.phase ?? 'unknown';
          return [{ itemType: 'default' as const, id: `${item.id}-${idx}`, color: 'purple', label: `System prompt (${phase})`, isPrompt: true, phase, text: ev.systemPrompt ?? '' }];
        }

        if (kind === 'artifact-created') {
          const ev = item.event as { artifactKind?: string; url?: string };
          return [{ itemType: 'default' as const, id: `${item.id}-${idx}`, color: 'green', label: kind, detail: `${ev.artifactKind}: ${ev.url ?? ''}`, isPrompt: false, phase: '', text: '' }];
        }

        if (kind === 'failed') {
          const ev = item.event as { error?: string };
          return [{ itemType: 'default' as const, id: `${item.id}-${idx}`, color: 'red', label: kind, detail: ev.error, isPrompt: false, phase: '', text: '' }];
        }

        if (kind === 'completed') {
          return [{ itemType: 'default' as const, id: `${item.id}-${idx}`, color: 'green', label: kind, isPrompt: false, phase: '', text: '' }];
        }

        return [{ itemType: 'default' as const, id: `${item.id}-${idx}`, color: 'gray', label: kind, isPrompt: false, phase: '', text: '' }];
      }),
    [resolvedItems],
  );

  const prUrlFromStream = useMemo(() => {
    for (const item of resolvedItems) {
      const ev = item.event as { kind?: string; artifactKind?: string; url?: string } | undefined;
      if (ev?.kind === 'artifact-created' && ev.artifactKind === 'pr' && ev.url) return ev.url;
    }
    return undefined;
  }, [resolvedItems]);

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
  const showStream = STREAM_STATUSES.has(job.status) || isTerminal || items.length > 0;

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
        {job.sessionId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(`/sessions/${job.sessionId}`)}
            style={{ paddingLeft: 0, marginBottom: 12 }}
          >
            ← Back to conversation
          </button>
        )}
        {job.parentJobId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(`/jobs/${job.parentJobId}`)}
            style={{ paddingLeft: 0, marginBottom: 12 }}
          >
            ← Back to parent job
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
              {STREAM_STATUSES.has(job.status) && (
                <Button
                  size="small"
                  danger
                  onClick={() => cancelMutation.mutate()}
                  loading={cancelMutation.isPending}
                >
                  Stop
                </Button>
              )}
              {isTerminal && (
                <Button size="small" onClick={() => restartMutation.mutate()} loading={restartMutation.isPending}>
                  Restart
                </Button>
              )}
              <Dropdown
                menu={{ items: [
                  { key: 'export-timeline', label: 'Export Timeline', disabled: !isTerminal, onClick: () => window.open(`http://localhost:3000/jobs/${jobId}/audit`, '_blank') },
                  { key: 'delete', label: 'Delete job', danger: true, onClick: handleDelete },
                ] }}
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
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  flex: 1,
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
                  minWidth: 0,
                }}
              >
                <span>Pull request created →</span>
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-2)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prUrl}</span>
              </a>
              {job.status === 'completed' && (
                <Button onClick={() => setReviewModal(true)}>Fix Review Comments</Button>
              )}
            </div>
          </div>
        )}

        {/* Fix review comments modal */}
        <Modal
          title="Fix Review Comments"
          open={reviewModal}
          onCancel={() => { setReviewModal(false); setFollowupTask(''); }}
          onOk={() => createFollowupMutation.mutate()}
          okText="Create follow-up job"
          confirmLoading={createFollowupMutation.isPending}
          okButtonProps={{ disabled: !followupTask.trim() }}
          width={640}
        >
          {reviewCommentsQuery.isLoading && <p className="muted small">Loading review comments…</p>}
          {reviewCommentsQuery.data && reviewCommentsQuery.data.length > 0 && (
            <div style={{ marginBottom: 16, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: 8, padding: '8px 12px' }}>
              {reviewCommentsQuery.data.map((c: ReviewCommentDto) => (
                <div key={c.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--c-border-subtle)' }}>
                  {c.path && (
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>
                      {c.path}{c.line ? `:${c.line}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                  <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>
                    {c.user ?? 'unknown'} · {new Date(c.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
          {reviewCommentsQuery.data?.length === 0 && (
            <Alert type="info" message="No review comments found on this PR." style={{ marginBottom: 16 }} />
          )}
          <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 13 }}>What should the agent fix?</div>
          <Input.TextArea
            rows={4}
            placeholder="Describe what changes to make based on the review comments above, or type your own instructions…"
            value={followupTask}
            onChange={(e) => setFollowupTask(e.target.value)}
          />
          {createFollowupMutation.error && (
            <Alert type="error" message={String(createFollowupMutation.error)} style={{ marginTop: 12 }} />
          )}
        </Modal>
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
                <span style={{ fontWeight: 600, fontSize: 13 }}>{isTerminal ? 'Timeline' : 'Live timeline'}</span>
                {streamError && <Tag color="red">{streamError}</Tag>}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
                {timelineItems.length === 0 ? (
                  <p className="muted small" style={{ padding: '8px 0' }}>
                    {isTerminal ? 'No timeline events recorded.' : 'Waiting for events…'}
                  </p>
                ) : (
                  <div className="timeline">
                    {[...timelineItems].reverse().map((item, idx) => {
                      // Tool call — distinct card, no dot
                      if (item.itemType === 'tool') {
                        const fileKey = (item.input.file_path ?? item.input.path) as string | undefined;
                        const displayPath = fileKey ?? Object.values(item.input)[0];
                        return (
                          <div key={item.id} className="timeline-item timeline-item--tool">
                            <div className="timeline-dot-col">
                              <div className="timeline-dot" style={{ background: 'var(--c-warning)', width: 7, height: 7 }} />
                              {idx < timelineItems.length - 1 && <div className="timeline-line" />}
                            </div>
                            <div className="timeline-content" style={{ width: '100%' }}>
                              <details style={{ width: '100%' }}>
                                <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>{item.name}</Tag>
                                  {displayPath && (
                                    <span style={{ fontSize: 12, color: 'var(--c-text-2)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {String(displayPath)}
                                    </span>
                                  )}
                                </summary>
                                <pre style={{ margin: '6px 0 0', fontSize: 11, background: 'var(--c-surface-2)', borderRadius: 4, padding: '6px 8px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                  {JSON.stringify(item.input, null, 2)}
                                </pre>
                              </details>
                            </div>
                          </div>
                        );
                      }

                      // Tool result
                      if (item.itemType === 'tool_result') {
                        const color = item.isError ? 'var(--c-error)' : undefined;
                        return (
                          <div key={item.id} className="timeline-item">
                            <div className="timeline-dot-col">
                              <div className="timeline-dot" style={{ background: item.isError ? 'var(--c-error)' : 'var(--c-success)', width: 7, height: 7 }} />
                              {idx < timelineItems.length - 1 && <div className="timeline-line" />}
                            </div>
                            <div className="timeline-content" style={{ width: '100%' }}>
                              {item.text.length > 120
                                ? (
                                  <ExpandableText text={item.text} color={color} />
                                )
                                : <div className="timeline-detail" style={{ color }}>{item.text}</div>
                              }
                            </div>
                          </div>
                        );
                      }

                      // Thinking block — collapsed by default
                      if (item.itemType === 'thinking') {
                        return (
                          <div key={item.id} className="timeline-item">
                            <div className="timeline-dot-col">
                              <div className="timeline-dot" style={{ background: '#7C3AED', width: 7, height: 7 }} />
                              {idx < timelineItems.length - 1 && <div className="timeline-line" />}
                            </div>
                            <div className="timeline-content" style={{ width: '100%' }}>
                              <details>
                                <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 12, color: '#7C3AED', fontWeight: 500 }}>Thinking</span>
                                  <span className="muted small">· {item.text.length > 60 ? item.text.slice(0, 60) + '…' : item.text}</span>
                                </summary>
                                <pre style={{ margin: '6px 0 0', fontSize: 11, background: 'var(--c-surface-2)', borderRadius: 4, padding: '6px 8px', overflowX: 'auto', whiteSpace: 'pre-wrap', color: 'var(--c-text-2)', fontFamily: 'inherit' }}>
                                  {item.text}
                                </pre>
                              </details>
                            </div>
                          </div>
                        );
                      }

                      // Default (status, text, prompt, other)
                      return (
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
                            {item.detail && (
                              item.label === 'Assistant' && item.detail.length > 120
                                ? (
                                  <ExpandableText text={item.detail} />
                                )
                                : <div className="timeline-detail">{item.detail}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Right column — steps + file changes stacked */}
        {jobId && (
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 28, paddingLeft: showStream ? 16 : 0 }}>

            {/* Steps panel */}
            <div
              style={{
                flexShrink: 0,
                ...(fileChanges.size > 0 ? { maxHeight: 260 } : { flex: 1 }),
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

            {/* File changes panel — appears once the agent starts writing files */}
            {fileChanges.size > 0 && (
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
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Files</span>
                  <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--c-text-3)' }}>
                    {fileChanges.size}
                  </span>
                </div>
                <div style={{ overflowY: 'auto', padding: '10px 12px' }}>
                  <FileChangesSidebar fileChanges={fileChanges} />
                </div>
              </div>
            )}
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
