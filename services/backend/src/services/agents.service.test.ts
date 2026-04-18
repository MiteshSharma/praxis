import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock AgentsRepository ─────────────────────────────────────────────────────

const mockRepo = {
  findMany: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  findSkillsForAgent: vi.fn().mockResolvedValue([]),
  attachSkill: vi.fn().mockResolvedValue(undefined),
  detachSkill: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../repositories/agents.repository', () => ({
  AgentsRepository: vi.fn().mockImplementation(() => mockRepo),
}));

// ── Mock @shared/workflows ────────────────────────────────────────────────────

const mockLoadFromInline = vi.fn();
const mockLoadFromGithub = vi.fn();

vi.mock('@shared/workflows', () => ({
  loadFromInline: mockLoadFromInline,
  loadFromGithub: mockLoadFromGithub,
}));

const { AgentsService } = await import('./agents.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgentDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    kind: 'agent',
    name: 'My Agent',
    description: 'Does stuff',
    latestVersion: {
      id: 'ver-1',
      agentId: 'agent-1',
      version: 1,
      source: 'form',
      contentUri: 'form:1234',
      definition: {},
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentsService', () => {
  let service: InstanceType<typeof AgentsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentsService({} as never);
  });

  describe('create — form source', () => {
    it('throws BAD_REQUEST when name is missing', async () => {
      await expect(
        service.create({ source: 'form', systemPrompt: 'Be helpful' }),
      ).rejects.toThrow('name is required');
    });

    it('throws BAD_REQUEST when systemPrompt is missing', async () => {
      await expect(
        service.create({ source: 'form', name: 'MyAgent' }),
      ).rejects.toThrow('systemPrompt is required');
    });

    it('creates agent with defaults when optional fields are absent', async () => {
      const dto = makeAgentDto();
      mockRepo.create.mockResolvedValue(dto);

      await service.create({ source: 'form', name: 'MyAgent', systemPrompt: 'Be helpful' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        'agent',                  // kind default
        'MyAgent',
        '',                       // description default
        'form',
        expect.stringContaining('form:'),
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          systemPrompt: 'Be helpful',
          allowedTools: [],
        }),
      );
    });

    it('respects explicit kind=skill', async () => {
      const dto = makeAgentDto({ kind: 'skill' });
      mockRepo.create.mockResolvedValue(dto);

      await service.create({
        source: 'form',
        kind: 'skill',
        name: 'MySkill',
        systemPrompt: 'Be a skill',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        'skill', expect.any(String), expect.any(String), expect.any(String),
        expect.any(String), expect.any(Object),
      );
    });

    it('returns the dto from the repository', async () => {
      const dto = makeAgentDto();
      mockRepo.create.mockResolvedValue(dto);

      const result = await service.create({
        source: 'form',
        name: 'MyAgent',
        systemPrompt: 'Be helpful',
        model: 'claude-opus-4-6',
        allowedTools: ['read_file'],
        description: 'An agent',
      });

      expect(result).toBe(dto);
    });
  });

  describe('create — inline source', () => {
    it('throws BAD_REQUEST when inlineContent is missing', async () => {
      await expect(service.create({ source: 'inline' })).rejects.toThrow(
        'inlineContent required',
      );
    });

    it('throws BAD_REQUEST when loaded definition is not kind=agent', async () => {
      mockLoadFromInline.mockReturnValue({
        definition: { kind: 'workflow', name: 'WF', description: '', workflow: {} },
      });
      await expect(
        service.create({ source: 'inline', inlineContent: 'kind: workflow\n---\n' }),
      ).rejects.toThrow('expected an agent file');
    });

    it('creates agent from valid inline content', async () => {
      const dto = makeAgentDto();
      mockRepo.create.mockResolvedValue(dto);
      mockLoadFromInline.mockReturnValue({
        definition: {
          kind: 'agent',
          name: 'InlineAgent',
          description: 'inline',
          agent: { model: 'claude-sonnet-4-6', systemPrompt: 'hi', allowedTools: [] },
        },
      });

      const result = await service.create({
        source: 'inline',
        inlineContent: 'kind: agent\n---\n',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.any(String), 'InlineAgent', 'inline', 'inline',
        expect.stringContaining('inline:'), expect.any(Object),
      );
      expect(result).toBe(dto);
    });
  });

  describe('create — github source', () => {
    it('throws BAD_REQUEST when githubUrl is missing', async () => {
      await expect(service.create({ source: 'github' })).rejects.toThrow('githubUrl required');
    });

    it('throws BAD_REQUEST when loaded definition is not kind=agent', async () => {
      mockLoadFromGithub.mockResolvedValue({
        definition: { kind: 'workflow', name: 'WF', description: '', workflow: {} },
        commitSha: 'abc123',
      });
      await expect(
        service.create({ source: 'github', githubUrl: 'https://github.com/owner/repo/agent.yaml' }),
      ).rejects.toThrow('expected an agent file');
    });

    it('embeds commitSha in contentUri', async () => {
      const dto = makeAgentDto();
      mockRepo.create.mockResolvedValue(dto);
      mockLoadFromGithub.mockResolvedValue({
        definition: {
          kind: 'agent',
          name: 'GHAgent',
          description: 'from github',
          agent: { model: 'claude-sonnet-4-6', systemPrompt: 'hi', allowedTools: [] },
        },
        commitSha: 'deadbeef',
      });

      await service.create({
        source: 'github',
        githubUrl: 'https://github.com/owner/repo/agent.yaml',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.any(String), 'GHAgent', 'from github', 'github',
        'github:https://github.com/owner/repo/agent.yaml@deadbeef',
        expect.any(Object),
      );
    });
  });

  describe('listSkills', () => {
    it('throws NOT_FOUND when agent does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.listSkills('missing')).rejects.toThrow('agent not found');
    });

    it('throws BAD_REQUEST when the agent is actually a skill (kind=skill)', async () => {
      mockRepo.findById.mockResolvedValue(makeAgentDto({ kind: 'skill' }));
      await expect(service.listSkills('skill-id')).rejects.toThrow(
        'only agents (not skills) can have skills attached',
      );
    });

    it('returns skills from the repository for a valid agent', async () => {
      const skillDtos = [makeAgentDto({ id: 'skill-1', kind: 'skill' })];
      mockRepo.findById.mockResolvedValue(makeAgentDto({ kind: 'agent' }));
      mockRepo.findSkillsForAgent.mockResolvedValue(skillDtos);

      const result = await service.listSkills('agent-1');
      expect(result).toBe(skillDtos);
    });
  });

  describe('attachSkill', () => {
    it('throws NOT_FOUND when agent does not exist', async () => {
      mockRepo.findById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeAgentDto({ kind: 'skill' }));
      await expect(service.attachSkill('missing', 'skill-1', 0)).rejects.toThrow('agent not found');
    });

    it('throws NOT_FOUND when skill does not exist', async () => {
      mockRepo.findById
        .mockResolvedValueOnce(makeAgentDto({ kind: 'agent' }))
        .mockResolvedValueOnce(null);
      await expect(service.attachSkill('agent-1', 'missing', 0)).rejects.toThrow('skill not found');
    });

    it('throws BAD_REQUEST when agentId refers to a skill row', async () => {
      mockRepo.findById
        .mockResolvedValueOnce(makeAgentDto({ kind: 'skill' }))
        .mockResolvedValueOnce(makeAgentDto({ kind: 'skill' }));
      await expect(service.attachSkill('skill-as-agent', 'skill-1', 0)).rejects.toThrow(
        'agentId must refer to a kind=agent row',
      );
    });

    it('throws BAD_REQUEST when skillId refers to an agent row', async () => {
      mockRepo.findById
        .mockResolvedValueOnce(makeAgentDto({ kind: 'agent' }))
        .mockResolvedValueOnce(makeAgentDto({ kind: 'agent' }));
      await expect(service.attachSkill('agent-1', 'agent-as-skill', 0)).rejects.toThrow(
        'skillId must refer to a kind=skill row',
      );
    });

    it('calls repo.attachSkill with correct args when both are valid', async () => {
      mockRepo.findById
        .mockResolvedValueOnce(makeAgentDto({ kind: 'agent' }))
        .mockResolvedValueOnce(makeAgentDto({ id: 'skill-1', kind: 'skill' }));

      await service.attachSkill('agent-1', 'skill-1', 2);
      expect(mockRepo.attachSkill).toHaveBeenCalledWith('agent-1', 'skill-1', 2);
    });
  });

  describe('getById', () => {
    it('throws NOT_FOUND when agent does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow('agent not found');
    });

    it('returns the agent when found', async () => {
      const dto = makeAgentDto();
      mockRepo.findById.mockResolvedValue(dto);
      expect(await service.getById('agent-1')).toBe(dto);
    });
  });
});
