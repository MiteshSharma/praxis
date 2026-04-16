import type { Hono } from 'hono';
import { PublishInputSchema } from '../dto/publish.dto';
import { validateBody } from '../middleware/validate';
import type { PublishService } from '../services/publish.service';

export function publishRoutes(app: Hono, publishService: PublishService): void {
  app.post('/publish', validateBody(PublishInputSchema), async (c) => {
    // Safe: validateBody already rejected invalid payloads
    const input = PublishInputSchema.parse(await c.req.json());

    try {
      const result = await publishService.publish(input);
      if ('error' in result && result.error === 'no_changes') {
        return c.json({ error: 'no_changes' }, 409);
      }
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'publish_failed', detail: message }, 502);
    }
  });
}
