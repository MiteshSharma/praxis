import { subscribeJobStream } from '@shared/stream';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { SseJobParamsSchema } from '../dto/sse.dto';
import { validateParams } from '../middleware/validate';

/**
 * `GET /sse/jobs/:id` — tails the Redis job stream and writes each event as
 * an SSE frame. Honors `Last-Event-ID` for resume-after-reconnect.
 */
export function sseRoutes(app: Hono): void {
  app.get('/sse/jobs/:id', validateParams(SseJobParamsSchema), async (c) => {
    // Validated by validateParams(SseJobParamsSchema) — guaranteed non-empty
    const jobId = c.req.param('id') as string;
    const lastEventId = c.req.header('last-event-id');

    return streamSSE(c, async (sse) => {
      const controller = new AbortController();
      c.req.raw.signal.addEventListener('abort', () => controller.abort());

      try {
        for await (const chunk of subscribeJobStream(jobId, {
          lastId: lastEventId,
          signal: controller.signal,
        })) {
          await sse.writeSSE({ id: chunk.id, data: JSON.stringify(chunk.data) });
        }
      } catch (err) {
        await sse.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: String(err) }),
        });
      }
    });
  });
}
