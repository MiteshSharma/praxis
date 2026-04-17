import { verifyCallbackToken } from '@shared/core';
import type { Hono } from 'hono';
import type { PlansService } from '../services/plans.service';

/**
 * Public endpoint for external plan-review callbacks.
 *
 * External systems (webhooks, Slack, Linear, etc.) POST here with a signed
 * callback token to approve, revise, or reject a plan. No user session is
 * required — the token itself proves authority to act on the job.
 *
 * POST /plan-review/respond
 * Body: { token: string, action: 'approve'|'revise'|'reject', feedback?: string }
 */
export function planReviewRoutes(
  app: Hono,
  deps: { plansService: PlansService; mcpSecret: string },
): void {
  app.post('/plan-review/respond', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }

    if (!body || typeof body !== 'object') {
      return c.json({ error: 'body must be an object' }, 400);
    }

    const { token, action, feedback } = body as Record<string, unknown>;

    if (typeof token !== 'string') return c.json({ error: 'token is required' }, 400);
    if (!['approve', 'revise', 'reject'].includes(action as string)) {
      return c.json({ error: 'action must be approve, revise, or reject' }, 400);
    }

    let jobId: string;
    try {
      ({ jobId } = await verifyCallbackToken(token, deps.mcpSecret));
    } catch {
      return c.json({ error: 'invalid or expired token' }, 401);
    }

    try {
      switch (action as string) {
        case 'approve':
          await deps.plansService.approvePlan(jobId);
          break;
        case 'revise':
          await deps.plansService.revisePlan(
            jobId,
            undefined,
            typeof feedback === 'string' ? feedback : undefined,
          );
          break;
        case 'reject':
          await deps.plansService.rejectPlan(
            jobId,
            typeof feedback === 'string' ? feedback : undefined,
          );
          break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }

    return c.json({ ok: true, jobId, action });
  });
}
