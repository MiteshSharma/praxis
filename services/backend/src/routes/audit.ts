import type { Database } from '@shared/db';
import { jobTimeline, jobs } from '@shared/db';
import { asc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function summarize(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'status-changed':
      return `Job transitioned: ${payload.from} → ${payload.to}`;
    case 'plan-approved':
      return `Plan approved (v${payload.version})`;
    case 'plan-revision-requested':
      return `Plan revision requested (revision ${payload.revisionCount})`;
    case 'plan-rejected':
      return payload.reason ? `Plan rejected: ${payload.reason}` : 'Plan rejected';
    case 'chunk':
      return 'Agent output chunk';
    case 'completed':
      return 'Job completed';
    case 'failed':
      return payload.error ? `Job failed: ${payload.error}` : 'Job failed';
    case 'artifact-created':
      return `Artifact created: ${payload.artifactKind ?? payload.kind ?? 'unknown'}`;
    case 'step-started':
      return `Step started${payload.name ? `: ${payload.name}` : ''}`;
    case 'sandbox-ready':
      return `Sandbox ready${payload.event ? `: ${payload.event}` : ''}`;
    case 'prompt-snapshot':
      return `System prompt snapshot (${payload.phase ?? 'unknown'} phase)`;
    case 'memory-saved':
      return `Memory saved (${payload.entryCount} entries, ${payload.sizeBytes} bytes)`;
    case 'memory-loaded':
      return `Memory loaded`;
    case 'recovered':
      return 'Job recovered from stuck state';
    default:
      return type;
  }
}

export function auditRoutes(app: Hono, db: Database): void {
  app.get('/jobs/:jobId/audit', async (c) => {
    const { jobId } = c.req.param();

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) return c.text('job not found', 404);

    const entries = await db
      .select()
      .from(jobTimeline)
      .where(eq(jobTimeline.jobId, jobId))
      .orderBy(asc(jobTimeline.seq));

    const lines: string[] = [
      csvRow(['seq', 'timestamp', 'type', 'actor', 'summary', 'detail']),
    ];

    for (const entry of entries) {
      const payload = (entry.payload ?? {}) as Record<string, unknown>;
      const actor = payload.actor === 'user' ? 'user' : 'system';
      const summary = summarize(entry.type, payload);
      lines.push(csvRow([
        entry.seq,
        entry.createdAt.toISOString(),
        entry.type,
        actor,
        summary,
        JSON.stringify(payload),
      ]));
    }

    const csv = lines.join('\r\n');
    const filename = `audit-${jobId}.csv`;

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    return c.body(csv);
  });
}
