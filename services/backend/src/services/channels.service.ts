import { ORPCError } from '@orpc/server';
import type { SessionChannelDto } from '@shared/contracts';
import { validateChannelConfig } from '@shared/core';
import type { Database } from '@shared/db';
import { SessionChannelsRepository } from '../repositories/session-channels.repository';

export class ChannelsService {
  private readonly repo: SessionChannelsRepository;

  constructor(db: Database) {
    this.repo = new SessionChannelsRepository(db);
  }

  async list(sessionId: string): Promise<SessionChannelDto[]> {
    return this.repo.findBySession(sessionId);
  }

  async create(data: {
    sessionId: string;
    type: 'webhook';
    name: string;
    config: Record<string, unknown>;
  }): Promise<SessionChannelDto> {
    validateChannelConfig(data.type, data.config);
    return this.repo.create(data);
  }

  async toggle(id: string, enabled: boolean): Promise<SessionChannelDto> {
    const result = await this.repo.toggle(id, enabled);
    if (!result) throw new ORPCError('NOT_FOUND', { message: 'channel not found' });
    return result;
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
