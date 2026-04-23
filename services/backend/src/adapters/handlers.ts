import { type Database, conversationChannels, platformSessions, platformThreads } from '@shared/db';
import { and, eq } from 'drizzle-orm';

import type { JobsService } from '../services/jobs.service';
import type { PlansService } from '../services/plans.service';
import type { SessionsService } from '../services/sessions.service';
import type { PlatformConfigsService } from '../services/platform-configs.service';
import type { SettingsRepository } from '../repositories/settings.repository';
import type { JobsRepository } from '../repositories/jobs.repository';
import type { IncomingMessage, PlatformAdapter } from './types';
import { SlackAdapter } from './slack';
import { classifyIntent } from './intent-classifier';

export interface HandlerDeps {
  db: Database;
  jobsService: JobsService;
  plansService: PlansService;
  sessionsService: SessionsService;
  platformConfigsService: PlatformConfigsService;
  settingsRepo: SettingsRepository;
  jobsRepo: JobsRepository;
}

/** Build a platform adapter for the given platform using stored secrets. */
async function buildAdapter(platform: string, platformConfigsService: PlatformConfigsService): Promise<PlatformAdapter | null> {
  const secrets = await platformConfigsService.getSecrets(platform);
  if (!secrets) return null;

  if (platform === 'slack') {
    const { botToken, signingSecret } = secrets;
    if (!botToken || !signingSecret) return null;
    return new SlackAdapter({ botToken, signingSecret });
  }

  return null;
}

/**
 * Main entry point for an incoming platform message.
 * Looks up or creates the platform session, classifies intent, dispatches.
 */
export async function handleIncoming(msg: IncomingMessage, deps: HandlerDeps): Promise<void> {
  // 1. Look up platform session for this chatId
  const [existing] = await deps.db
    .select()
    .from(platformSessions)
    .where(
      and(
        eq(platformSessions.platform, msg.platform),
        eq(platformSessions.chatId, msg.chatId),
      ),
    )
    .limit(1);

  if (!existing) {
    // First message in this chat — set up a session and submit the job
    await handleSessionSetup(msg, deps);
    return;
  }

  const sessionId = existing.conversationId;

  // 2. Classify intent
  const model = await deps.settingsRepo.get('communication_model');
  const secrets = await deps.platformConfigsService.getSecrets(msg.platform);
  const apiKey = secrets?.botToken ?? process.env.ANTHROPIC_API_KEY ?? '';

  const intent = await classifyIntent(msg.text, model, apiKey);

  switch (intent.kind) {
    case 'submit_job':
      await handleSubmitJob(msg, sessionId, intent.task, deps);
      break;
    case 'status_query':
      await handleStatusQuery(msg, sessionId, deps);
      break;
    case 'approval':
      await handleApproval(msg, sessionId, intent.approved, intent.feedback, deps);
      break;
    default:
      // Unknown intent — ignore silently
      break;
  }
}

async function handleSessionSetup(msg: IncomingMessage, deps: HandlerDeps): Promise<void> {
  // Create a new Praxis session
  const session = await deps.sessionsService.create({
    title: `${msg.platform} / ${msg.chatId}`,
    model: undefined,
  });

  // Persist the platform → session mapping
  await deps.db.insert(platformSessions).values({
    platform: msg.platform,
    chatId: msg.chatId,
    conversationId: session.id,
    userId: msg.userId ?? null,
    userName: msg.userName ?? null,
  });

  // Also create a conversation_channels row so plan.ready dispatches work
  await deps.db.insert(conversationChannels).values({
    conversationId: session.id,
    type: msg.platform,
    name: `${msg.platform} / ${msg.chatId}`,
    config: { chatId: msg.chatId },
    enabled: true,
  }).onConflictDoNothing();

  // Submit the initial task as a job
  await handleSubmitJob(msg, session.id, msg.text, deps);
}

async function handleSubmitJob(
  msg: IncomingMessage,
  sessionId: string,
  task: string,
  deps: HandlerDeps,
): Promise<void> {
  const job = await deps.jobsService.create({ sessionId, task, triggerKind: 'user_prompt' });

  const adapter = await buildAdapter(msg.platform, deps.platformConfigsService);
  if (!adapter) return;

  // Persist thread mapping (threadId is top-level message ts for Slack)
  if (msg.threadId) {
    await deps.db
      .insert(platformThreads)
      .values({
        platform: msg.platform,
        chatId: msg.chatId,
        threadId: msg.threadId,
        jobId: job.id,
      })
      .onConflictDoNothing();
  }

  // Ack in thread
  const replyTarget = msg.threadId ?? undefined;
  const result = await adapter.send(
    msg.chatId,
    adapter.formatText(`Job \`${job.id.slice(0, 8)}\` queued — I'll update you here.`),
    { threadId: replyTarget },
  );

  // If this was a top-level message (no threadId), store the reply ts as the thread anchor
  if (!msg.threadId) {
    await deps.db.insert(platformThreads).values({
      platform: msg.platform,
      chatId: msg.chatId,
      threadId: result.threadId,
      jobId: job.id,
    }).onConflictDoNothing();
  }
}

async function handleStatusQuery(
  msg: IncomingMessage,
  sessionId: string,
  deps: HandlerDeps,
): Promise<void> {
  const adapter = await buildAdapter(msg.platform, deps.platformConfigsService);
  if (!adapter) return;

  const job = await deps.jobsRepo.findLatestBySessionId(sessionId);
  let text: string;
  if (!job) {
    text = 'No jobs found for this session.';
  } else {
    text = adapter.formatText(
      `Latest job \`${job.id.slice(0, 8)}\`: *${job.status}*${job.errorMessage ? `\nError: ${job.errorMessage}` : ''}`,
    );
  }
  await adapter.send(msg.chatId, text, { threadId: msg.threadId ?? undefined });
}

async function handleApproval(
  msg: IncomingMessage,
  sessionId: string,
  approved: boolean,
  feedback: string | undefined,
  deps: HandlerDeps,
): Promise<void> {
  const adapter = await buildAdapter(msg.platform, deps.platformConfigsService);
  if (!adapter) return;

  const job = await deps.jobsRepo.findLatestBySessionId(sessionId);
  if (!job || job.status !== 'plan_review') {
    await adapter.send(
      msg.chatId,
      'No plan is currently awaiting approval.',
      { threadId: msg.threadId ?? undefined },
    );
    return;
  }

  if (approved) {
    await deps.plansService.approvePlan(job.id);
    await adapter.send(
      msg.chatId,
      adapter.formatText('Plan approved — executing now.'),
      { threadId: msg.threadId ?? undefined },
    );
  } else {
    await deps.plansService.rejectPlan(job.id, feedback ?? 'Rejected via messaging channel');
    await adapter.send(
      msg.chatId,
      adapter.formatText('Plan rejected.'),
      { threadId: msg.threadId ?? undefined },
    );
  }
}

/** Look up the thread anchor for a job (used by SlackChannel to reply in-thread). */
export async function findThreadForJob(
  db: Database,
  platform: string,
  jobId: string,
): Promise<{ chatId: string; threadId: string } | null> {
  const [row] = await db
    .select()
    .from(platformThreads)
    .where(
      and(
        eq(platformThreads.platform, platform),
        eq(platformThreads.jobId, jobId),
      ),
    )
    .limit(1);
  return row ? { chatId: row.chatId, threadId: row.threadId } : null;
}
