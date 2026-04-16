import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { PromptBodySchema } from '../dto/agent.dto';
import { validateBody } from '../middleware/validate';
import type { AgentService } from '../services/agent.service';

export function promptRoutes(app: Hono, agentService: AgentService): void {
  app.post('/prompt', validateBody(PromptBodySchema), async (c) => {
    // Safe: validateBody already rejected invalid payloads
    const body = PromptBodySchema.parse(await c.req.json());

    const abort = agentService.createSession(body.sessionId);
    c.req.raw.signal.addEventListener('abort', () => abort.abort());

    return streamSSE(c, async (sse) => {
      try {
        await agentService.runAgent(body, abort.signal, (chunk) =>
          sse.writeSSE({ data: JSON.stringify(chunk) }),
        );
        await sse.writeSSE({ data: JSON.stringify({ type: 'finish' }) });
      } catch (err) {
        await sse.writeSSE({
          data: JSON.stringify({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          }),
        });
      } finally {
        agentService.deleteSession(body.sessionId);
      }
    });
  });
}
