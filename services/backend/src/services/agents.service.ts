import { ORPCError } from '@orpc/server';
import type { AgentDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { loadFromGithub, loadFromInline } from '@shared/workflows';
import { AgentsRepository } from '../repositories/agents.repository';

interface CreateAgentInput {
  kind?: 'agent' | 'skill';
  source: 'inline' | 'github' | 'form';
  // form
  name?: string;
  description?: string;
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  // inline
  inlineContent?: string;
  // github
  githubUrl?: string;
  commitSha?: string;
}

export class AgentsService {
  private readonly repo: AgentsRepository;

  constructor(db: Database) {
    this.repo = new AgentsRepository(db);
  }

  async list(limit = 50, kind?: 'agent' | 'skill'): Promise<AgentDto[]> {
    return this.repo.findMany(limit, kind);
  }

  async getById(id: string): Promise<AgentDto> {
    const agent = await this.repo.findById(id);
    if (!agent) throw new ORPCError('NOT_FOUND', { message: 'agent not found' });
    return agent;
  }

  async create(input: CreateAgentInput): Promise<AgentDto> {
    const kind = input.kind ?? 'agent';

    if (input.source === 'form') {
      if (!input.name) {
        throw new ORPCError('BAD_REQUEST', { message: 'name is required' });
      }
      if (!input.systemPrompt) {
        throw new ORPCError('BAD_REQUEST', { message: 'systemPrompt is required' });
      }
      const definition = {
        model: input.model ?? 'claude-sonnet-4-6',
        systemPrompt: input.systemPrompt,
        allowedTools: input.allowedTools ?? [],
      };
      const contentUri = `form:${Date.now()}`;
      return this.repo.create(
        kind,
        input.name,
        input.description ?? '',
        'form',
        contentUri,
        definition,
      );
    }

    if (input.source === 'inline') {
      if (!input.inlineContent) {
        throw new ORPCError('BAD_REQUEST', { message: 'inlineContent required for inline source' });
      }
      const { definition } = loadFromInline(input.inlineContent);
      if (definition.kind !== 'agent') {
        throw new ORPCError('BAD_REQUEST', { message: 'expected an agent file (kind: agent)' });
      }
      const contentUri = `inline:${Date.now()}`;
      return this.repo.create(
        kind,
        definition.name,
        definition.description,
        'inline',
        contentUri,
        definition.agent as Record<string, unknown>,
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
      if (definition.kind !== 'agent') {
        throw new ORPCError('BAD_REQUEST', { message: 'expected an agent file (kind: agent)' });
      }
      const contentUri = `github:${input.githubUrl}@${commitSha}`;
      return this.repo.create(
        kind,
        definition.name,
        definition.description,
        'github',
        contentUri,
        definition.agent as Record<string, unknown>,
      );
    }

    throw new ORPCError('BAD_REQUEST', { message: 'invalid source' });
  }

  async delete(id: string): Promise<void> {
    const agent = await this.repo.findById(id);
    if (!agent) throw new ORPCError('NOT_FOUND', { message: 'agent not found' });
    await this.repo.delete(id);
  }

  async listSkills(agentId: string): Promise<AgentDto[]> {
    const agent = await this.repo.findById(agentId);
    if (!agent) throw new ORPCError('NOT_FOUND', { message: 'agent not found' });
    if (agent.kind !== 'agent') {
      throw new ORPCError('BAD_REQUEST', { message: 'only agents (not skills) can have skills attached' });
    }
    return this.repo.findSkillsForAgent(agentId);
  }

  async attachSkill(agentId: string, skillId: string, position: number): Promise<void> {
    const [agent, skill] = await Promise.all([
      this.repo.findById(agentId),
      this.repo.findById(skillId),
    ]);
    if (!agent) throw new ORPCError('NOT_FOUND', { message: 'agent not found' });
    if (!skill) throw new ORPCError('NOT_FOUND', { message: 'skill not found' });
    if (agent.kind !== 'agent') {
      throw new ORPCError('BAD_REQUEST', { message: 'agentId must refer to a kind=agent row' });
    }
    if (skill.kind !== 'skill') {
      throw new ORPCError('BAD_REQUEST', { message: 'skillId must refer to a kind=skill row' });
    }
    await this.repo.attachSkill(agentId, skillId, position);
  }

  async detachSkill(agentId: string, skillId: string): Promise<void> {
    await this.repo.detachSkill(agentId, skillId);
  }
}
