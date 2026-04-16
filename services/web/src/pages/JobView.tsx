import type { JobStatus } from '@shared/contracts';
import { useMutation } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Space, Tag, Timeline, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { JobPhaseBar } from '../components/JobPhaseBar';
import { PlanReviewCard } from '../components/PlanReviewCard';
import { rpc } from '../rpc';

interface StreamItem {
  id: string;
  seq?: number;
  event?: { kind: string; [k: string]: unknown };
  raw?: unknown;
}

/** Parse a raw SDK chunk into a human-readable {label, detail, color} */
function parseChunk(raw: unknown): { label: string; detail?: string; color: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;

  // System init message — show model + cwd
  if (msg.type === 'system') {
    const model = msg.model as string | undefined;
    const cwd = msg.cwd as string | undefined;
    return {
      label: `Session started${model ? ` · ${model}` : ''}`,
      detail: cwd ? `cwd: ${cwd}` : undefined,
      color: 'gray',
    };
  }

  // Assistant message — extract text and tool_use blocks
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
        // Show first meaningful input value
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

  // User message — tool results
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

/** Statuses where the live stream view is relevant */
const STREAM_STATUSES = new Set([
  'provisioning', 'preparing', 'building', 'plan_revising',
  'executing', 'checking', 'learning', 'publishing',
]);

/** Statuses where the plan review card is relevant */
const PLAN_REVIEW_STATUSES = new Set(['plan_ready', 'plan_review']);

export function JobView() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<StreamItem[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  const restartMutation = useMutation({
    mutationFn: () => rpc.jobs.restart({ jobId: jobId ?? '' }),
    onSuccess: ({ jobId: newJobId }) => navigate(`/jobs/${newJobId}`),
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

  const artifactsQuery = useQuery({
    queryKey: ['job', jobId, 'artifacts'],
    queryFn: () => rpc.jobs.listArtifacts({ jobId: jobId ?? '' }),
    enabled: !!jobId && ['publishing', 'learning', 'completed'].includes(jobQuery.data?.status ?? ''),
  });

  useEffect(() => {
    if (!jobId) return;

    // Clear stale events from a previous job when jobId changes
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
        let description: string | undefined;
        if (kind === 'status-changed') {
          const ev = item.event as { from?: string; to?: string };
          label = `${ev.from} → ${ev.to}`;
        } else if (kind === 'chunk') {
          const raw = (item.event as { raw?: unknown })?.raw;
          const parsed = parseChunk(raw);
          if (!parsed) return [];
          label = parsed.label;
          description = parsed.detail;
          return [{
            key: `${item.id}-${idx}`,
            color: parsed.color,
            children: (
              <>
                <Typography.Text strong>{label}</Typography.Text>
                {description && (
                  <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, marginTop: 2 }}>
                    <Typography.Text type="secondary">{description}</Typography.Text>
                  </div>
                )}
              </>
            ),
          }];
        } else if (kind === 'artifact-created') {
          const ev = item.event as { artifactKind?: string; url?: string };
          description = `${ev.artifactKind}: ${ev.url ?? ''}`;
        } else if (kind === 'failed') {
          const ev = item.event as { error?: string };
          description = ev.error;
        }
        return [{
          key: `${item.id}-${idx}`,
          color:
            kind === 'failed'
              ? 'red'
              : kind === 'completed'
                ? 'green'
                : kind === 'status-changed'
                  ? 'blue'
                  : 'gray',
          children: (
            <>
              <Typography.Text strong>{label}</Typography.Text>
              {description && (
                <div>
                  <Typography.Text type="secondary">{description}</Typography.Text>
                </div>
              )}
            </>
          ),
        }];
      }),
    [items],
  );

  // PR URL — prefer live stream (appears as soon as publishing finishes),
  // fall back to artifacts query (covers direct navigation to a post-publish job).
  const prUrlFromStream = useMemo(() => {
    for (const item of items) {
      const ev = item.event as { kind?: string; artifactKind?: string; url?: string } | undefined;
      if (ev?.kind === 'artifact-created' && ev.artifactKind === 'pr' && ev.url) return ev.url;
    }
    return undefined;
  }, [items]);

  if (jobQuery.isLoading) return <Card loading />;
  if (jobQuery.error) return <Alert type="error" message={String(jobQuery.error)} />;

  const job = jobQuery.data;
  if (!job) return null;

  const prUrl = prUrlFromStream ?? artifactsQuery.data?.find((a) => a.kind === 'pr')?.url;

  const showPlanReview = PLAN_REVIEW_STATUSES.has(job.status);
  const showStream = STREAM_STATUSES.has(job.status) || items.length > 0;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Phase progress bar */}
      <JobPhaseBar status={job.status as JobStatus} />

      {/* Job header */}
      <Card
        title={job.title}
        extra={
          <Space>
            <Tag color={STATUS_COLORS[job.status] ?? 'default'}>{job.status.toUpperCase()}</Tag>
            <Button
              size="small"
              onClick={() => restartMutation.mutate()}
              loading={restartMutation.isPending}
            >
              Restart
            </Button>
          </Space>
        }
      >
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="Repo">
            <a href={job.githubUrl} target="_blank" rel="noreferrer">
              {job.githubUrl}
            </a>{' '}
            @ {job.githubBranch}
          </Descriptions.Item>
          {job.description && (
            <Descriptions.Item label="Description">
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {job.description}
              </Typography.Paragraph>
            </Descriptions.Item>
          )}
          {job.githubCommitSha && (
            <Descriptions.Item label="Commit">{job.githubCommitSha.slice(0, 12)}</Descriptions.Item>
          )}
          {job.errorMessage && (
            <Descriptions.Item label="Error">
              <Typography.Text type="danger">{job.errorMessage}</Typography.Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* Plan review — shown when status is plan_ready or plan_review */}
      {showPlanReview && jobId && <PlanReviewCard jobId={jobId} />}

      {/* Terminal states */}
      {job.status === 'plan_rejected' && (
        <Alert
          type="error"
          message="Plan rejected"
          description="The plan was rejected. No code was changed."
        />
      )}

      {/* Live stream timeline */}
      {showStream && (
        <Card
          title="Live timeline"
          extra={
            <Space>
              {prUrl && (
                <Button type="primary" size="small" href={prUrl} target="_blank" rel="noreferrer">
                  PR created →
                </Button>
              )}
              {streamError && <Tag color="red">{streamError}</Tag>}
            </Space>
          }
        >
          {timelineItems.length === 0 ? (
            <Typography.Text type="secondary">waiting for events…</Typography.Text>
          ) : (
            <Timeline items={[...timelineItems].reverse()} />
          )}
        </Card>
      )}
    </Space>
  );
}
