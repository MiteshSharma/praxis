import { randomUUID } from 'node:crypto';
import type { JobStatus, NotifyEvent } from '@shared/contracts';
import { assertTransition } from '@shared/contracts';
import { type Database, type Job, artifacts, jobSteps, jobs, sandboxes, workflowVersions } from '@shared/db';
import { EMPTY_MEMORY_TEMPLATE, loadMemoryFile, normalizeRepoKey } from '@shared/memory';
import type { LocalSandboxProvider, SandboxInfo } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import type { WorkflowDefinition } from '@shared/workflows';
import { and, eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { emitNotification } from '../egress/notify';
import { DEFAULT_WORKFLOW } from '../defaults/default-workflow';
import { DbTaskTracker } from '../task-tracker/db-task-tracker';
import type { TaskTracker } from '../task-tracker/task-tracker';
import { HoldTimeoutError, PlanRejectedError, StepRunner } from './step-runner';
import { appendTimeline, transitionJob } from './transitions';
import { runLearningPass } from './learning';

export type ResumeMode = 'execute' | 'revise';

export interface JobOrchestratorDeps {
  db: Database;
  boss: PgBoss;
  sandbox: LocalSandboxProvider;
  log: Logger;
  redisUrl: string;
  /** MCP endpoint the sandbox-worker calls for submit_plan */
  mcpEndpoint?: string;
  /** Secret used to mint MCP JWTs — required when mcpEndpoint is set */
  mcpSecret?: string;
  /** Override task tracker for testing */
  taskTracker?: TaskTracker;
}

export class JobOrchestrator {
  private readonly tracker: TaskTracker;
  private readonly stepRunner: StepRunner;

  constructor(private readonly deps: JobOrchestratorDeps) {
    this.tracker = deps.taskTracker ?? new DbTaskTracker(deps.db);
    this.stepRunner = new StepRunner({
      db: deps.db,
      boss: deps.boss,
      sandbox: deps.sandbox,
      taskTracker: this.tracker,
      log: deps.log,
      redisUrl: deps.redisUrl,
      mcpEndpoint: deps.mcpEndpoint,
      mcpSecret: deps.mcpSecret,
    });
  }

  async run(jobId: string, resumeMode?: ResumeMode): Promise<void> {
    const { db, sandbox, log } = this.deps;
    const jobRow = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!jobRow) {
      log.warn({ jobId }, 'orchestrator: job not found');
      return;
    }

    const jobLog = log.child({ jobId });
    let sandboxInfo: SandboxInfo | undefined;

    try {
      // ── Cold resume from plan_review (after hot hold expired) ────────────
      if (resumeMode === 'execute' || resumeMode === 'revise') {
        await this.runColdResume(jobRow, resumeMode, jobLog);
        return;
      }

      // ── Initial run ──────────────────────────────────────────────────────
      if (!(await this.transition(jobId, 'queued', 'provisioning', { startedAt: new Date() }))) {
        jobLog.warn({ status: jobRow.status }, 'job not in queued state, skipping');
        return;
      }

      sandboxInfo = await sandbox.create({ jobId });
      await db.insert(sandboxes).values({
        jobId,
        providerId: sandboxInfo.providerId,
        status: 'running',
        endpoint: sandboxInfo.endpoint,
      });
      await appendTimeline(db, jobId, 'sandbox-ready', {
        providerId: sandboxInfo.providerId,
        endpoint: sandboxInfo.endpoint,
      });

      await this.mustTransition(jobId, 'provisioning', 'preparing');

      const workspace = sandbox.workspaceFor(sandboxInfo.providerId);
      await this.cloneRepo(jobRow, sandboxInfo, workspace, jobLog);

      // ── Load repo memory ─────────────────────────────────────────────────
      const memoryMarkdown = await this.loadRepoMemory(jobRow, jobLog);
      this.stepRunner.setMemory(memoryMarkdown);

      // ── Materialise steps ────────────────────────────────────────────────
      await this.prepareSteps(jobRow);

      // ── Run steps ────────────────────────────────────────────────────────
      await this.stepRunner.run(jobRow, sandboxInfo);

      // ── Publish (PR creation) ────────────────────────────────────────────
      await this.mustTransition(jobId, 'preparing', 'publishing');
      await this.finalize(jobRow, sandboxInfo, workspace, jobLog);

      // ── Learning pass (after PR) ─────────────────────────────────────────
      const freshJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!freshJob?.disableLearning) {
        await this.mustTransition(jobId, 'publishing', 'learning');
        await runLearningPass(jobId, sandboxInfo, workspace, { db, log: jobLog });
        await this.mustTransition(jobId, 'learning', 'completed', { completedAt: new Date() });
      } else {
        await this.mustTransition(jobId, 'publishing', 'completed', { completedAt: new Date() });
      }
      await this.emitCompleted(jobId);
    } catch (err) {
      if (err instanceof PlanRejectedError) {
        // Transition already happened in StepRunner.runPlanStep
        jobLog.info('job plan rejected');
        return;
      }
      if (err instanceof HoldTimeoutError) {
        jobLog.info('job entered cold suspension after hold timeout');
        // Sandbox will be destroyed in finally; job stays in plan_review
        return;
      }
      await this.failJob(jobId, jobRow.status as JobStatus, err, jobLog);
    } finally {
      if (sandboxInfo) {
        await sandbox.destroy(sandboxInfo.providerId).catch(() => undefined);
        await db
          .update(sandboxes)
          .set({ status: 'destroyed', destroyedAt: new Date() })
          .where(eq(sandboxes.providerId, sandboxInfo.providerId));
        await appendTimeline(db, jobId, 'sandbox-destroyed', {
          providerId: sandboxInfo.providerId,
        });
      }
    }
  }

  // ── Cold resume (after hot hold expires or cold revise) ────────────────────

  private async runColdResume(
    jobRow: Job,
    mode: ResumeMode,
    log: Logger,
  ): Promise<void> {
    const { db, sandbox } = this.deps;
    const jobId = jobRow.id;
    let sandboxInfo: SandboxInfo | undefined;

    try {
      sandboxInfo = await sandbox.create({ jobId });
      await db.insert(sandboxes).values({
        jobId,
        providerId: sandboxInfo.providerId,
        status: 'running',
        endpoint: sandboxInfo.endpoint,
      });

      const fromStatus = mode === 'execute' ? 'plan_review' : 'plan_revising';
      await this.mustTransition(jobId, fromStatus as JobStatus, 'preparing');

      const workspace = sandbox.workspaceFor(sandboxInfo.providerId);
      await this.cloneRepo(jobRow, sandboxInfo, workspace, log);

      if (mode === 'execute') {
        // Plan steps completed before the hot hold expired — mark them passed
        // so the step runner skips them and starts from the first execute step.
        await db
          .update(jobSteps)
          .set({ status: 'passed', completedAt: new Date() })
          .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.kind, 'plan')));

        // Load memory (already injected during original plan run, but load again for cold resume)
        const memoryMarkdown = await this.loadRepoMemory(jobRow, log);
        this.stepRunner.setMemory(memoryMarkdown);

        await this.stepRunner.run(jobRow, sandboxInfo);

        // ── Publish (PR creation) ──────────────────────────────────────────
        await this.mustTransition(jobId, 'preparing', 'publishing');
        await this.finalize(jobRow, sandboxInfo, workspace, log);

        // ── Learning pass (after PR) ───────────────────────────────────────
        const freshJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
        if (!freshJob?.disableLearning) {
          await this.mustTransition(jobId, 'publishing', 'learning');
          await runLearningPass(jobId, sandboxInfo, workspace, { db, log });
          await this.mustTransition(jobId, 'learning', 'completed', { completedAt: new Date() });
        } else {
          await this.mustTransition(jobId, 'publishing', 'completed', { completedAt: new Date() });
        }
        await this.emitCompleted(jobId);
      } else {
        // Revise: re-run from current position in step runner (plan step will handle revision)
        await this.stepRunner.run(jobRow, sandboxInfo);
        // After revision, sandbox destroyed — next cold resume will execute
      }
    } catch (err) {
      if (err instanceof PlanRejectedError || err instanceof HoldTimeoutError) return;
      await this.failJob(jobId, jobRow.status as JobStatus, err, log);
    } finally {
      if (sandboxInfo) {
        await sandbox.destroy(sandboxInfo.providerId).catch(() => undefined);
        await db
          .update(sandboxes)
          .set({ status: 'destroyed', destroyedAt: new Date() })
          .where(eq(sandboxes.providerId, sandboxInfo.providerId));
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async loadRepoMemory(job: Job, log: Logger): Promise<string | null> {
    const { db } = this.deps;
    try {
      const repoKey = normalizeRepoKey(job.githubUrl);
      const memoryMarkdown = await loadMemoryFile(db, repoKey);
      const sizeBytes = memoryMarkdown ? Buffer.byteLength(memoryMarkdown, 'utf-8') : 0;
      await appendTimeline(db, job.id, 'memory-loaded', {
        hasMemory: memoryMarkdown !== null,
        sizeBytes,
      });
      log.info({ repoKey, hasMemory: memoryMarkdown !== null, sizeBytes }, 'repo memory loaded');
      return memoryMarkdown;
    } catch (err) {
      log.warn({ err, jobId: job.id }, 'could not load repo memory; continuing without it');
      return null;
    }
  }

  private async cloneRepo(
    job: Job,
    sandboxInfo: SandboxInfo,
    workspace: string,
    log: Logger,
  ): Promise<void> {
    const { sandbox, db } = this.deps;
    const cloneUrl = injectToken(job.githubUrl);
    const clone = await sandbox.exec(
      sandboxInfo.providerId,
      `git clone --depth 1 --branch ${job.githubBranch} ${cloneUrl} .`,
      { cwd: workspace, timeoutSeconds: 120 },
    );
    if (clone.exitCode !== 0) {
      throw new Error(`git clone failed: ${clone.stderr.slice(0, 500)}`);
    }
    const shaResult = await sandbox.exec(sandboxInfo.providerId, 'git rev-parse HEAD', {
      cwd: workspace,
    });
    const commitSha = shaResult.stdout.trim();
    await db.update(jobs).set({ githubCommitSha: commitSha }).where(eq(jobs.id, job.id));

    // Create a dedicated branch for this job's changes (worktree pattern)
    const branchName = `praxis/job-${job.id.substring(0, 8)}`;
    const branch = await sandbox.exec(
      sandboxInfo.providerId,
      `git checkout -b ${branchName}`,
      { cwd: workspace },
    );
    if (branch.exitCode !== 0) {
      throw new Error(`git checkout -b failed: ${branch.stderr.slice(0, 500)}`);
    }
    await appendTimeline(db, job.id, 'sandbox-ready', { event: 'branch-created', branchName });
    log.info({ commitSha, branchName }, 'repo cloned, branch created');
  }

  /**
   * Materialise workflow steps into `job_steps` rows.
   *
   * Uses the job's referenced workflow (if any) or falls back to DEFAULT_WORKFLOW.
   * Substitutes `$input.*` placeholders with resolved values from the job.
   */
  private async prepareSteps(job: Job): Promise<void> {
    const { db } = this.deps;

    // Resolve workflow definition
    let workflow: WorkflowDefinition;
    if (job.workflowVersionId) {
      const [version] = await db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.id, job.workflowVersionId))
        .limit(1);
      workflow = (version?.definition as WorkflowDefinition | undefined) ?? DEFAULT_WORKFLOW;
    } else {
      workflow = DEFAULT_WORKFLOW;
    }

    // Build input values — simple prompt substitution for Phase 3
    const inputs: Record<string, string> = {
      prompt: job.description ?? job.title,
    };

    const rows = workflow.steps.map((step, index) => ({
      jobId: job.id,
      stepIndex: index,
      kind: step.kind,
      name: step.name,
      config: substituteInputs(step as Record<string, unknown>, inputs),
      status: 'pending',
    }));

    await db.insert(jobSteps).values(rows);
  }

  /**
   * Creates the PR (commit + push + GitHub PR) and records the artifact.
   * Does NOT transition job status — caller handles publishing → learning → completed.
   */
  private async finalize(
    job: Job,
    sandboxInfo: SandboxInfo,
    _workspace: string,
    log: Logger,
  ): Promise<void> {
    const { db } = this.deps;
    const publishResult = await this.publish(job, sandboxInfo, log);

    if (publishResult) {
      const [artifact] = await db
        .insert(artifacts)
        .values({
          jobId: job.id,
          kind: 'pr',
          path: null,
          url: publishResult.prUrl,
          metadata: {
            branchName: publishResult.branchName,
            commitSha: publishResult.commitSha,
            prNumber: publishResult.prNumber,
            repoUrl: job.githubUrl,
          },
        })
        .returning();
      if (artifact) {
        const seq = await appendTimeline(db, job.id, 'artifact-created', {
          artifactId: artifact.id,
          kind: 'pr',
          url: artifact.url,
        });
        await this.emit(job.id, seq, {
          kind: 'artifact-created',
          artifactId: artifact.id,
          artifactKind: 'pr',
          url: artifact.url ?? undefined,
        });
      }
    }

    log.info({ prUrl: publishResult?.prUrl }, 'PR created, entering learning phase');
  }

  private async emitCompleted(jobId: string): Promise<void> {
    const { db } = this.deps;
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) return;
    const seq = await appendTimeline(db, jobId, 'completed', {});
    await this.emit(jobId, seq, { kind: 'completed', summary: undefined });
    this.deps.log.info({ jobId }, 'job completed');
  }

  private async publish(
    job: Job,
    sandboxInfo: SandboxInfo,
    log: Logger,
  ): Promise<{
    branchName: string;
    commitSha: string;
    prNumber: number;
    prUrl: string;
  } | null> {
    const githubToken = process.env.GITHUB_TOKEN ?? '';
    if (!githubToken) {
      log.warn({ jobId: job.id }, 'GITHUB_TOKEN not set — skipping /publish; no PR will be opened');
      return null;
    }

    const requestId = randomUUID();
    const response = await fetch(`${sandboxInfo.endpoint}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({
        sessionId: job.id,
        repoUrl: job.githubUrl,
        baseBranch: job.githubBranch,
        branchName: `praxis/job-${job.id.substring(0, 8)}`,
        commitMessage: job.title,
        prTitle: job.title,
        prBody: `${job.description ?? ''}\n\nCreated by Praxis (job ${job.id}).`,
        githubToken,
        gitAuthor: { name: 'praxis[bot]', email: 'bot@praxis.local' },
        workingDir: sandboxInfo.providerId.replace(/^local:\/\//, ''),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`publish failed: ${response.status} ${detail}`);
    }

    return (await response.json()) as {
      branchName: string;
      commitSha: string;
      prNumber: number;
      prUrl: string;
    };
  }

  private async transition(
    jobId: string,
    from: JobStatus,
    to: JobStatus,
    patch: Parameters<typeof transitionJob>[4] = {},
  ): Promise<{ seq: number } | null> {
    assertTransition(from, to);
    const result = await transitionJob(this.deps.db, jobId, from, to, patch);
    if (!result) return null;
    await this.emit(jobId, result.seq, { kind: 'status-changed', from, to });
    return { seq: result.seq };
  }

  private async mustTransition(
    jobId: string,
    from: JobStatus,
    to: JobStatus,
    patch: Parameters<typeof transitionJob>[4] = {},
  ): Promise<void> {
    const r = await this.transition(jobId, from, to, patch);
    if (!r) throw new Error(`transition ${from} → ${to} rejected`);
  }

  private async emit(jobId: string, seq: number, event: NotifyEvent): Promise<void> {
    try {
      await emitNotification(this.deps.boss, jobId, seq, event);
    } catch (err) {
      this.deps.log.error({ err, jobId, event: event.kind }, 'notification enqueue failed');
    }
  }

  private async failJob(
    jobId: string,
    _staleStatus: JobStatus,
    err: unknown,
    log: Logger,
  ): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'job failed');

    // Re-query the actual current status — the initial jobRow snapshot is stale
    // after multiple transitions.
    const current = await this.deps.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    const currentStatus = (current?.status ?? _staleStatus) as JobStatus;

    if (
      currentStatus !== 'failed' &&
      currentStatus !== 'completed' &&
      currentStatus !== 'plan_rejected'
    ) {
      try {
        assertTransition(currentStatus, 'failed');
        const failed = await transitionJob(this.deps.db, jobId, currentStatus, 'failed', {
          errorMessage,
          errorCategory: 'permanent',
        });
        if (failed) {
          await this.emit(jobId, failed.seq + 1, {
            kind: 'failed',
            error: errorMessage,
            errorCategory: 'permanent',
          });
        }
      } catch {
        log.error({ jobId, currentStatus }, 'could not transition to failed');
      }
    }
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function injectToken(url: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !url.startsWith('https://')) return url;
  return url.replace('https://', `https://x-access-token:${token}@`);
}

/**
 * Walk an object and replace `"$input.<name>"` strings with the resolved input value.
 */
function substituteInputs(
  obj: Record<string, unknown>,
  inputs: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      result[k] = v.replace(/\$input\.(\w+)/g, (_, name: string) => inputs[name] ?? `$input.${name}`);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = substituteInputs(v as Record<string, unknown>, inputs);
    } else {
      result[k] = v;
    }
  }
  return result;
}
