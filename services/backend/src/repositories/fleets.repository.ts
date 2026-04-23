import type { FleetDto, FleetGraphDto, FleetJobDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { conversations, fleetJobDeps, fleetJobs, fleets, jobSteps, jobs, messages } from '@shared/db';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';

function toFleetDto(
  row: typeof fleets.$inferSelect,
  counts: { total: number; completed: number; noop: number; failed: number; running: number },
): FleetDto {
  return {
    id: row.id,
    title: row.title,
    goal: row.goal,
    mode: row.mode as FleetDto['mode'],
    status: row.status as FleetDto['status'],
    autoApprove: row.autoApprove,
    maxParallel: row.maxParallel,
    totalJobs: counts.total,
    completedJobs: counts.completed,
    noopJobs: counts.noop,
    failedJobs: counts.failed,
    runningJobs: counts.running,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface JobLiveInfo {
  jobId: string | null;
  jobStatus: string | null;
  currentStep: string | null;
}

function toFleetJobDto(
  row: typeof fleetJobs.$inferSelect,
  sessionTitle: string,
  dependsOn: string[],
  prUrl: string | null,
  live: JobLiveInfo,
): FleetJobDto {
  return {
    id: row.id,
    fleetId: row.fleetId,
    sessionId: row.sessionId,
    sessionTitle,
    sessionMessageId: row.sessionMessageId ?? null,
    jobId: live.jobId,
    jobStatus: live.jobStatus,
    currentStep: live.currentStep,
    jobType: row.jobType as FleetJobDto['jobType'],
    task: row.task,
    wave: row.wave,
    status: row.status as FleetJobDto['status'],
    report: (row.report as Record<string, unknown> | null) ?? null,
    dependsOn,
    noChanges: (row.report as Record<string, unknown> | null)?.noChanges === true,
    prUrl,
    retryCount: row.retryCount,
    merged: row.merged,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * For each fleet_job that has a session_message_id, fetch the linked Praxis job's
 * live status and current step name. Returns a map keyed by fleet_job.id.
 */
async function resolveLiveJobInfo(
  db: Database,
  fleetJobRows: Array<typeof fleetJobs.$inferSelect>,
): Promise<Map<string, JobLiveInfo>> {
  const result = new Map<string, JobLiveInfo>();
  const withMsg = fleetJobRows.filter((fj) => fj.sessionMessageId != null);
  if (!withMsg.length) return result;

  const msgIds = withMsg.map((fj) => fj.sessionMessageId!);

  // message → job_id
  const msgRows = await db
    .select({ id: messages.id, jobId: messages.jobId })
    .from(messages)
    .where(inArray(messages.id, msgIds));

  const msgJobMap = new Map(msgRows.map((m) => [m.id, m.jobId]));

  const jobIds = msgRows.map((m) => m.jobId).filter(Boolean) as string[];

  if (!jobIds.length) {
    for (const fj of withMsg) result.set(fj.id, { jobId: null, jobStatus: null, currentStep: null });
    return result;
  }

  // Load job status + currentStepIndex
  const jobRows = await db
    .select({ id: jobs.id, status: jobs.status, currentStepIndex: jobs.currentStepIndex })
    .from(jobs)
    .where(inArray(jobs.id, jobIds));

  const jobMap = new Map(jobRows.map((j) => [j.id, j]));

  // Load current running steps for step names
  const runningSteps = await db
    .select({ jobId: jobSteps.jobId, stepIndex: jobSteps.stepIndex, name: jobSteps.name, kind: jobSteps.kind, totalCount: sql<number>`count(*) over (partition by ${jobSteps.jobId})::int` })
    .from(jobSteps)
    .where(and(inArray(jobSteps.jobId, jobIds), eq(jobSteps.status, 'running')));

  const stepMap = new Map(runningSteps.map((s) => [s.jobId, s]));

  // Also get total step counts per job to display e.g. "execute (2/3)"
  const stepCounts = await db
    .select({ jobId: jobSteps.jobId, total: sql<number>`count(*)::int` })
    .from(jobSteps)
    .where(inArray(jobSteps.jobId, jobIds))
    .groupBy(jobSteps.jobId);
  const stepCountMap = new Map(stepCounts.map((s) => [s.jobId, s.total]));

  for (const fj of withMsg) {
    const jobId = fj.sessionMessageId ? (msgJobMap.get(fj.sessionMessageId!) ?? null) : null;
    if (!jobId) {
      result.set(fj.id, { jobId: null, jobStatus: null, currentStep: null });
      continue;
    }

    const job = jobMap.get(jobId);
    if (!job) {
      result.set(fj.id, { jobId, jobStatus: null, currentStep: null });
      continue;
    }

    const runningStep = stepMap.get(jobId);
    const totalSteps = stepCountMap.get(jobId) ?? 0;
    let currentStep: string | null = null;
    if (runningStep) {
      const stepNum = (runningStep.stepIndex ?? 0) + 1;
      currentStep = `${runningStep.name} (${stepNum}/${totalSteps})`;
    }

    result.set(fj.id, { jobId, jobStatus: job.status, currentStep });
  }

  return result;
}

async function aggregateCounts(
  db: Database,
  fleetId: string,
): Promise<{ total: number; completed: number; noop: number; failed: number; running: number }> {
  const rows = await db
    .select({ status: fleetJobs.status, count: sql<number>`count(*)::int` })
    .from(fleetJobs)
    .where(eq(fleetJobs.fleetId, fleetId))
    .groupBy(fleetJobs.status);

  let total = 0;
  let completed = 0;
  let noop = 0;
  let failed = 0;
  let running = 0;
  for (const r of rows) {
    total += r.count;
    if (r.status === 'completed') completed += r.count;
    else if (r.status === 'noop') noop += r.count;
    else if (r.status === 'failed') failed += r.count;
    else if (r.status === 'running' || r.status === 'queued') running += r.count;
  }
  return { total, completed, noop, failed, running };
}

export interface CreateFleetInput {
  title: string;
  goal: string;
  mode: 'fanout' | 'orchestrated';
  status: string;
  autoApprove: boolean;
  maxParallel: number;
}

export interface CreateFleetJobInput {
  fleetId: string;
  sessionId: string;
  jobType: string;
  task: string;
  wave: number;
  dependsOn?: string[];
}

export class FleetsRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateFleetInput): Promise<typeof fleets.$inferSelect> {
    const [row] = await this.db.insert(fleets).values(input).returning();
    if (!row) throw new Error('fleet insert failed');
    return row;
  }

  async createJob(input: CreateFleetJobInput): Promise<typeof fleetJobs.$inferSelect> {
    const [row] = await this.db
      .insert(fleetJobs)
      .values({
        fleetId: input.fleetId,
        sessionId: input.sessionId,
        jobType: input.jobType,
        task: input.task,
        wave: input.wave,
      })
      .returning();
    if (!row) throw new Error('fleet_job insert failed');

    if (input.dependsOn?.length) {
      await this.db.insert(fleetJobDeps).values(
        input.dependsOn.map((depId) => ({ fleetJobId: row.id, dependsOnId: depId })),
      );
    }

    return row;
  }

  async createJobsBatch(
    inputs: CreateFleetJobInput[],
  ): Promise<Array<typeof fleetJobs.$inferSelect>> {
    const rows = await this.db
      .insert(fleetJobs)
      .values(
        inputs.map((i) => ({
          fleetId: i.fleetId,
          sessionId: i.sessionId,
          jobType: i.jobType,
          task: i.task,
          wave: i.wave,
        })),
      )
      .returning();

    const depRows: Array<{ fleetJobId: string; dependsOnId: string }> = [];
    for (let idx = 0; idx < inputs.length; idx++) {
      const deps = inputs[idx]?.dependsOn ?? [];
      const jobRow = rows[idx];
      if (!jobRow) continue;
      for (const depId of deps) {
        depRows.push({ fleetJobId: jobRow.id, dependsOnId: depId });
      }
    }
    if (depRows.length) await this.db.insert(fleetJobDeps).values(depRows);

    return rows;
  }

  async findById(fleetId: string): Promise<FleetDto | null> {
    const [row] = await this.db.select().from(fleets).where(eq(fleets.id, fleetId));
    if (!row) return null;
    const counts = await aggregateCounts(this.db, fleetId);
    return toFleetDto(row, counts);
  }

  async findMany(limit: number): Promise<FleetDto[]> {
    const rows = await this.db.select().from(fleets).orderBy(desc(fleets.createdAt)).limit(limit);
    return Promise.all(
      rows.map(async (row) => {
        const counts = await aggregateCounts(this.db, row.id);
        return toFleetDto(row, counts);
      }),
    );
  }

  async findJobsWithDeps(
    fleetId: string,
  ): Promise<Array<FleetJobDto>> {
    const jobRows = await this.db
      .select({
        job: fleetJobs,
        sessionTitle: conversations.title,
      })
      .from(fleetJobs)
      .leftJoin(conversations, eq(conversations.id, fleetJobs.sessionId))
      .where(eq(fleetJobs.fleetId, fleetId))
      .orderBy(fleetJobs.wave, fleetJobs.createdAt);

    if (!jobRows.length) return [];

    const jobIds = jobRows.map((r) => r.job.id);
    const depRows = await this.db
      .select()
      .from(fleetJobDeps)
      .where(inArray(fleetJobDeps.fleetJobId, jobIds));

    const depsMap = new Map<string, string[]>();
    for (const dep of depRows) {
      const arr = depsMap.get(dep.fleetJobId) ?? [];
      arr.push(dep.dependsOnId);
      depsMap.set(dep.fleetJobId, arr);
    }

    const liveInfo = await resolveLiveJobInfo(this.db, jobRows.map((r) => r.job));

    return jobRows.map(({ job, sessionTitle }) =>
      toFleetJobDto(
        job,
        sessionTitle ?? '',
        depsMap.get(job.id) ?? [],
        (job.report as Record<string, unknown> | null)?.prUrl as string | null ?? null,
        liveInfo.get(job.id) ?? { jobId: null, jobStatus: null, currentStep: null },
      ),
    );
  }

  async findJobById(fleetJobId: string): Promise<typeof fleetJobs.$inferSelect | null> {
    const [row] = await this.db.select().from(fleetJobs).where(eq(fleetJobs.id, fleetJobId));
    return row ?? null;
  }

  async updateJobStatus(
    fleetJobId: string,
    status: string,
    report?: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(fleetJobs)
      .set({
        status,
        ...(report !== undefined ? { report } : {}),
        updatedAt: new Date(),
      })
      .where(eq(fleetJobs.id, fleetJobId));
  }

  async setSessionMessageId(fleetJobId: string, messageId: string): Promise<void> {
    await this.db
      .update(fleetJobs)
      .set({ sessionMessageId: messageId, updatedAt: new Date() })
      .where(eq(fleetJobs.id, fleetJobId));
  }

  async updateStatus(fleetId: string, status: string): Promise<void> {
    await this.db.update(fleets).set({ status, updatedAt: new Date() }).where(eq(fleets.id, fleetId));
  }

  async updatePlan(fleetId: string, plan: Record<string, unknown>): Promise<void> {
    await this.db
      .update(fleets)
      .set({ plan: plan as never, updatedAt: new Date() })
      .where(eq(fleets.id, fleetId));
  }

  async countActiveJobs(fleetId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(fleetJobs)
      .where(
        and(
          eq(fleetJobs.fleetId, fleetId),
          inArray(fleetJobs.status, ['queued', 'running']),
        ),
      );
    return row?.count ?? 0;
  }

  async findNextPendingJob(
    fleetId: string,
  ): Promise<typeof fleetJobs.$inferSelect | null> {
    // A pending job is eligible when all its dependencies are completed+merged (or it has none).
    const pending = await this.db
      .select()
      .from(fleetJobs)
      .where(and(eq(fleetJobs.fleetId, fleetId), eq(fleetJobs.status, 'pending')))
      .orderBy(fleetJobs.wave, fleetJobs.createdAt)
      .limit(20);

    if (!pending.length) return null;

    for (const job of pending) {
      const deps = await this.db
        .select()
        .from(fleetJobDeps)
        .where(eq(fleetJobDeps.fleetJobId, job.id));

      if (!deps.length) return job;

      const depIds = deps.map((d) => d.dependsOnId);
      const depJobs = await this.db
        .select({ status: fleetJobs.status, merged: fleetJobs.merged })
        .from(fleetJobs)
        .where(inArray(fleetJobs.id, depIds));

      const allSatisfied = depJobs.every((d) => d.status === 'completed' && d.merged);
      if (allSatisfied) return job;
    }

    return null;
  }

  async findActiveOrchestrated(): Promise<Array<{ id: string }>> {
    return this.db
      .select({ id: fleets.id })
      .from(fleets)
      .where(
        and(
          eq(fleets.mode, 'orchestrated'),
          notInArray(fleets.status, ['completed', 'failed', 'cancelled', 'draft']),
        ),
      );
  }

  async getFleetGraph(fleetId: string): Promise<FleetGraphDto> {
    const jobRows = await this.db
      .select({
        job: fleetJobs,
        sessionTitle: conversations.title,
      })
      .from(fleetJobs)
      .leftJoin(conversations, eq(conversations.id, fleetJobs.sessionId))
      .where(eq(fleetJobs.fleetId, fleetId));

    const jobIds = jobRows.map((r) => r.job.id);
    const depRows = jobIds.length
      ? await this.db
          .select()
          .from(fleetJobDeps)
          .where(inArray(fleetJobDeps.fleetJobId, jobIds))
      : [];

    const liveInfo = await resolveLiveJobInfo(this.db, jobRows.map((r) => r.job));

    const nodes = jobRows.map(({ job, sessionTitle }) => {
      const live = liveInfo.get(job.id) ?? { jobId: null, jobStatus: null, currentStep: null };
      return {
        id: job.id,
        sessionId: job.sessionId,
        sessionTitle: sessionTitle ?? null,
        jobType: job.jobType as FleetJobDto['jobType'],
        status: job.status as FleetJobDto['status'],
        jobId: live.jobId,
        jobStatus: live.jobStatus,
        currentStep: live.currentStep,
        wave: job.wave,
        noChanges: (job.report as Record<string, unknown> | null)?.noChanges === true,
        prUrl: (job.report as Record<string, unknown> | null)?.prUrl as string | null ?? null,
      };
    });

    // Build satisfied lookup: dep is satisfied when the upstream job is completed+merged
    const upstreamMap = new Map(jobRows.map(({ job }) => [job.id, job]));
    const edges = depRows.map((dep) => {
      const upstream = upstreamMap.get(dep.dependsOnId);
      return {
        id: `${dep.dependsOnId}-${dep.fleetJobId}`,
        from: dep.dependsOnId,
        to: dep.fleetJobId,
        satisfied: upstream ? upstream.status === 'completed' && upstream.merged : false,
      };
    });

    return { nodes, edges };
  }
}
