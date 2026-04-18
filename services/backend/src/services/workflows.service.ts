import { ORPCError } from '@orpc/server';
import type { WorkflowDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { loadFromGithub, loadFromInline } from '@shared/workflows';
import { WorkflowsRepository } from '../repositories/workflows.repository';

interface FormStep {
  kind: 'plan' | 'execute' | 'check';
  name: string;
  agentId?: string;
  skillId?: string;
  condition?: 'previous_check_failed';
  command?: string;
  timeoutSeconds?: number;
}

interface CreateWorkflowInput {
  source: 'inline' | 'github' | 'form';
  // form
  name?: string;
  description?: string;
  steps?: FormStep[];
  // inline
  inlineContent?: string;
  // github
  githubUrl?: string;
  commitSha?: string;
}

export class WorkflowsService {
  private readonly repo: WorkflowsRepository;

  constructor(db: Database) {
    this.repo = new WorkflowsRepository(db);
  }

  private buildStepDefinition(s: FormStep): Record<string, unknown> {
    if (s.kind === 'check') {
      return {
        kind: 'check' as const,
        name: s.name,
        command: s.command ?? '',
        timeoutSeconds: s.timeoutSeconds ?? 300,
      };
    }
    return {
      kind: s.kind,
      name: s.name,
      ...(s.agentId ? { agent: { ref: 'id' as const, agentId: s.agentId } } : {}),
      ...(s.skillId ? { skillId: s.skillId } : {}),
      ...(s.condition ? { condition: s.condition } : {}),
    };
  }

  async list(limit = 50): Promise<WorkflowDto[]> {
    return this.repo.findMany(limit);
  }

  async getById(id: string): Promise<WorkflowDto> {
    const wf = await this.repo.findById(id);
    if (!wf) throw new ORPCError('NOT_FOUND', { message: 'workflow not found' });
    return wf;
  }

  async update(input: { id: string; name: string; description?: string; steps: FormStep[] }): Promise<WorkflowDto> {
    if (!input.steps || input.steps.length === 0) {
      throw new ORPCError('BAD_REQUEST', { message: 'at least one step is required' });
    }
    const definition = { steps: input.steps.map((s) => this.buildStepDefinition(s)) };
    return this.repo.update(
      input.id,
      input.name,
      input.description ?? '',
      definition as unknown as Record<string, unknown>,
    );
  }

  async create(input: CreateWorkflowInput): Promise<WorkflowDto> {
    if (input.source === 'form') {
      if (!input.name) {
        throw new ORPCError('BAD_REQUEST', { message: 'name is required' });
      }
      if (!input.steps || input.steps.length === 0) {
        throw new ORPCError('BAD_REQUEST', { message: 'at least one step is required' });
      }
      const definition = {
        steps: input.steps.map((s) => this.buildStepDefinition(s)),
      };
      const contentUri = `form:${Date.now()}`;
      return this.repo.create(
        input.name,
        input.description ?? '',
        'form',
        contentUri,
        definition as unknown as Record<string, unknown>,
      );
    }

    if (input.source === 'inline') {
      if (!input.inlineContent) {
        throw new ORPCError('BAD_REQUEST', { message: 'inlineContent required for inline source' });
      }
      const { definition, bodyMarkdown } = loadFromInline(input.inlineContent);
      if (definition.kind !== 'workflow') {
        throw new ORPCError('BAD_REQUEST', { message: 'expected a workflow file (kind: workflow)' });
      }
      const contentUri = `inline:${Date.now()}`;
      return this.repo.create(
        definition.name,
        definition.description,
        'inline',
        contentUri,
        definition.workflow as unknown as Record<string, unknown>,
      );
    }

    if (input.source === 'github') {
      if (!input.githubUrl) {
        throw new ORPCError('BAD_REQUEST', { message: 'githubUrl required for github source' });
      }
      const token = process.env.GITHUB_TOKEN;
      const { definition, commitSha } = await loadFromGithub(
        input.githubUrl,
        input.commitSha,
        token,
      );
      if (definition.kind !== 'workflow') {
        throw new ORPCError('BAD_REQUEST', { message: 'expected a workflow file (kind: workflow)' });
      }
      const contentUri = `github:${input.githubUrl}@${commitSha}`;
      return this.repo.create(
        definition.name,
        definition.description,
        'github',
        contentUri,
        definition.workflow as unknown as Record<string, unknown>,
      );
    }

    throw new ORPCError('BAD_REQUEST', { message: 'invalid source' });
  }
}
