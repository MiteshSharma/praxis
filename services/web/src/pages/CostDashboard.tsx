import type { DailyCostDto, RepoCostDto } from '@shared/contracts';
import { useQuery } from '@tanstack/react-query';
import { Statistic, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { rpc } from '../rpc';

const PRESETS = [
  { label: 'Last 7d', days: 7 },
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
  { label: 'All time', days: 0 },
];

function toRange(days: number): { from?: string; to?: string } {
  if (days === 0) return {};
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function SpendBarChart({ data }: { data: DailyCostDto[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) return <p className="muted small">No data.</p>;

  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  const BAR_H = 120;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: BAR_H + 24, padding: '28px 4px 0', overflow: 'visible' }}>
      {data.map((d, i) => {
        const height = Math.max(2, (d.costUsd / max) * BAR_H);
        const isHovered = hovered === i;
        return (
          <div
            key={d.date}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative' }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            {isHovered && (
              <div style={{
                position: 'absolute',
                bottom: height + (data.length <= 14 ? 14 : 2) + 4,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--c-text)',
                color: 'var(--c-bg, #fff)',
                borderRadius: 5,
                padding: '4px 8px',
                fontSize: 11,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 10,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 600 }}>${fmt(d.costUsd)}</div>
                <div style={{ opacity: 0.75 }}>{d.date} · {d.jobCount} job{d.jobCount !== 1 ? 's' : ''}</div>
              </div>
            )}
            <div
              style={{
                width: '100%',
                height,
                background: 'var(--c-primary)',
                borderRadius: '3px 3px 0 0',
                opacity: isHovered ? 1 : 0.85,
                transition: 'opacity 0.15s',
                cursor: 'default',
              }}
            />
            {data.length <= 14 && (
              <span style={{ fontSize: 9, color: 'var(--c-text-3)', whiteSpace: 'nowrap' }}>
                {d.date.slice(5)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const repoColumns = [
  {
    title: 'Repository',
    dataIndex: 'githubUrl',
    key: 'githubUrl',
    render: (url: string) => (
      <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontFamily: 'monospace' }}>
        {url.replace('https://github.com/', '')}
      </a>
    ),
  },
  {
    title: 'Total spend',
    dataIndex: 'costUsd',
    key: 'costUsd',
    align: 'right' as const,
    render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(v)}</span>,
    sorter: (a: RepoCostDto, b: RepoCostDto) => b.costUsd - a.costUsd,
    defaultSortOrder: 'ascend' as const,
  },
  {
    title: 'Jobs',
    dataIndex: 'jobCount',
    key: 'jobCount',
    align: 'right' as const,
    render: (v: number) => v.toLocaleString(),
  },
  {
    title: 'Avg / job',
    dataIndex: 'avgCostUsd',
    key: 'avgCostUsd',
    align: 'right' as const,
    render: (v: number) => `$${fmt(v, 4)}`,
  },
];

export function CostDashboard() {
  const [preset, setPreset] = useState(1); // default: last 30d
  const range = useMemo(() => toRange(PRESETS[preset].days), [preset]);

  const summaryQ = useQuery({
    queryKey: ['costs', 'summary', range],
    queryFn: () => rpc.costs.summary(range),
  });

  const dailyQ = useQuery({
    queryKey: ['costs', 'daily', range],
    queryFn: () => rpc.costs.daily(range),
  });

  const repoQ = useQuery({
    queryKey: ['costs', 'byRepo', range],
    queryFn: () => rpc.costs.byRepo(range),
  });

  const s = summaryQ.data;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Cost Dashboard</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              className={`btn btn-sm${preset === i ? '' : ' btn-ghost'}`}
              style={preset === i ? { background: 'var(--c-primary)', color: '#fff', border: 'none' } : {}}
              onClick={() => setPreset(i)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          { title: 'Total spend', value: s ? `$${fmt(s.totalCostUsd)}` : '—', color: 'var(--c-primary)' },
          { title: 'Avg per job', value: s ? `$${fmt(s.avgCostPerJob, 4)}` : '—' },
          { title: 'Jobs run', value: s ? s.totalJobs.toLocaleString() : '—' },
          { title: 'Completed', value: s ? s.completedJobs.toLocaleString() : '—', color: 'var(--c-success)' },
          { title: 'Failed', value: s ? s.failedJobs.toLocaleString() : '—', color: s && s.failedJobs > 0 ? 'var(--c-error)' : undefined },
        ].map((card) => (
          <div
            key={card.title}
            style={{
              background: 'var(--c-surface)',
              border: '1px solid var(--c-border)',
              borderRadius: 10,
              padding: '16px 20px',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              {card.title}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: card.color ?? 'var(--c-text)', fontVariantNumeric: 'tabular-nums' }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Token footnote */}
      {s && (s.totalInputTokens > 0 || s.totalOutputTokens > 0) && (
        <p style={{ margin: '0 0 20px', fontSize: 12, color: 'var(--c-text-3)' }}>
          {s.totalInputTokens.toLocaleString()} input tokens · {s.totalOutputTokens.toLocaleString()} output tokens
        </p>
      )}

      {/* Daily chart */}
      <div
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 24,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Daily spend</div>
        {dailyQ.isLoading ? (
          <p className="muted small">Loading…</p>
        ) : (
          <SpendBarChart data={dailyQ.data ?? []} />
        )}
      </div>

      {/* By repo table */}
      <div
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--c-border-subtle)', fontWeight: 600, fontSize: 13 }}>
          Spend by repository
        </div>
        <Table
          dataSource={repoQ.data ?? []}
          columns={repoColumns}
          rowKey="githubUrl"
          loading={repoQ.isLoading}
          pagination={false}
          size="small"
          style={{ borderRadius: 0 }}
          locale={{ emptyText: 'No cost data yet.' }}
        />
      </div>
    </div>
  );
}
