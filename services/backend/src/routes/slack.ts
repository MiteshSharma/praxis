import type { Logger } from '@shared/telemetry';
import type { Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { SlackAdapter } from '../adapters/slack';
import { SLACK_PROCESS_QUEUE } from '../queues/slack-process';
import type { PlatformConfigsService } from '../services/platform-configs.service';

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
  deps: { boss: PgBoss; platformConfigsService: PlatformConfigsService; log: Logger },
): void {
  const log = deps.log.child({ route: 'slack' });

  app.post('/channels/slack/events', async (c) => {
    // Read raw body text for HMAC verification
    const rawBody = await c.req.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      log.warn('slack event: invalid JSON body');
      return c.json({ error: 'invalid JSON' }, 400);
    }

    log.info({ type: payload.type }, 'slack event received');

    // Handle Slack URL verification challenge (no signature on these)
    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      log.info('slack event: url_verification challenge — responding');
      return c.json({ challenge: payload.challenge });
    }

    // Load Slack secrets — if not configured, drop silently (return 200)
    const secrets = await deps.platformConfigsService.getSecrets('slack');
    if (!secrets?.botToken || !secrets?.signingSecret) {
      log.warn('slack event: no secrets configured — dropping event');
      return c.json({ ok: true });
    }

    const adapter = new SlackAdapter({
      botToken: secrets.botToken,
      signingSecret: secrets.signingSecret,
    });

    // Collect headers (lower-cased)
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    // Attach raw body for HMAC verification
    headers.__raw_body = rawBody;

    let msg: Awaited<ReturnType<SlackAdapter['parseWebhook']>>;
    try {
      msg = await adapter.parseWebhook(payload, headers);
    } catch (err) {
      log.warn({ err }, 'slack event: signature verification failed');
      return c.json({ error: 'unauthorized' }, 401);
    }

    if (msg) {
      log.info(
        { chatId: msg.chatId, threadId: msg.threadId, text: msg.text },
        'slack event: enqueuing message',
      );
      await deps.boss.send(SLACK_PROCESS_QUEUE, msg);
    } else {
      log.info(
        { type: (payload.event as Record<string, unknown>)?.type },
        'slack event: ignored (bot message, subtype, or empty text)',
      );
    }

    return c.json({ ok: true });
  });
}
