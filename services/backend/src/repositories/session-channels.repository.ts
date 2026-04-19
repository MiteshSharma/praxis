import type { SessionChannelDto } from '@shared/contracts';
import { type Database, conversationChannels } from '@shared/db';
import { eq } from 'drizzle-orm';

function toDto(row: typeof conversationChannels.$inferSelect): SessionChannelDto {
  return {
    id: row.id,
    sessionId: row.conversationId,
    type: row.type as SessionChannelDto['type'],
    name: row.name,
    config: row.config as Record<string, unknown>,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

export class SessionChannelsRepository {
  constructor(private readonly db: Database) {}

  async findBySession(sessionId: string): Promise<SessionChannelDto[]> {
    const rows = await this.db
      .select()
      .from(conversationChannels)
      .where(eq(conversationChannels.conversationId, sessionId));
    return rows.map(toDto);
  }

  async create(data: {
    sessionId: string;
    type: string;
    name: string;
    config: Record<string, unknown>;
  }): Promise<SessionChannelDto> {
    const [row] = await this.db
      .insert(conversationChannels)
      .values({ conversationId: data.sessionId, type: data.type, name: data.name, config: data.config })
      .returning();
    if (!row) throw new Error('conversation_channels insert failed');
    return toDto(row);
  }

  async toggle(id: string, enabled: boolean): Promise<SessionChannelDto | null> {
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
