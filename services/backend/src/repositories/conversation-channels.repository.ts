import type { ConversationChannelDto } from '@shared/contracts';
import { type Database, conversationChannels } from '@shared/db';
import { eq } from 'drizzle-orm';

function toDto(row: typeof conversationChannels.$inferSelect): ConversationChannelDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    type: row.type as ConversationChannelDto['type'],
    name: row.name,
    config: row.config as Record<string, unknown>,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

export class ConversationChannelsRepository {
  constructor(private readonly db: Database) {}

  async findByConversation(conversationId: string): Promise<ConversationChannelDto[]> {
    const rows = await this.db
      .select()
      .from(conversationChannels)
      .where(eq(conversationChannels.conversationId, conversationId));
    return rows.map(toDto);
  }

  async create(data: {
    conversationId: string;
    type: string;
    name: string;
    config: Record<string, unknown>;
  }): Promise<ConversationChannelDto> {
    const [row] = await this.db
      .insert(conversationChannels)
      .values(data)
      .returning();
    if (!row) throw new Error('conversation_channels insert failed');
    return toDto(row);
  }

  async toggle(id: string, enabled: boolean): Promise<ConversationChannelDto | null> {
    const [row] = await this.db
      .update(conversationChannels)
      .set({ enabled })
      .where(eq(conversationChannels.id, id))
      .returning();
    return row ? toDto(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(conversationChannels).where(eq(conversationChannels.id, id));
  }
}
