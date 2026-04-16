import { useQuery } from '@tanstack/react-query';
import { Card, Spin, Tag, Tooltip, Typography } from 'antd';
import { rpc } from '../rpc';

const STATUS_ICONS: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  running: '→',
  pending: '○',
  skipped: '⊘',
};

const STATUS_COLORS: Record<string, string> = {
  passed: '#52c41a',
  failed: '#ff4d4f',
  running: '#1677ff',
  pending: '#8c8c8c',
  skipped: '#bfbfbf',
};

interface StepProgressProps {
  jobId: string;
  /** Polling interval in ms. Stops polling on terminal job statuses. */
  refetchInterval?: number;
}

export function StepProgress({ jobId, refetchInterval = 3000 }: StepProgressProps) {
  const stepsQuery = useQuery({
    queryKey: ['job', jobId, 'steps'],
    queryFn: () => rpc.jobs.listSteps({ jobId }),
    enabled: !!jobId,
    refetchInterval,
  });

  if (stepsQuery.isLoading) return <Spin size="small" />;
  if (!stepsQuery.data?.length) return null;

  const steps = stepsQuery.data;

  return (
    <Card title="Steps" size="small">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step) => {
          const icon = STATUS_ICONS[step.status] ?? '?';
          const color = STATUS_COLORS[step.status] ?? '#8c8c8c';
          const durationMs =
            step.startedAt && step.completedAt
              ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
              : null;
          const durationStr = durationMs != null ? formatDuration(durationMs) : null;

          const isRetry = !!step.retryOf;

          return (
            <div
              key={step.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                paddingLeft: isRetry ? 24 : 0,
              }}
            >
              <span style={{ color, fontWeight: 600, minWidth: 16 }}>{icon}</span>
              <Typography.Text
                style={{ flex: 1 }}
                type={step.status === 'failed' ? 'danger' : undefined}
              >
                {step.name}
                {isRetry && (
                  <Tag color="orange" style={{ marginLeft: 6, fontSize: 11 }}>
                    retry
                  </Tag>
                )}
              </Typography.Text>
              <Tag color={kindColor(step.kind)} style={{ fontSize: 11 }}>
                {step.kind}
              </Tag>
              {durationStr && (
                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {durationStr}
                </Typography.Text>
              )}
              {step.status === 'failed' && step.errorMessage && (
                <Tooltip title={step.errorMessage}>
                  <Typography.Text type="danger" style={{ fontSize: 11 }}>
                    ⚠
                  </Typography.Text>
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'plan':
      return 'blue';
    case 'execute':
      return 'green';
    case 'check':
      return 'purple';
    default:
      return 'default';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
