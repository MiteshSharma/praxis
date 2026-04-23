import type { Hono } from 'hono';
import type PgBoss from 'pg-boss';
import type { PlatformConfigsService } from '../services/platform-configs.service';
import { SlackAdapter } from '../adapters/slack';
import { SLACK_PROCESS_QUEUE } from '../queues/slack-process';

/**
 * POST /channels/slack/events
 *
 * Slack requires a 200 response within 3 seconds — we ack immediately
 * and do all processing async via pg-boss.
 *
 * Special cases handled synchronously:
 *  - url_verification challenge (Slack app setup)
 *  - invalid/missing platform config (drop silently)
 */
export function slackRoutes(
  app: Hono,
  deps: { boss: PgBoss; platformConfigsService: PlatformConfigsService },
): void {
  app.post('/channels/slack/events', async (c) => {
    // Read raw body text for HMAC verification
    const rawBody = await c.req.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }

    // Handle Slack URL verification challenge (no signature on these)
    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      return c.json({ challenge: payload.challenge });
    }

    // Load Slack secrets — if not configured, drop silently (return 200)
    const secrets = await deps.platformConfigsService.getSecrets('slack');
    if (!secrets?.botToken || !secrets?.signingSecret) {
      return c.json({ ok: true });
    }

    const adapter = new SlackAdapter({ botToken: secrets.botToken, signingSecret: secrets.signingSecret });

    // Collect headers (lower-cased)
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    // Attach raw body for HMAC verification
    headers['__raw_body'] = rawBody;

    let msg: Awaited<ReturnType<SlackAdapter['parseWebhook']>>;
    try {
      msg = await adapter.parseWebhook(payload, headers);
    } catch (err) {
      // Signature verification failure
      return c.json({ error: 'unauthorized' }, 401);
    }

    if (msg) {
      // Enqueue for async processing — do not await
      await deps.boss.send(SLACK_PROCESS_QUEUE, msg);
    }

    return c.json({ ok: true });
  });
}
