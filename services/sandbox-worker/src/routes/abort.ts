import type { Hono } from 'hono';
import { AbortInputSchema } from '../dto/abort.dto';
import { validateBody } from '../middleware/validate';
import type { AgentService } from '../services/agent.service';

export function abortRoutes(app: Hono, agentService: AgentService): void {
  app.post('/abort', validateBody(AbortInputSchema), async (c) => {
    // Safe: validateBody already rejected invalid payloads
    const { sessionId } = AbortInputSchema.parse(await c.req.json());
    agentService.getActiveSessions().get(sessionId)?.abort();
    return c.json({ ok: true });
  });
}
