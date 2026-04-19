import type { MessageDto, PluginDto, SessionDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { artifacts, conversations, messages, plugins } from '@shared/db';
import { and, desc, eq, lt, sql } from 'drizzle-orm';

export function toSessionDto(row: typeof conversations.$inferSelect): SessionDto {
  return {
    id: row.id,
    title: row.title,
    defaultGithubUrl: row.defaultGithubUrl,
    defaultWorkflowId: row.defaultWorkflowId,
    planHoldHours: row.planHoldHours,
    model: row.model ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessageDto(row: typeof messages.$inferSelect & { prArtifactUrl?: string | null }): MessageDto {
  return {
    id: row.id,
    sessionId: row.conversationId,
    role: row.role as MessageDto['role'],
    content: row.content,
    jobId: row.jobId,
    prArtifactUrl: row.prArtifactUrl ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPluginDto(row: typeof plugins.$inferSelect): PluginDto {
  return {
    id: row.id,
    sessionId: row.conversationId,
    name: row.name,
    transport: row.transport as PluginDto['transport'],
    command: row.command,
    url: row.url,
    env: (row.env ?? {}) as Record<string, string>,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

export class SessionsRepository {
  constructor(private readonly db: Database) {}

  async findMany(limit: number): Promise<SessionDto[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows.map(toSessionDto);
  }

  async findById(id: string): Promise<SessionDto | null> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return row ? toSessionDto(row) : null;
  }

  async create(data: {
    title: string;
    defaultGithubUrl?: string;
    defaultWorkflowId?: string;
    model?: string;
  }): Promise<SessionDto> {
    const [row] = await this.db
      .insert(conversations)
      .values({
        title: data.title,
        defaultGithubUrl: data.defaultGithubUrl ?? null,
        defaultWorkflowId: data.defaultWorkflowId ?? null,
        model: data.model ?? null,
      })
      .returning();
    if (!row) throw new Error('conversations insert failed');
    return toSessionDto(row);
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
  ): Promise<SessionDto | null> {
    const [row] = await this.db
      .update(conversations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return row ? toSessionDto(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(conversations).where(eq(conversations.id, id));
  }

  async findMessages(
    sessionId: string,
    limit: number,
    before?: string,
  ): Promise<{ messages: MessageDto[]; hasMore: boolean }> {
    const whereClause = before
      ? and(eq(messages.conversationId, sessionId), lt(messages.createdAt, new Date(before)))
      : eq(messages.conversationId, sessionId);

    const rows = await this.db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
        jobId: messages.jobId,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
        prArtifactUrl: artifacts.url,
      })
      .from(messages)
      .leftJoin(
        artifacts,
        sql`${artifacts.jobId} = ${messages.jobId} AND ${artifacts.kind} = 'pr'`,
      )
      .where(whereClause)
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: page.map(toMessageDto), hasMore };
  }

  async insertMessage(data: {
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    jobId?: string | null;
  }): Promise<MessageDto> {
    const [row] = await this.db
      .insert(messages)
      .values({
        conversationId: data.sessionId,
        role: data.role,
        content: data.content,
        jobId: data.jobId ?? null,
      })
      .returning();
    if (!row) throw new Error('message insert failed');
    return toMessageDto(row);
  }

  async updateMessageJobId(messageId: string, jobId: string): Promise<void> {
    await this.db.update(messages).set({ jobId }).where(eq(messages.id, messageId));
  }

  async findLastCompletedJobId(sessionId: string): Promise<string | null> {
    const rows = await this.db
      .select({ jobId: messages.jobId })
      .from(messages)
      .where(eq(messages.conversationId, sessionId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    return rows.find((r) => r.jobId != null)?.jobId ?? null;
  }
}
