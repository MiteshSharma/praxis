import type { PluginDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { plugins } from '@shared/db';
import { eq } from 'drizzle-orm';
import { toPluginDto } from './conversations.repository';

export class PluginsRepository {
  constructor(private readonly db: Database) {}

  async findByConversation(conversationId: string): Promise<PluginDto[]> {
    const rows = await this.db.select().from(plugins).where(eq(plugins.conversationId, conversationId));
    return rows.map(toPluginDto);
  }

  async create(data: {
    conversationId: string;
    name: string;
    transport: 'stdio' | 'http';
    command?: string;
    url?: string;
    env?: Record<string, string>;
  }): Promise<PluginDto> {
    const [row] = await this.db.insert(plugins).values({
      conversationId: data.conversationId,
      name: data.name,
      transport: data.transport,
      command: data.command ?? null,
      url: data.url ?? null,
      env: data.env ?? {},
    }).returning();
    if (!row) throw new Error('plugin insert failed');
    return toPluginDto(row);
  }

  async toggle(id: string, enabled: boolean): Promise<PluginDto | null> {
    const [row] = await this.db.update(plugins).set({ enabled }).where(eq(plugins.id, id)).returning();
    return row ? toPluginDto(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(plugins).where(eq(plugins.id, id));
  }
}
