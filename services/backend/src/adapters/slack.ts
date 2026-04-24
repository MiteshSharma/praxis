import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, PlatformAdapter, SendOptions, SendResult } from './types';

interface SlackSecrets {
  botToken: string;
  signingSecret: string;
}

/**
 * Slack platform adapter.
 * - Verifies HMAC-SHA256 request signatures
 * - Parses message_events (ignores bot messages, retries, etc.)
 * - Sends messages via chat.postMessage
 * - Formats text as mrkdwn
 */
export class SlackAdapter implements PlatformAdapter {
  readonly platform = 'slack';

  constructor(private readonly secrets: SlackSecrets) {}

  async parseWebhook(
    body: unknown,
    headers: Record<string, string>,
  ): Promise<IncomingMessage | null> {
    const payload = body as Record<string, unknown>;

    // Handle Slack URL verification challenge (BEFORE signature check — no sig on challenge)
    if (payload.type === 'url_verification') {
      return null; // Route handler must respond with { challenge }
    }

    // Verify signature
    await this.verifySignature(headers, payload);

    const event = payload.event as Record<string, unknown> | undefined;
    if (!event) return null;

    // Handle message and app_mention events
    if (event.type !== 'message' && event.type !== 'app_mention') return null;

    // Ignore bot messages and message subtypes (edits, deletes, etc.)
    if (event.bot_id || event.subtype) return null;

    const text = typeof event.text === 'string' ? event.text.trim() : '';
    if (!text) return null;

    // Strip @-mention prefix (e.g. "<@U123456> do something" → "do something")
    const cleanText = text.replace(/^<@[A-Z0-9]+>\s*/i, '').trim();
    if (!cleanText) return null;

    const chatId = typeof event.channel === 'string' ? event.channel : '';
    const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : null;
    // For a top-level message, thread_ts is undefined; use ts as the anchor
    const messageTs = typeof event.ts === 'string' ? event.ts : null;

    return {
      platform: 'slack',
      chatId,
      threadId: threadTs ?? messageTs,
      text: cleanText,
      userId: typeof event.user === 'string' ? event.user : null,
      userName: null, // Slack doesn't include display name in the event
      raw: body,
    };
  }

  async send(chatId: string, text: string, options?: SendOptions): Promise<SendResult> {
    const body: Record<string, unknown> = {
      channel: chatId,
      text,
      mrkdwn: true,
    };
    if (options?.threadId) {
      body.thread_ts = options.threadId;
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${this.secrets.botToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }

    const data = (await response.json()) as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return { threadId: data.ts ?? '' };
  }

  formatText(text: string): string {
    // Text is already mrkdwn — just pass through
    return text;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async verifySignature(headers: Record<string, string>, _body: unknown): Promise<void> {
    const rawBody = headers.__raw_body ?? '';
    const timestamp = headers['x-slack-request-timestamp'] ?? '';
    const signature = headers['x-slack-signature'] ?? '';

    // Replay attack guard: reject requests older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) {
      throw new Error('Slack signature: timestamp too old');
    }

    const sigBaseString = `v0:${timestamp}:${rawBody}`;
    const hmac = createHmac('sha256', this.secrets.signingSecret)
      .update(sigBaseString)
      .digest('hex');
    const expected = `v0=${hmac}`;

    // Timing-safe comparison
    try {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error('Slack signature: mismatch');
      }
    } catch {
      throw new Error('Slack signature: invalid');
    }
  }
}
