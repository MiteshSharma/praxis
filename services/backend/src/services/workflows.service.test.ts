import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock WorkflowsRepository ──────────────────────────────────────────────────

const mockRepo = {
  findMany: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
};

vi.mock('../repositories/workflows.repository', () => ({
  WorkflowsRepository: vi.fn().mockImplementation(() => mockRepo),
}));

// ── Mock @shared/workflows ────────────────────────────────────────────────────

const mockLoadFromInline = vi.fn();
const mockLoadFromGithub = vi.fn();

vi.mock('@shared/workflows', () => ({
  loadFromInline: mockLoadFromInline,
  loadFromGithub: mockLoadFromGithub,
}));

const { WorkflowsService } = await import('./workflows.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWorkflowDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    name: 'My Workflow',
    description: 'Does stuff',
    latestVersion: {
      id: 'wfver-1',
      workflowId: 'wf-1',
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

describe('WorkflowsService', () => {
  let service: InstanceType<typeof WorkflowsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorkflowsService({} as never);
  });

  describe('create — form source', () => {
    it('throws BAD_REQUEST when name is missing', async () => {
      await expect(
        service.create({ source: 'form', steps: [{ kind: 'plan', name: 'Plan' }] }),
      ).rejects.toThrow('name is required');
    });

    it('throws BAD_REQUEST when steps are empty', async () => {
      await expect(
        service.create({ source: 'form', name: 'My Workflow', steps: [] }),
      ).rejects.toThrow('at least one step is required');
    });

    it('throws BAD_REQUEST when steps are missing', async () => {
      await expect(
        service.create({ source: 'form', name: 'My Workflow' }),
      ).rejects.toThrow('at least one step is required');
    });

    it('applies defaults for check step command and timeoutSeconds', async () => {
      const dto = makeWorkflowDto();
      mockRepo.create.mockResolvedValue(dto);

      await service.create({
        source: 'form',
        name: 'My Workflow',
        steps: [{ kind: 'check', name: 'Run tests' }],
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        'My Workflow',
        '',
        'form',
        expect.stringContaining('form:'),
        expect.objectContaining({
          steps: [
            expect.objectContaining({
              kind: 'check',
              name: 'Run tests',
              command: '',
              timeoutSeconds: 300,
            }),
          ],
        }),
      );
    });

    it('passes plan/execute steps through without defaults', async () => {
      const dto = makeWorkflowDto();
      mockRepo.create.mockResolvedValue(dto);

      await service.create({
        source: 'form',
        name: 'My Workflow',
        steps: [{ kind: 'plan', name: 'Plan step' }, { kind: 'execute', name: 'Execute' }],
      });

      const callArgs = mockRepo.create.mock.calls[0];
      const definition = callArgs[4] as { steps: Array<{ kind: string }> };
      expect(definition.steps[0]).toEqual(expect.objectContaining({ kind: 'plan' }));
      expect(definition.steps[0]).not.toHaveProperty('command');
    });

    it('returns the dto from the repository', async () => {
      const dto = makeWorkflowDto();
      mockRepo.create.mockResolvedValue(dto);

      const result = await service.create({
        source: 'form',
        name: 'My Workflow',
        steps: [{ kind: 'plan', name: 'Plan' }],
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

    it('throws BAD_REQUEST when loaded definition is not kind=workflow', async () => {
      mockLoadFromInline.mockReturnValue({
        definition: { kind: 'agent', name: 'Agent', description: '', agent: {} },
        bodyMarkdown: '',
      });
      await expect(
        service.create({ source: 'inline', inlineContent: 'kind: agent\n---\n' }),
      ).rejects.toThrow('expected a workflow file');
    });

    it('creates workflow from valid inline content', async () => {
      const dto = makeWorkflowDto();
      mockRepo.create.mockResolvedValue(dto);
      mockLoadFromInline.mockReturnValue({
        definition: {
          kind: 'workflow',
          name: 'InlineWorkflow',
          description: 'inline wf',
          workflow: { steps: [] },
        },
        bodyMarkdown: '',
      });

      const result = await service.create({
        source: 'inline',
        inlineContent: 'kind: workflow\n---\n',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        'InlineWorkflow', 'inline wf', 'inline',
        expect.stringContaining('inline:'), expect.any(Object),
      );
      expect(result).toBe(dto);
    });
  });

  describe('create — github source', () => {
    it('throws BAD_REQUEST when githubUrl is missing', async () => {
      await expect(service.create({ source: 'github' })).rejects.toThrow('githubUrl required');
    });

    it('throws BAD_REQUEST when loaded definition is not kind=workflow', async () => {
      mockLoadFromGithub.mockResolvedValue({
        definition: { kind: 'agent', name: 'Agent', description: '', agent: {} },
        commitSha: 'abc123',
      });
      await expect(
        service.create({ source: 'github', githubUrl: 'https://github.com/o/r/wf.yaml' }),
      ).rejects.toThrow('expected a workflow file');
    });

    it('embeds commitSha in contentUri', async () => {
      const dto = makeWorkflowDto();
      mockRepo.create.mockResolvedValue(dto);
      mockLoadFromGithub.mockResolvedValue({
        definition: {
          kind: 'workflow',
          name: 'GHWorkflow',
          description: 'from github',
          workflow: { steps: [] },
        },
        commitSha: 'cafebabe',
      });

      await service.create({
        source: 'github',
        githubUrl: 'https://github.com/o/r/wf.yaml',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        'GHWorkflow', 'from github', 'github',
        'github:https://github.com/o/r/wf.yaml@cafebabe',
        expect.any(Object),
      );
    });
  });

  describe('getById', () => {
    it('throws NOT_FOUND when workflow does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow('workflow not found');
    });

    it('returns the workflow when found', async () => {
      const dto = makeWorkflowDto();
      mockRepo.findById.mockResolvedValue(dto);
      expect(await service.getById('wf-1')).toBe(dto);
    });
  });
});
