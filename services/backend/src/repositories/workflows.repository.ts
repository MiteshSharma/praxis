import type { WorkflowDto, WorkflowVersionDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { workflowVersions, workflows } from '@shared/db';
import { desc, eq } from 'drizzle-orm';
import { ORPCError } from '@orpc/server';

export function toWorkflowVersionDto(row: typeof workflowVersions.$inferSelect): WorkflowVersionDto {
  return {
    id: row.id,
    workflowId: row.workflowId,
    version: row.version,
    source: row.source,
    contentUri: row.contentUri,
    definition: row.definition as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWorkflowDto(
  row: typeof workflows.$inferSelect,
  latestVersion: typeof workflowVersions.$inferSelect | null,
): WorkflowDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    latestVersion: latestVersion ? toWorkflowVersionDto(latestVersion) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class WorkflowsRepository {
  constructor(private readonly db: Database) {}

  async findMany(limit: number): Promise<WorkflowDto[]> {
    const rows = await this.db
      .select()
      .from(workflows)
      .orderBy(desc(workflows.createdAt))
      .limit(limit);

    const result: WorkflowDto[] = [];
    for (const row of rows) {
      const [latest] = await this.db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, row.id))
        .orderBy(desc(workflowVersions.version))
        .limit(1);
      result.push(toWorkflowDto(row, latest ?? null));
    }
    return result;
  }

  async findById(id: string): Promise<WorkflowDto | null> {
    const [row] = await this.db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!row) return null;
    const [latest] = await this.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, id))
      .orderBy(desc(workflowVersions.version))
      .limit(1);
    return toWorkflowDto(row, latest ?? null);
  }

  async create(
    name: string,
    description: string,
    source: string,
    contentUri: string,
    definition: Record<string, unknown>,
  ): Promise<WorkflowDto> {
    const [wf] = await this.db
      .insert(workflows)
      .values({ name, description })
      .returning();

    if (!wf) throw new Error('workflow insert failed');

    const [version] = await this.db
      .insert(workflowVersions)
      .values({
        workflowId: wf.id,
        version: 1,
        source,
        contentUri,
        definition,
      })
      .returning();

    if (!version) throw new Error('workflow version insert failed');

    return toWorkflowDto(wf, version);
  }

  async update(
    id: string,
    name: string,
    description: string,
    definition: Record<string, unknown>,
  ): Promise<WorkflowDto> {
    // 1. Fetch current max version
    const [latest] = await this.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, id))
      .orderBy(desc(workflowVersions.version))
      .limit(1);
    const nextVersion = (latest?.version ?? 0) + 1;

    // 2. Update the workflows row
    await this.db
      .update(workflows)
      .set({ name, description, updatedAt: new Date() })
      .where(eq(workflows.id, id));

    // 3. Insert new version row
    const [version] = await this.db
      .insert(workflowVersions)
      .values({
        workflowId: id,
        version: nextVersion,
        source: 'form',
        contentUri: `form:${Date.now()}`,
        definition,
      })
      .returning();

    if (!version) throw new Error('workflow version insert failed');

    // 4. Return fresh DTO
    const [wf] = await this.db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!wf) throw new ORPCError('NOT_FOUND', { message: 'workflow not found' });
    return toWorkflowDto(wf, version);
  }
}
