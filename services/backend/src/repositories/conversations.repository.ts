import type { ConversationDto, MessageDto, PluginDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { conversations, messages, plugins } from '@shared/db';
import { and, asc, desc, eq, lt } from 'drizzle-orm';

export function toConversationDto(row: typeof conversations.$inferSelect): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    defaultGithubUrl: row.defaultGithubUrl,
    defaultWorkflowId: row.defaultWorkflowId,
    planHoldHours: row.planHoldHours,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessageDto(row: typeof messages.$inferSelect): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as MessageDto['role'],
    content: row.content,
    jobId: row.jobId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPluginDto(row: typeof plugins.$inferSelect): PluginDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    name: row.name,
    transport: row.transport as PluginDto['transport'],
    command: row.command,
    url: row.url,
    env: (row.env ?? {}) as Record<string, string>,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

export class ConversationsRepository {
  constructor(private readonly db: Database) {}

  async findMany(limit: number): Promise<ConversationDto[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows.map(toConversationDto);
  }

  async findById(id: string): Promise<ConversationDto | null> {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    return row ? toConversationDto(row) : null;
  }

  async create(data: { title: string; defaultGithubUrl?: string; defaultWorkflowId?: string }): Promise<ConversationDto> {
    const [row] = await this.db.insert(conversations).values({
      title: data.title,
      defaultGithubUrl: data.defaultGithubUrl ?? null,
      defaultWorkflowId: data.defaultWorkflowId ?? null,
    }).returning();
    if (!row) throw new Error('conversations insert failed');
    return toConversationDto(row);
  }

  async update(id: string, patch: { title?: string; defaultGithubUrl?: string | null; defaultWorkflowId?: string | null; planHoldHours?: number }): Promise<ConversationDto | null> {
    const [row] = await this.db
      .update(conversations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return row ? toConversationDto(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(conversations).where(eq(conversations.id, id));
  }

  async findMessages(
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<{ messages: MessageDto[]; hasMore: boolean }> {
    const whereClause = before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, new Date(before)))
      : eq(messages.conversationId, conversationId);

    const rows = await this.db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: page.map(toMessageDto), hasMore };
  }

  async insertMessage(data: {
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    jobId?: string | null;
  }): Promise<MessageDto> {
    const [row] = await this.db.insert(messages).values({
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      jobId: data.jobId ?? null,
    }).returning();
    if (!row) throw new Error('message insert failed');
    return toMessageDto(row);
  }

  async updateMessageJobId(messageId: string, jobId: string): Promise<void> {
    await this.db.update(messages).set({ jobId }).where(eq(messages.id, messageId));
  }

  async findLastCompletedJobId(conversationId: string): Promise<string | null> {
    // Find the most recent message that has a job_id set
    const rows = await this.db
      .select({ jobId: messages.jobId })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    return rows.find((r) => r.jobId != null)?.jobId ?? null;
  }
}
