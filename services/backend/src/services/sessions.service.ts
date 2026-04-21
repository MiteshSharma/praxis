import { ORPCError } from '@orpc/server';
import type { MessageDto, SessionDto } from '@shared/contracts';
import { TaskIngestService, splitWebInput } from '@shared/core';
import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';
import { JobsRepository } from '../repositories/jobs.repository';
import { SessionsRepository } from '../repositories/sessions.repository';
import { WorkflowsRepository } from '../repositories/workflows.repository';

const TERMINAL_JOB_STATUSES = ['completed', 'plan_rejected', 'failed', 'cancelled'] as const;

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
  private readonly jobsRepo: JobsRepository;
  private readonly workflowsRepo: WorkflowsRepository;

  constructor(
    private readonly db: Database,
    boss: PgBoss,
    log: Logger,
    overrides?: {
      ingest?: TaskIngestService;
      repo?: SessionsRepository;
      jobsRepo?: JobsRepository;
      workflowsRepo?: WorkflowsRepository;
    },
  ) {
    this.repo = overrides?.repo ?? new SessionsRepository(db);
    this.ingest = overrides?.ingest ?? new TaskIngestService(db, boss, log);
    this.jobsRepo = overrides?.jobsRepo ?? new JobsRepository(db);
    this.workflowsRepo = overrides?.workflowsRepo ?? new WorkflowsRepository(db);
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
    const hasActive = await this.jobsRepo.hasActiveJobs(id, TERMINAL_JOB_STATUSES);
    if (hasActive) {
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
    const workflowVersionId = resolvedWorkflowId
      ? await this.workflowsRepo.findLatestVersionId(resolvedWorkflowId)
      : undefined;

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
