import { ORPCError } from '@orpc/server';
import type { ConversationDto, MessageDto } from '@shared/contracts';
import { TaskIngestService, splitWebInput } from '@shared/core';
import { type Database, workflowVersions } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { desc, eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { ConversationsRepository } from '../repositories/conversations.repository';

interface SendMessageInput {
  conversationId: string;
  content: string;
  triggersJob: boolean;
  jobOverrides?: {
    githubUrl?: string;
    workflowVersionId?: string;
    title?: string;
    autoApprove?: boolean;
  };
}

export class ConversationsService {
  private readonly repo: ConversationsRepository;
  private readonly ingest: TaskIngestService;

  constructor(
    private readonly db: Database,
    boss: PgBoss,
    log: Logger,
    overrides?: { ingest?: TaskIngestService; repo?: ConversationsRepository },
  ) {
    this.repo = overrides?.repo ?? new ConversationsRepository(db);
    this.ingest = overrides?.ingest ?? new TaskIngestService(db, boss, log);
  }

  async list(limit = 50): Promise<ConversationDto[]> {
    return this.repo.findMany(limit);
  }

  async getById(id: string): Promise<ConversationDto> {
    const c = await this.repo.findById(id);
    if (!c) throw new ORPCError('NOT_FOUND', { message: 'conversation not found' });
    return c;
  }

  async create(data: {
    title: string;
    defaultGithubUrl?: string;
    defaultWorkflowId?: string;
  }): Promise<ConversationDto> {
    return this.repo.create(data);
  }

  async update(
    id: string,
    patch: {
      title?: string;
      defaultGithubUrl?: string | null;
      defaultWorkflowId?: string | null;
      planHoldHours?: number;
      model?: string | null;
    },
  ): Promise<ConversationDto> {
    const result = await this.repo.update(id, patch);
    if (!result) throw new ORPCError('NOT_FOUND', { message: 'conversation not found' });
    return result;
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  async listMessages(
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<{ messages: MessageDto[]; hasMore: boolean }> {
    return this.repo.findMessages(conversationId, limit, before);
  }

  async sendMessage(input: SendMessageInput): Promise<{ messageId: string; jobId: string | null }> {
    const conv = await this.repo.findById(input.conversationId);
    if (!conv) throw new ORPCError('NOT_FOUND', { message: 'conversation not found' });

    // Insert user message immediately
    const userMsg = await this.repo.insertMessage({
      conversationId: input.conversationId,
      role: 'user',
      content: input.content,
    });

    if (!input.triggersJob) {
      return { messageId: userMsg.id, jobId: null };
    }

    // Resolve repo URL: override → conversation default → error
    const githubUrl = input.jobOverrides?.githubUrl ?? conv.defaultGithubUrl;
    if (!githubUrl) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'no githubUrl provided and conversation has no defaultGithubUrl',
      });
    }

    // Find the last completed job in this conversation for parentJobId
    const parentJobId = await this.repo.findLastCompletedJobId(input.conversationId);

    // Parse title + description from message content
    const titleOverride = input.jobOverrides?.title;
    const { title, description } = titleOverride
      ? { title: titleOverride, description: input.content }
      : splitWebInput(input.content);

    // Resolve workflowVersionId: explicit override → conversation default → undefined (system default)
    let workflowVersionId = input.jobOverrides?.workflowVersionId;
    if (!workflowVersionId && conv.defaultWorkflowId) {
      const [latest] = await this.db
        .select({ id: workflowVersions.id })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, conv.defaultWorkflowId))
        .orderBy(desc(workflowVersions.version))
        .limit(1);
      workflowVersionId = latest?.id;
    }

    const { id: jobId } = await this.ingest.ingest({
      source: 'web',
      triggerKind: 'user_prompt',
      title,
      description,
      metadata: {},
      githubUrl,
      githubBranch: 'main',
      conversationId: input.conversationId,
      parentJobId: parentJobId ?? undefined,
      workflowVersionId,
      model: conv.model ?? null,
      autoApprove: input.jobOverrides?.autoApprove ?? false,
    });

    // Backfill message with jobId
    await this.repo.updateMessageJobId(userMsg.id, jobId);

    return { messageId: userMsg.id, jobId };
  }
}
