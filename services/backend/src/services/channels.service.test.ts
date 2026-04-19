import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository before importing the service
const mockRepo = {
  findBySession: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  toggle: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../repositories/session-channels.repository', () => ({
  SessionChannelsRepository: vi.fn().mockImplementation(() => mockRepo),
}));

// Mock validateChannelConfig so we can spy on it
const mockValidateChannelConfig = vi.fn();
vi.mock('@shared/core', () => ({
  validateChannelConfig: mockValidateChannelConfig,
}));

const { ChannelsService } = await import('./channels.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChannelDto(overrides = {}) {
  return {
    id: 'ch-1',
    sessionId: 'conv-1',
    type: 'webhook',
    name: 'My Webhook',
    config: { url: 'https://example.com/hook' },
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChannelsService', () => {
  let service: InstanceType<typeof ChannelsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateChannelConfig.mockReturnValue(undefined); // reset to no-op
    service = new ChannelsService({} as never);
  });

  describe('create', () => {
    it('calls validateChannelConfig before creating', async () => {
      const dto = makeChannelDto();
      mockRepo.create.mockResolvedValue(dto);

      await service.create({
        sessionId: 'conv-1',
        type: 'webhook',
        name: 'My Webhook',
        config: { url: 'https://example.com/hook' },
      });

      expect(mockValidateChannelConfig).toHaveBeenCalledWith('webhook', {
        url: 'https://example.com/hook',
      });
    });

    it('propagates validation errors from validateChannelConfig', async () => {
      mockValidateChannelConfig.mockImplementation(() => {
        throw new Error('webhook channel requires a "url" in config');
      });

      await expect(
        service.create({
          sessionId: 'conv-1',
          type: 'webhook',
          name: 'no-url',
          config: {},
        }),
      ).rejects.toThrow('requires a "url"');
    });

    it('calls repo.create with the input after validation passes', async () => {
      const dto = makeChannelDto();
      mockRepo.create.mockResolvedValue(dto);

      const result = await service.create({
        sessionId: 'conv-1',
        type: 'webhook',
        name: 'My Webhook',
        config: { url: 'https://example.com' },
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'conv-1', type: 'webhook' }),
      );
      expect(result).toBe(dto);
    });
  });

  describe('toggle', () => {
    it('returns the updated channel when found', async () => {
      const dto = makeChannelDto({ enabled: false });
      mockRepo.toggle.mockResolvedValue(dto);

      const result = await service.toggle('ch-1', false);
      expect(result.enabled).toBe(false);
      expect(mockRepo.toggle).toHaveBeenCalledWith('ch-1', false);
    });

    it('throws NOT_FOUND when repo returns null', async () => {
      mockRepo.toggle.mockResolvedValue(null);
      await expect(service.toggle('missing', true)).rejects.toThrow('channel not found');
    });
  });

  describe('list', () => {
    it('returns channels from the repository', async () => {
      const channels = [makeChannelDto(), makeChannelDto({ id: 'ch-2' })];
      mockRepo.findBySession.mockResolvedValue(channels);

      const result = await service.list('conv-1');
      expect(result).toBe(channels);
    });
  });

  describe('delete', () => {
    it('delegates to repo.delete', async () => {
      await service.delete('ch-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('ch-1');
    });
  });
});
