import { ORPCError } from '@orpc/server';
import type { MessageDto, SessionDto } from '@shared/contracts';
import { TaskIngestService, splitWebInput } from '@shared/core';
import { type Database, jobs, workflowVersions } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { SessionsRepository } from '../repositories/sessions.repository';

const TERMINAL_JOB_STATUSES = ['completed', 'plan_rejected', 'failed'] as const;

interface SendInput {
  sessionId: string;
  message: string;
  githubUrl?: string;
  workflowId?: string;
  autoApprove?: boolean;
}

export class SessionsService {
  private readonly repo: SessionsRepository;
  private readonly ingest: TaskIngestService;

  constructor(
    private readonly db: Database,
    boss: PgBoss,
    log: Logger,
    overrides?: { ingest?: TaskIngestService; repo?: SessionsRepository },
  ) {
    this.repo = overrides?.repo ?? new SessionsRepository(db);
    this.ingest = overrides?.ingest ?? new TaskIngestService(db, boss, log);
  }

  async list(limit = 50): Promise<SessionDto[]> {
    return this.repo.findMany(limit);
  }

  async getById(id: string): Promise<SessionDto> {
    const s = await this.repo.findById(id);
    if (!s) throw new ORPCError('NOT_FOUND', { message: 'session not found' });
    return s;
  }

  async create(data: {
    title: string;
    githubUrl?: string;
    workflowId?: string;
    model?: string;
  }): Promise<SessionDto> {
    return this.repo.create({
      title: data.title,
      defaultGithubUrl: data.githubUrl,
      defaultWorkflowId: data.workflowId,
      model: data.model,
    });
  }

  async update(
    id: string,
    patch: {
      title?: string;
      githubUrl?: string | null;
      workflowId?: string | null;
      planHoldHours?: number;
      model?: string | null;
    },
  ): Promise<SessionDto> {
    const result = await this.repo.update(id, {
      title: patch.title,
      defaultGithubUrl: patch.githubUrl,
      defaultWorkflowId: patch.workflowId,
      planHoldHours: patch.planHoldHours,
      model: patch.model,
    });
    if (!result) throw new ORPCError('NOT_FOUND', { message: 'session not found' });
    return result;
  }

  async delete(id: string): Promise<void> {
    const activeJob = await this.db.query.jobs.findFirst({
      where: and(
        eq(jobs.conversationId, id),
        notInArray(jobs.status, [...TERMINAL_JOB_STATUSES]),
      ),
      columns: { id: true },
    });
    if (activeJob) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'session has active jobs — wait for them to complete before deleting',
      });
    }
    await this.repo.delete(id);
  }

  async history(
    sessionId: string,
    limit: number,
    before?: string,
  ): Promise<{ messages: MessageDto[]; hasMore: boolean }> {
    return this.repo.findMessages(sessionId, limit, before);
  }

  async send(input: SendInput): Promise<{ jobId: string }> {
    const session = await this.repo.findById(input.sessionId);
    if (!session) throw new ORPCError('NOT_FOUND', { message: 'session not found' });

    const githubUrl = input.githubUrl ?? session.defaultGithubUrl;
    if (!githubUrl) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'no githubUrl provided and session has no default githubUrl',
      });
    }

    const parentJobId = await this.repo.findLastCompletedJobId(input.sessionId);

    const { title, description } = splitWebInput(input.message);

    // Resolve workflowVersionId: explicit workflowId override → session default → undefined
    const resolvedWorkflowId = input.workflowId ?? session.defaultWorkflowId ?? null;
    let workflowVersionId: string | undefined;
    if (resolvedWorkflowId) {
      const [latest] = await this.db
        .select({ id: workflowVersions.id })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, resolvedWorkflowId))
        .orderBy(desc(workflowVersions.version))
        .limit(1);
      workflowVersionId = latest?.id;
    }

    const userMsg = await this.repo.insertMessage({
      sessionId: input.sessionId,
      role: 'user',
      content: input.message,
    });

    const { id: jobId } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'user_prompt',
      title,
      description,
      metadata: {},
      githubUrl,
      githubBranch: 'main',
      conversationId: input.sessionId,
      parentJobId: parentJobId ?? undefined,
      workflowVersionId,
      model: session.model ?? null,
      autoApprove: input.autoApprove ?? false,
    });

    await this.repo.updateMessageJobId(userMsg.id, jobId);

    return { jobId };
  }
}
