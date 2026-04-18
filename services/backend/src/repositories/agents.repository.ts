import type { AgentDto, AgentVersionDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { agentSkills, agentVersions, agents } from '@shared/db';
import { and, asc, desc, eq } from 'drizzle-orm';

export function toAgentVersionDto(row: typeof agentVersions.$inferSelect): AgentVersionDto {
  return {
    id: row.id,
    agentId: row.agentId,
    version: row.version,
    source: row.source,
    contentUri: row.contentUri,
    definition: row.definition as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAgentDto(
  row: typeof agents.$inferSelect,
  latestVersion: typeof agentVersions.$inferSelect | null,
): AgentDto {
  return {
    id: row.id,
    kind: row.kind as 'agent' | 'skill',
    name: row.name,
    description: row.description,
    latestVersion: latestVersion ? toAgentVersionDto(latestVersion) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AgentsRepository {
  constructor(private readonly db: Database) {}

  async findMany(limit: number, kind?: 'agent' | 'skill'): Promise<AgentDto[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(kind ? eq(agents.kind, kind) : undefined)
      .orderBy(desc(agents.createdAt))
      .limit(limit);

    const result: AgentDto[] = [];
    for (const row of rows) {
      const [latest] = await this.db
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.agentId, row.id))
        .orderBy(desc(agentVersions.version))
        .limit(1);
      result.push(toAgentDto(row, latest ?? null));
    }
    return result;
  }

  async findById(id: string): Promise<AgentDto | null> {
    const [row] = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!row) return null;
    const [latest] = await this.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, id))
      .orderBy(desc(agentVersions.version))
      .limit(1);
    return toAgentDto(row, latest ?? null);
  }

  async create(
    kind: 'agent' | 'skill',
    name: string,
    description: string,
    source: string,
    contentUri: string,
    definition: Record<string, unknown>,
  ): Promise<AgentDto> {
    const [agent] = await this.db
      .insert(agents)
      .values({ kind, name, description })
      .returning();

    if (!agent) throw new Error('agent insert failed');

    const [version] = await this.db
      .insert(agentVersions)
      .values({
        agentId: agent.id,
        version: 1,
        source,
        contentUri,
        definition,
      })
      .returning();

    if (!version) throw new Error('agent version insert failed');

    return toAgentDto(agent, version);
  }

  async update(
    id: string,
    name: string,
    description: string,
    definition: Record<string, unknown>,
  ): Promise<AgentDto> {
    await this.db
      .update(agents)
      .set({ name, description, updatedAt: new Date() })
      .where(eq(agents.id, id));

    const [latest] = await this.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, id))
      .orderBy(desc(agentVersions.version))
      .limit(1);

    const nextVersion = (latest?.version ?? 0) + 1;
    const [version] = await this.db
      .insert(agentVersions)
      .values({
        agentId: id,
        version: nextVersion,
        source: 'form',
        contentUri: `form:${Date.now()}`,
        definition,
      })
      .returning();

    if (!version) throw new Error('agent version insert failed');

    const [row] = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!row) throw new Error('agent not found after update');
    return toAgentDto(row, version);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, id));
  }

  async findSkillsForAgent(agentId: string): Promise<AgentDto[]> {
    const junctionRows = await this.db
      .select()
      .from(agentSkills)
      .where(eq(agentSkills.agentId, agentId))
      .orderBy(asc(agentSkills.position));

    const result: AgentDto[] = [];
    for (const jr of junctionRows) {
      const dto = await this.findById(jr.skillId);
      if (dto) result.push(dto);
    }
    return result;
  }

  async attachSkill(agentId: string, skillId: string, position: number): Promise<void> {
    await this.db
      .insert(agentSkills)
      .values({ agentId, skillId, position })
      .onConflictDoUpdate({
        target: [agentSkills.agentId, agentSkills.skillId],
        set: { position },
      });
  }

  async detachSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(agentSkills)
      .where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.skillId, skillId)));
  }
}
