import { verifyMcpToken } from '@shared/core';
import { DbTaskTracker } from '@shared/core';
import type { PlanData } from '@shared/db';
import type { Database } from '@shared/db';
import { jobs } from '@shared/db';
import type { MemoryBackend } from '@shared/memory';
import { normalizeRepoKey } from '@shared/memory';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';

const SubmitPlanBodySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  bodyMarkdown: z.string().min(1),
  steps: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(['pending', 'done', 'skipped']).default('pending'),
    }),
  ),
  affectedPaths: z.array(z.string()),
  risks: z.array(z.string()).optional(),
  openQuestions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        context: z.string().optional(),
        options: z.array(z.string()).optional(),
        answer: z.string().nullable().default(null),
      }),
    )
    .optional(),
});

/**
 * Registers the MCP `submit_plan` endpoint at `POST /mcp/submit_plan`.
 *
 * Auth: short-lived HS256 JWT in `Authorization: Bearer <token>`.
 * The `jobId` is extracted from the token — never trusted from the body.
 */
const QueryMemoryBodySchema = z.object({
  query: z.string().min(1),
});

export function registerMcpRoutes(
  app: Hono,
  deps: { db: Database; log: Logger; mcpSecret?: string; memoryBackend?: MemoryBackend },
): void {
  app.post('/mcp/submit_plan', async (c) => {
    const { db, log, mcpSecret } = deps;

    if (!mcpSecret) {
      log.warn('MCP_SHARED_SECRET not set — submit_plan rejected');
      return c.json({ error: 'mcp_not_configured' }, 503);
    }

    const auth = c.req.header('authorization');
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!token) return c.json({ error: 'missing_token' }, 401);

    let jobId: string;
    try {
      ({ jobId } = await verifyMcpToken(token, mcpSecret));
    } catch {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const raw = await c.req.json().catch(() => null);
    const result = SubmitPlanBodySchema.safeParse(raw);
    if (!result.success) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: 'invalid plan body', details: result.error.flatten().fieldErrors },
        400,
      );
    }

    const tracker = new DbTaskTracker(db);
    const previousPlan = await tracker.getLatestPlanForJob(jobId);
    const plan = await tracker.createPlan(jobId, {
      ...result.data,
      previousPlanId: previousPlan?.id,
    });

    log.info({ jobId, planId: plan.id, version: plan.version }, 'plan submitted via MCP');

    return c.json({ planId: plan.id, version: plan.version });
  });

  app.post('/mcp/query_memory', async (c) => {
    const { db, log, mcpSecret, memoryBackend } = deps;

    if (!mcpSecret) {
      log.warn('MCP_SHARED_SECRET not set — query_memory rejected');
      return c.json({ error: 'mcp_not_configured' }, 503);
    }

    if (!memoryBackend) {
      return c.json({ content: null, source: null, truncated: false });
    }

    const auth = c.req.header('authorization');
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!token) return c.json({ error: 'missing_token' }, 401);

    let jobId: string;
    try {
      ({ jobId } = await verifyMcpToken(token, mcpSecret));
    } catch {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const raw = await c.req.json().catch(() => null);
    const result = QueryMemoryBodySchema.safeParse(raw);
    if (!result.success) return c.json({ error: 'invalid_body' }, 400);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) return c.json({ error: 'job_not_found' }, 404);

    let repoKey: string;
    try {
      repoKey = normalizeRepoKey(job.githubUrl);
    } catch {
      return c.json({ error: 'invalid_repo_url' }, 400);
    }

    const memory = await memoryBackend.loadForJob(repoKey, result.data.query);
    if (!memory) return c.json({ content: null, source: null, truncated: false });

    log.debug({ jobId, repoKey, source: memory.source }, 'query_memory served');
    return c.json({ content: memory.content, source: memory.source, truncated: memory.truncated });
  });
}
