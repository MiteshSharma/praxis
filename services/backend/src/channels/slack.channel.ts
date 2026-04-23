import type { PraxisEvent } from '@shared/contracts';
import type { Database } from '@shared/db';
import { type SecretBackend, registerChannel } from '@shared/core';
import { SlackAdapter } from '../adapters/slack';
import { findThreadForJob } from '../adapters/handlers';

/**
 * Slack PraxisChannel — registered as type 'slack'.
 *
 * Channel config shape: { chatId: string }
 *
 * When a platform_session is created in handleSessionSetup, a conversation_channels
 * row of type 'slack' is inserted with config = { chatId }. The existing
 * dispatchToConversation mechanism then calls this channel for plan.ready,
 * job.completed, and job.failed events.
 */
class SlackChannel {
  readonly type = 'slack';
  readonly meta = {
    label: 'Slack',
    description: 'Posts plan-ready / completed / failed notifications to a Slack channel.',
  };

  constructor(
    private readonly chatId: string,
    private readonly db: Database,
    private readonly secretBackend: SecretBackend,
  ) {}

  private async getAdapter(): Promise<SlackAdapter | null> {
    const raw = await this.secretBackend.get('platform:slack');
    if (!raw) return null;
    try {
      const { botToken, signingSecret } = JSON.parse(raw) as { botToken?: string; signingSecret?: string };
      if (!botToken || !signingSecret) return null;
      return new SlackAdapter({ botToken, signingSecret });
    } catch {
      return null;
    }
  }

  async onPlanReady(event: Extract<PraxisEvent, { type: 'plan.ready' }>): Promise<void> {
    const adapter = await this.getAdapter();
    if (!adapter) return;

    const { job, plan, callbackUrl, callbackToken } = event;
    const steps = plan.steps.map((s, i) => `${i + 1}. ${s.content}`).join('\n');
    const text = [
      `*Plan ready for job \`${job.id.slice(0, 8)}\`*`,
      `*${plan.title}*`,
      plan.summary,
      '',
      '*Steps:*',
      steps,
      plan.risks?.length ? `\n*Risks:* ${plan.risks.join(', ')}` : '',
      '',
      `Reply *approve*, *reject*, or with feedback to revise.`,
    ]
      .filter((l) => l !== undefined)
      .join('\n');

    await adapter.send(this.chatId, text);
  }

  async onJobCompleted(event: Extract<PraxisEvent, { type: 'job.completed' }>): Promise<void> {
    const adapter = await this.getAdapter();
    if (!adapter) return;

    const thread = await findThreadForJob(this.db, 'slack', event.job.id);
    const text = event.prUrl
      ? `*Job \`${event.job.id.slice(0, 8)}\` completed* — <${event.prUrl}|View PR>`
      : `*Job \`${event.job.id.slice(0, 8)}\` completed.*`;

    await adapter.send(
      this.chatId,
      adapter.formatText(text),
      thread ? { threadId: thread.threadId } : undefined,
    );
  }

  async onJobFailed(event: Extract<PraxisEvent, { type: 'job.failed' }>): Promise<void> {
    const adapter = await this.getAdapter();
    if (!adapter) return;

    const thread = await findThreadForJob(this.db, 'slack', event.job.id);
    const text = adapter.formatText(
      `*Job \`${event.job.id.slice(0, 8)}\` failed.* Error: ${event.error}`,
    );

    await adapter.send(
      this.chatId,
      text,
      thread ? { threadId: thread.threadId } : undefined,
    );
  }
}

/**
 * Register the Slack channel with the shared channel registry.
 * Call this once at backend startup (routes/index.ts).
 */
export function registerSlackChannel(db: Database, secretBackend: SecretBackend): void {
  registerChannel(
    'slack',
    (config) => {
      const cfg = config as { chatId?: string };
      if (!cfg.chatId) return null;
      return new SlackChannel(cfg.chatId, db, secretBackend);
    },
  );
}
