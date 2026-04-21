import { useQuery } from '@tanstack/react-query';
import { Spin, Tag, Tooltip } from 'antd';
import { rpc } from '../rpc';

const STEP_STATE: Record<string, { icon: string; color: string; dotClass: string }> = {
  passed:  { icon: '✓', color: 'var(--c-success)', dotClass: 'done' },
  failed:  { icon: '✕', color: 'var(--c-error)',   dotClass: 'error' },
  running: { icon: '→', color: 'var(--c-primary)',  dotClass: 'active' },
  pending: { icon: '○', color: 'var(--c-text-3)',   dotClass: 'wait' },
  skipped: { icon: '⊘', color: 'var(--c-text-3)',   dotClass: 'wait' },
};

const KIND_COLORS: Record<string, string> = {
  plan:    'geekblue',
  execute: 'cyan',
  check:   'purple',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

interface StepProgressProps {
  jobId: string;
  refetchInterval?: number;
}

export function StepProgress({ jobId, refetchInterval = 3000 }: StepProgressProps) {
  const stepsQuery = useQuery({
    queryKey: ['job', jobId, 'steps'],
    queryFn: () => rpc.steps.list({ jobId }),
    enabled: !!jobId,
    refetchInterval,
  });

  if (stepsQuery.isLoading) return <Spin size="small" />;
  if (!stepsQuery.data?.length) return null;

  return (
    <div className="steps-list">
      {stepsQuery.data.map((step) => {
        const state = STEP_STATE[step.status] ?? STEP_STATE.pending;
        const durationMs =
          step.startedAt && step.completedAt
            ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
            : null;

        return (
          <div
            key={step.id}
            className="step-row"
            style={{ paddingLeft: step.retryOf ? 28 : undefined }}
          >
            <div
              className="step-icon"
              style={{
                background:
                  step.status === 'passed'
                    ? 'var(--c-success-bg)'
                    : step.status === 'failed'
                      ? 'var(--c-error-bg)'
                      : step.status === 'running'
                        ? 'var(--c-primary-light)'
                        : 'var(--c-border)',
                color: state.color,
              }}
            >
              {state.icon}
            </div>

            <span
              style={{
                flex: 1,
                color: step.status === 'failed' ? 'var(--c-error)' : 'var(--c-text-1)',
              }}
            >
              {step.name}
              {step.retryOf && (
                <Tag color="orange" style={{ marginLeft: 6, fontSize: 10 }}>
                  retry
                </Tag>
              )}
            </span>

            <Tag color={KIND_COLORS[step.kind] ?? 'default'} style={{ fontSize: 11 }}>
              {step.kind}
            </Tag>

            {(step.config as { model?: string })?.model && (
              <Tag style={{ fontSize: 11 }}>
                {(step.config as { model?: string }).model}
              </Tag>
            )}

            {durationMs != null && (
              <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
                {formatDuration(durationMs)}
              </span>
            )}

            {(() => {
              const out = step.output as { costUsd?: number; inputTokens?: number; outputTokens?: number } | null;
              if (!out?.costUsd && !out?.inputTokens) return null;
              return (
                <Tooltip title={out.inputTokens ? `${out.inputTokens.toLocaleString()} in · ${(out.outputTokens ?? 0).toLocaleString()} out` : undefined}>
                  <span className="muted small" style={{ whiteSpace: 'nowrap', cursor: out.inputTokens ? 'default' : undefined }}>
                    {out.costUsd ? `$${out.costUsd.toFixed(4)}` : `${((out.inputTokens ?? 0) + (out.outputTokens ?? 0)).toLocaleString()} tok`}
                  </span>
                </Tooltip>
              );
            })()}

            {step.status === 'failed' && step.errorMessage && (
              <Tooltip title={step.errorMessage}>
                <span style={{ color: 'var(--c-error)', fontSize: 13 }}>⚠</span>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
