import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  findByConversation: vi.fn().mockResolvedValue([]),  // repo method name stays as-is
  create: vi.fn(),
  toggle: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../repositories/plugins.repository', () => ({
  PluginsRepository: vi.fn().mockImplementation(() => mockRepo),
}));

const { PluginsService } = await import('./plugins.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePluginDto(overrides = {}) {
  return {
    id: 'plugin-1',
    sessionId: 'conv-1',
    name: 'my-plugin',
    transport: 'stdio',
    command: 'node plugin.js',
    url: null,
    env: {},
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PluginsService', () => {
  let service: InstanceType<typeof PluginsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PluginsService({} as never);
  });

  describe('create', () => {
    it('throws BAD_REQUEST when stdio transport has no command', async () => {
      await expect(
        service.create({
          sessionId: 'conv-1',
          name: 'my-plugin',
          transport: 'stdio',
        }),
      ).rejects.toThrow('command required for stdio transport');
    });

    it('throws BAD_REQUEST when http transport has no url', async () => {
      await expect(
        service.create({
          sessionId: 'conv-1',
          name: 'http-plugin',
          transport: 'http',
        }),
      ).rejects.toThrow('url required for http transport');
    });

    it('creates stdio plugin when command is provided', async () => {
      const dto = makePluginDto();
      mockRepo.create.mockResolvedValue(dto);

      const result = await service.create({
        sessionId: 'conv-1',
        name: 'my-plugin',
        transport: 'stdio',
        command: 'node plugin.js',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ transport: 'stdio', command: 'node plugin.js' }),
      );
      expect(result).toBe(dto);
    });

    it('creates http plugin when url is provided', async () => {
      const dto = makePluginDto({ transport: 'http', url: 'http://localhost:8080', command: null });
      mockRepo.create.mockResolvedValue(dto);

      const result = await service.create({
        sessionId: 'conv-1',
        name: 'http-plugin',
        transport: 'http',
        url: 'http://localhost:8080',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ transport: 'http', url: 'http://localhost:8080' }),
      );
      expect(result).toBe(dto);
    });

    it('passes env vars through to the repository', async () => {
      const dto = makePluginDto({ env: { API_KEY: 'secret' } });
      mockRepo.create.mockResolvedValue(dto);

      await service.create({
        sessionId: 'conv-1',
        name: 'my-plugin',
        transport: 'stdio',
        command: 'node plugin.js',
        env: { API_KEY: 'secret' },
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ env: { API_KEY: 'secret' } }),
      );
    });
  });

  describe('toggle', () => {
    it('returns updated plugin when found', async () => {
      const dto = makePluginDto({ enabled: false });
      mockRepo.toggle.mockResolvedValue(dto);

      const result = await service.toggle('plugin-1', false);
      expect(result.enabled).toBe(false);
    });

    it('throws NOT_FOUND when repo returns null', async () => {
      mockRepo.toggle.mockResolvedValue(null);
      await expect(service.toggle('missing', true)).rejects.toThrow('plugin not found');
    });
  });

  describe('list', () => {
    it('delegates to repo.findByConversation', async () => {
      const plugins = [makePluginDto()];
      mockRepo.findByConversation.mockResolvedValue(plugins);

      const result = await service.list('conv-1');
      expect(result).toBe(plugins);
      expect(mockRepo.findByConversation).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('delete', () => {
    it('delegates to repo.delete', async () => {
      await service.delete('plugin-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('plugin-1');
    });
  });
});
