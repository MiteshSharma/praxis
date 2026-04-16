import { ORPCError } from '@orpc/server';
import type { PluginDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { PluginsRepository } from '../repositories/plugins.repository';

interface CreatePluginInput {
  conversationId: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
  env?: Record<string, string>;
}

export class PluginsService {
  private readonly repo: PluginsRepository;

  constructor(db: Database) {
    this.repo = new PluginsRepository(db);
  }

  async list(conversationId: string): Promise<PluginDto[]> {
    return this.repo.findByConversation(conversationId);
  }

  async create(input: CreatePluginInput): Promise<PluginDto> {
    if (input.transport === 'stdio' && !input.command) {
      throw new ORPCError('BAD_REQUEST', { message: 'command required for stdio transport' });
    }
    if (input.transport === 'http' && !input.url) {
      throw new ORPCError('BAD_REQUEST', { message: 'url required for http transport' });
    }
    return this.repo.create(input);
  }

  async toggle(id: string, enabled: boolean): Promise<PluginDto> {
    const result = await this.repo.toggle(id, enabled);
    if (!result) throw new ORPCError('NOT_FOUND', { message: 'plugin not found' });
    return result;
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
