import {
  type Database,
  conversationChannels,
  conversations,
  platformSessions,
  platformThreads,
} from '@shared/db';
import { and, desc, eq } from 'drizzle-orm';

import type { JobsRepository } from '../repositories/jobs.repository';
import type { SettingsRepository } from '../repositories/settings.repository';
import type { JobsService } from '../services/jobs.service';
import type { PlansService } from '../services/plans.service';
import type { PlatformConfigsService } from '../services/platform-configs.service';
import type { SessionsService } from '../services/sessions.service';
import { classifyIntent } from './intent-classifier';
import { SlackAdapter } from './slack';
import type { IncomingMessage, PlatformAdapter } from './types';

const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(.*)/is;

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
async function buildAdapter(
  platform: string,
  platformConfigsService: PlatformConfigsService,
): Promise<PlatformAdapter | null> {
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
 * Looks up the platform session; if none found, asks user for a session ID.
 * Once linked, classifies intent and dispatches.
 */
export async function handleIncoming(msg: IncomingMessage, deps: HandlerDeps): Promise<void> {
  // 1. Look up platform session for this chatId
  const [existing] = await deps.db
    .select()
    .from(platformSessions)
    .where(
      and(eq(platformSessions.platform, msg.platform), eq(platformSessions.chatId, msg.chatId)),
    )
    .limit(1);

  if (!existing) {
    await handleNoSession(msg, deps);
    return;
  }

  const sessionId = existing.conversationId;

  // 2. Classify intent
  const model = await deps.settingsRepo.get('communication_model');
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

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

/**
 * No platform session linked yet.
 * If the message starts with a UUID, treat it as a session ID and link it.
 * The remaining text (if any) is submitted as the first task.
 * Otherwise ask the user to provide a session ID.
 */
async function handleNoSession(msg: IncomingMessage, deps: HandlerDeps): Promise<void> {
  const adapter = await buildAdapter(msg.platform, deps.platformConfigsService);

  // Strip backtick formatting Slack users naturally copy from the UI (e.g. `uuid`)
  const cleanText = msg.text.trim().replace(/`/g, '');
  const match = UUID_RE.exec(cleanText);
  if (!match) {
    // List available sessions so the user can pick one
    if (adapter) {
      const allSessions = await deps.db
        .select({ id: conversations.id, title: conversations.title })
        .from(conversations)
        .orderBy(desc(conversations.createdAt))
        .limit(10);

      let reply: string;
      if (allSessions.length === 0) {
        reply = 'No Praxis sessions found. Create one in the Praxis UI first, then come back here.';
      } else {
        const list = allSessions.map((s) => `• \`${s.id}\` — ${s.title}`).join('\n');
        reply = `Please reply with a session ID followed by your task to get started.\n\n*Available sessions:*\n${list}\n\nExample: \`${allSessions[0].id} add dark mode to settings\``;
      }

      await adapter.send(msg.chatId, reply, { threadId: msg.threadId ?? undefined });
    }
    return;
  }

  const sessionId = match[1];
  const task = match[2].trim();

  // Validate the session exists
  const [session] = await deps.db
    .select()
    .from(conversations)
    .where(eq(conversations.id, sessionId))
    .limit(1);

  if (!session) {
    if (adapter) {
      await adapter.send(
        msg.chatId,
        `Session \`${sessionId}\` not found. Please check the ID and try again.`,
        { threadId: msg.threadId ?? undefined },
      );
    }
    return;
  }

  // Persist the platform → session mapping
  await deps.db.insert(platformSessions).values({
    platform: msg.platform,
    chatId: msg.chatId,
    conversationId: sessionId,
    userId: msg.userId ?? null,
    userName: msg.userName ?? null,
  });

  // Also create a conversation_channels row so plan.ready dispatches work
  await deps.db
    .insert(conversationChannels)
    .values({
      conversationId: sessionId,
      type: msg.platform,
      name: `${msg.platform} / ${msg.chatId}`,
      config: { chatId: msg.chatId },
      enabled: true,
    })
    .onConflictDoNothing();

  if (!task) {
    // Just linked — confirm and wait for a task
    if (adapter) {
      await adapter.send(
        msg.chatId,
        adapter.formatText(
          `Linked to session \`${sessionId.slice(0, 8)}\`. Send me your task and I'll get started.`,
        ),
        { threadId: msg.threadId ?? undefined },
      );
    }
    return;
  }

  // Session ID + task in one message — submit immediately
  await handleSubmitJob(msg, sessionId, task, deps);
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
    await deps.db
      .insert(platformThreads)
      .values({
        platform: msg.platform,
        chatId: msg.chatId,
        threadId: result.threadId,
        jobId: job.id,
      })
      .onConflictDoNothing();
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
    await adapter.send(msg.chatId, 'No plan is currently awaiting approval.', {
      threadId: msg.threadId ?? undefined,
    });
    return;
  }

  // Reply in the job's own thread, not wherever the user typed "approve"
  const jobThread = await findThreadForJob(deps.db, msg.platform, job.id);
  const replyThread = jobThread?.threadId ?? msg.threadId ?? undefined;

  if (approved) {
    await deps.plansService.approvePlan(job.id);
    await adapter.send(msg.chatId, adapter.formatText('Plan approved — executing now.'), {
      threadId: replyThread,
    });
  } else {
    await deps.plansService.rejectPlan(job.id, feedback ?? 'Rejected via messaging channel');
    await adapter.send(msg.chatId, adapter.formatText('Plan rejected.'), { threadId: replyThread });
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
    .where(and(eq(platformThreads.platform, platform), eq(platformThreads.jobId, jobId)))
    .limit(1);
  return row ? { chatId: row.chatId, threadId: row.threadId } : null;
}
