import { ORPCError } from '@orpc/server';
import type { FleetDto, FleetGraphDto, FleetJobDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { fleets, jobs, messages } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { FleetsRepository } from '../repositories/fleets.repository';
import { SessionsRepository } from '../repositories/sessions.repository';
import { JobsService } from './jobs.service';

interface CreateFanOutInput {
  title: string;
  goal: string;
  task: string;
  sessionIds: string[];
  autoApprove?: boolean;
  maxParallel?: number;
}

interface SpawnJobInput {
  fleetId: string;
  jobType: 'scout' | 'implement' | 'verify';
  sessionId: string;
  task: string;
  dependsOn?: string[];
}

const PERMANENT_FAILURE_STATUSES = new Set(['plan_rejected', 'cancelled']);
// Error categories from the job orchestrator that should never be retried fleet-wide
const FLEET_FATAL_ERROR_CATEGORIES = new Set(['billing', 'auth']);
const TERMINAL_FLEET_JOB_STATUSES = new Set(['completed', 'noop', 'failed', 'cancelled']);

export class FleetsService {
  private readonly repo: FleetsRepository;
  private readonly sessionsRepo: SessionsRepository;
  private readonly jobsService: JobsService;

  constructor(
    private readonly db: Database,
    private readonly boss: PgBoss,
    private readonly log: Logger,
  ) {
    this.repo = new FleetsRepository(db);
    this.sessionsRepo = new SessionsRepository(db);
    this.jobsService = new JobsService(db, boss, log);
  }

  async createFanOut(input: CreateFanOutInput): Promise<FleetDto> {
    const maxParallel = input.maxParallel ?? 10;

    const fleet = await this.repo.create({
      title: input.title,
      goal: input.goal,
      mode: 'fanout',
      status: 'running',
      autoApprove: input.autoApprove ?? false,
      maxParallel,
    });

    const fleetJobRows = await this.repo.createJobsBatch(
      input.sessionIds.map((sessionId) => ({
        fleetId: fleet.id,
        sessionId,
        jobType: 'implement',
        task: input.task,
        wave: 1,
      })),
    );

    // Spawn first maxParallel jobs immediately
    const toSpawn = fleetJobRows.slice(0, maxParallel);
    await Promise.all(
      toSpawn.map((fj) =>
        this._spawnFleetJob(fj.id, fj.sessionId, input.task, input.autoApprove ?? false),
      ),
    );

    const dto = await this.repo.findById(fleet.id);
    if (!dto)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'fleet not found after creation' });
    return dto;
  }

  async get(fleetId: string): Promise<FleetDto & { jobs: FleetJobDto[] }> {
    const [fleet, fleetJobDtos] = await Promise.all([
      this.repo.findById(fleetId),
      this.repo.findJobsWithDeps(fleetId),
    ]);
    if (!fleet) throw new ORPCError('NOT_FOUND', { message: 'fleet not found' });
    return { ...fleet, jobs: fleetJobDtos };
  }

  async list(limit: number): Promise<FleetDto[]> {
    return this.repo.findMany(limit);
  }

  async getGraph(fleetId: string): Promise<FleetGraphDto> {
    const fleet = await this.repo.findById(fleetId);
    if (!fleet) throw new ORPCError('NOT_FOUND', { message: 'fleet not found' });
    return this.repo.getFleetGraph(fleetId);
  }

  async cancel(fleetId: string): Promise<void> {
    const fleet = await this.repo.findById(fleetId);
    if (!fleet) throw new ORPCError('NOT_FOUND', { message: 'fleet not found' });
    await this.repo.updateStatus(fleetId, 'cancelled');
  }

  async spawnJob(input: SpawnJobInput): Promise<FleetJobDto> {
    const fleet = await this.repo.findById(input.fleetId);
    if (!fleet) throw new ORPCError('NOT_FOUND', { message: 'fleet not found' });

    const fleetJob = await this.repo.createJob({
      fleetId: input.fleetId,
      sessionId: input.sessionId,
      jobType: input.jobType,
      task: input.task,
      wave: 1,
      dependsOn: input.dependsOn,
    });

    await this._spawnFleetJob(fleetJob.id, fleetJob.sessionId, input.task, fleet.autoApprove);

    const allJobs = await this.repo.findJobsWithDeps(input.fleetId);
    const dto = allJobs.find((j) => j.id === fleetJob.id);
    if (!dto)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'fleet job not found after creation',
      });
    return dto;
  }

  /**
   * Called by fleet-job-complete queue consumer when a Praxis job finishes.
   */
  async onJobComplete(fleetJobId: string, jobId: string): Promise<void> {
    const fleetJob = await this.repo.findJobById(fleetJobId);
    if (!fleetJob) {
      this.log.warn({ fleetJobId }, 'fleet_job not found in onJobComplete');
      return;
    }

    const [jobRow] = await this.db
      .select({
        status: jobs.status,
        output: jobs.output,
        noChanges: jobs.noChanges,
        errorCategory: jobs.errorCategory,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    if (!jobRow) {
      this.log.warn({ jobId }, 'job not found in onJobComplete');
      return;
    }

    const report: Record<string, unknown> = {
      ...((jobRow.output as Record<string, unknown> | null) ?? {}),
      noChanges: jobRow.noChanges,
      ...(jobRow.errorCategory ? { errorCategory: jobRow.errorCategory } : {}),
    };

    const isFatalError =
      jobRow.errorCategory != null && FLEET_FATAL_ERROR_CATEGORIES.has(jobRow.errorCategory);

    let newStatus: string;
    if (jobRow.status === 'completed' && jobRow.noChanges) {
      newStatus = 'noop';
    } else if (jobRow.status === 'completed') {
      newStatus = 'completed';
    } else if (
      isFatalError ||
      PERMANENT_FAILURE_STATUSES.has(jobRow.status) ||
      fleetJob.retryCount >= 3
    ) {
      newStatus = 'failed';
    } else {
      // Transient failure — increment retry count and re-spawn
      await this.repo.updateJobStatus(fleetJobId, 'pending', {
        retryCount: fleetJob.retryCount + 1,
      });
      await this._spawnFleetJob(fleetJobId, fleetJob.sessionId, fleetJob.task, false);
      return;
    }

    await this.repo.updateJobStatus(fleetJobId, newStatus, report);

    // Billing/auth failures affect all jobs — fail the fleet immediately rather than
    // retrying remaining jobs that will hit the same error.
    if (isFatalError) {
      this.log.warn(
        { fleetJobId, errorCategory: jobRow.errorCategory },
        'fatal error — failing fleet',
      );
      await this.repo.updateStatus(fleetJob.fleetId, 'failed');
      return;
    }

    // Check if fleet is fully done
    const allJobDtos = await this.repo.findJobsWithDeps(fleetJob.fleetId);
    const allDone = allJobDtos.every((j) => TERMINAL_FLEET_JOB_STATUSES.has(j.status));
    if (allDone) {
      const anyFailed = allJobDtos.some((j) => j.status === 'failed');
      await this.repo.updateStatus(fleetJob.fleetId, anyFailed ? 'failed' : 'completed');
      return;
    }

    await this._trySpawnNext(fleetJob.fleetId);
  }

  /**
   * Orchestrated fleet tick — returns 'done' when complete, 'continue' to keep polling.
   * Service never touches pg-boss; the queue consumer owns re-scheduling.
   */
  async runOrchestratorTick(fleetId: string): Promise<'continue' | 'done'> {
    const fleet = await this.repo.findById(fleetId);
    if (!fleet || ['completed', 'failed', 'cancelled'].includes(fleet.status)) return 'done';

    const allJobDtos = await this.repo.findJobsWithDeps(fleetId);

    // Load current plan from DB
    const [fleetRow] = await this.db
      .select({ plan: fleets.plan })
      .from(fleets)
      .where(eq(fleets.id, fleetId));
    const currentPlan = (fleetRow?.plan ?? null) as Record<string, unknown> | null;
    const currentWave = (currentPlan?.currentWave as number | undefined) ?? 1;

    const currentWaveJobs = allJobDtos.filter((j) => j.wave === currentWave);
    const waveDone =
      currentWaveJobs.length > 0 &&
      currentWaveJobs.every((j) => ['completed', 'noop', 'failed'].includes(j.status));

    if (!waveDone) return 'continue';

    // All wave jobs are done — call master agent LLM
    const sessions = await this.sessionsRepo.findMany(100);
    const reports = currentWaveJobs.map((j) => ({
      sessionId: j.sessionId,
      sessionTitle: j.sessionTitle,
      jobType: j.jobType,
      status: j.status,
      report: j.report,
    }));

    const next = await this._callMasterAgent(
      fleet.goal,
      currentPlan,
      reports,
      sessions.map((s) => ({ id: s.id, title: s.title })),
    );

    if (next.action === 'done') {
      await this.repo.updateStatus(fleetId, 'completed');
      return 'done';
    }

    const nextWave = currentWave + 1;
    await this.repo.updatePlan(fleetId, {
      ...(next.plan as Record<string, unknown>),
      currentWave: nextWave,
    });
    await this.repo.updateStatus(fleetId, next.action === 'scout' ? 'scouting' : 'implementing');

    for (const { sessionId, task } of next.jobs) {
      const fj = await this.repo.createJob({
        fleetId,
        sessionId,
        jobType: next.action === 'scout' ? 'scout' : 'implement',
        task,
        wave: nextWave,
      });
      await this._spawnFleetJob(fj.id, sessionId, task, false);
    }

    return 'continue';
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Send a message to a session to kick off the actual Praxis job. */
  private async _spawnFleetJob(
    fleetJobId: string,
    sessionId: string,
    task: string,
    autoApprove: boolean,
  ): Promise<void> {
    try {
      const jobDto = await this.jobsService.create({
        sessionId,
        task,
        autoApprove,
        fleetJobId,
      });

      // Find the user message that was inserted by jobs.service.create
      const [msgRow] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.jobId, jobDto.id))
        .limit(1);

      await this.repo.updateJobStatus(fleetJobId, 'queued');
      if (msgRow) {
        await this.repo.setSessionMessageId(fleetJobId, msgRow.id);
      }
    } catch (err) {
      this.log.error({ err, fleetJobId, sessionId }, 'failed to spawn fleet job');
      await this.repo.updateJobStatus(fleetJobId, 'failed');
    }
  }

  private async _trySpawnNext(fleetId: string): Promise<void> {
    const fleet = await this.repo.findById(fleetId);
    if (!fleet) return;

    const activeCount = await this.repo.countActiveJobs(fleetId);
    if (activeCount >= fleet.maxParallel) return;

    const next = await this.repo.findNextPendingJob(fleetId);
    if (!next) return;

    await this._spawnFleetJob(next.id, next.sessionId, next.task, fleet.autoApprove);
  }

  /**
   * Single-turn LLM call: given fleet goal, current plan, and scout reports,
   * returns what to do next for an orchestrated fleet.
   * Stub implementation — real version would call AI provider (similar to runLearningPass).
   */
  private async _callMasterAgent(
    _goal: string,
    currentPlan: Record<string, unknown> | null,
    _reports: Array<{
      sessionId: string;
      sessionTitle: string;
      jobType: string;
      status: string;
      report: Record<string, unknown> | null;
    }>,
    _sessions: Array<{ id: string; title: string }>,
  ): Promise<{
    action: 'scout' | 'implement' | 'done';
    reasoning: string;
    jobs: Array<{ sessionId: string; task: string }>;
    plan: unknown;
  }> {
    this.log.warn('callMasterAgent not yet implemented — returning done');
    return { action: 'done', reasoning: 'stub', jobs: [], plan: currentPlan };
  }
}
