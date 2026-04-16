import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Space, Tag, Timeline, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { rpc } from '../rpc';

interface StreamItem {
  id: string;
  seq?: number;
  event?: { kind: string; [k: string]: unknown };
  raw?: unknown;
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'default',
  provisioning: 'blue',
  preparing: 'blue',
  executing: 'processing',
  finalizing: 'purple',
  completed: 'success',
  failed: 'error',
};

export function JobView() {
  const { jobId } = useParams<{ jobId: string }>();
  const [items, setItems] = useState<StreamItem[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => rpc.jobs.get({ jobId: jobId ?? '' }),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'completed' || status === 'failed' || status === 'plan_rejected'
        ? false
        : 3000;
    },
  });

  const artifactsQuery = useQuery({
    queryKey: ['job', jobId, 'artifacts'],
    queryFn: () => rpc.jobs.listArtifacts({ jobId: jobId ?? '' }),
    enabled: !!jobId && jobQuery.data?.status === 'completed',
  });

  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(`http://localhost:3000/sse/jobs/${jobId}`);
    source.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setItems((prev) => {
          const next = [...prev, { id: e.lastEventId, ...parsed }];
          if (parsed.seq !== undefined) {
            // dedup/order by seq
            next.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
          }
          return next;
        });
      } catch (err) {
        setStreamError(String(err));
      }
    };
    source.onerror = () => {
      setStreamError('stream disconnected');
    };
    return () => source.close();
  }, [jobId]);

  const timelineItems = useMemo(
    () =>
      items.map((item, idx) => {
        const kind = item.event?.kind ?? 'chunk';
        let label = kind;
        let description: string | undefined;
        if (kind === 'status-changed') {
          const ev = item.event as { from?: string; to?: string };
          label = `${ev.from} → ${ev.to}`;
        } else if (kind === 'chunk') {
          const raw = (item.event as { raw?: unknown })?.raw;
          description =
            typeof raw === 'string'
              ? raw
              : raw && typeof raw === 'object'
                ? JSON.stringify(raw).slice(0, 240)
                : undefined;
        } else if (kind === 'artifact-created') {
          const ev = item.event as { artifactKind?: string; url?: string };
          description = `${ev.artifactKind}: ${ev.url ?? ''}`;
        } else if (kind === 'failed') {
          const ev = item.event as { error?: string };
          description = ev.error;
        }
        return {
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
        };
      }),
    [items],
  );

  if (jobQuery.isLoading) return <Card loading />;
  if (jobQuery.error) return <Alert type="error" message={String(jobQuery.error)} />;

  const job = jobQuery.data;
  if (!job) return null;

  const prArtifact = artifactsQuery.data?.find((a) => a.kind === 'pr');

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title={job.title}
        extra={<Tag color={STATUS_COLORS[job.status] ?? 'default'}>{job.status.toUpperCase()}</Tag>}
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

      {prArtifact?.url && (
        <Card>
          <Button type="primary" href={prArtifact.url} target="_blank" rel="noreferrer">
            View PR on GitHub →
          </Button>
        </Card>
      )}

      <Card title="Live timeline" extra={streamError && <Tag color="red">{streamError}</Tag>}>
        {timelineItems.length === 0 ? (
          <Typography.Text type="secondary">waiting for events...</Typography.Text>
        ) : (
          <Timeline items={timelineItems} />
        )}
      </Card>
    </Space>
  );
}
