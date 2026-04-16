import type { Database } from '@shared/db';
import { plugins } from '@shared/db';
import { and, eq } from 'drizzle-orm';

export interface ResolvedPlugin {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
  env?: Record<string, string>;
}

export class PluginRegistry {
  constructor(private readonly db: Database) {}

  async resolveForConversation(conversationId: string | null | undefined): Promise<ResolvedPlugin[]> {
    if (!conversationId) return [];
    const rows = await this.db
      .select()
      .from(plugins)
      .where(and(eq(plugins.conversationId, conversationId), eq(plugins.enabled, true)));
    return rows.map((r) => ({
      name: r.name,
      transport: r.transport as 'stdio' | 'http',
      command: r.command ?? undefined,
      url: r.url ?? undefined,
      env: (r.env ?? {}) as Record<string, string>,
    }));
  }
}
