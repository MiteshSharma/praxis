import { ORPCError } from '@orpc/server';
import type { ConversationChannelDto } from '@shared/contracts';
import { validateChannelConfig } from '@shared/core';
import type { Database } from '@shared/db';
import { ConversationChannelsRepository } from '../repositories/conversation-channels.repository';

export class ChannelsService {
  private readonly repo: ConversationChannelsRepository;

  constructor(db: Database) {
    this.repo = new ConversationChannelsRepository(db);
  }

  async list(conversationId: string): Promise<ConversationChannelDto[]> {
    return this.repo.findByConversation(conversationId);
  }

  async create(data: {
    conversationId: string;
    type: 'webhook';
    name: string;
    config: Record<string, unknown>;
  }): Promise<ConversationChannelDto> {
    validateChannelConfig(data.type, data.config);
    return this.repo.create(data);
  }

  async toggle(id: string, enabled: boolean): Promise<ConversationChannelDto> {
    const result = await this.repo.toggle(id, enabled);
    if (!result) throw new ORPCError('NOT_FOUND', { message: 'channel not found' });
    return result;
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
