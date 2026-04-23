import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { JobStatus, NotifyEvent } from '@shared/contracts';
import { assertTransition } from '@shared/contracts';
import { type Database, type Job, SETTING_DEFAULTS, SETTING_KEYS, type SettingKey, artifacts, jobSteps, jobTimeline, jobs, plans, providerConfigs, sandboxes, settings, workflowVersions } from '@shared/db';
import { type MemoryBackend, S3MemoryBackend, normalizeRepoKey } from '@shared/memory';
import type { SandboxInfo, SandboxProvider } from '@shared/sandbox';
import type { SecretBackend } from '../plugins/secret-backends/types.js';
import type { Logger } from '@shared/telemetry';
import type { WorkflowDefinition } from '@shared/workflows';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Plan } from '@shared/db';
import type PgBoss from 'pg-boss';
import { emitNotification } from '../egress/notify';
import { DEFAULT_WORKFLOW } from '../defaults/default-workflow';
import { DbTaskTracker } from '../task-tracker/db-task-tracker';
import type { TaskTracker } from '../task-tracker/task-tracker';
import { HoldTimeoutError, PlanRejectedError, StepRunner } from './step-runner';
import { appendTimeline, transitionJob } from './transitions';
import { runLearningPass } from './learning';
import { classifyProviderError } from './errors';
import { runReportPass } from './report';
import { SCOUT_WORKFLOW } from '../defaults/scout-workflow';
import { buildPrBody, injectGithubToken, substituteInputs } from './orchestrator-utils';
import { parseSSE } from './sse';
import { dispatchToConversation } from '../channels/dispatch';

export type ResumeMode = 'execute' | 'revise';

export interface JobOrchestratorDeps {
  db: Database;
  boss: PgBoss;
  sandbox: SandboxProvider;
  log: Logger;
  redisUrl: string;
  /** MCP endpoint the sandbox-worker calls for submit_plan */
  mcpEndpoint?: string;
  /** Secret used to mint MCP JWTs — required when mcpEndpoint is set */
  mcpSecret?: string;
  /** Public base URL of this control-plane, used to build plan-review callback URLs */
  controlPlaneUrl?: string;
  /** Override task tracker for testing */
  taskTracker?: TaskTracker;
  /** Memory backend — defaults to S3MemoryBackend when omitted */
  memoryBackend?: MemoryBackend;
  /** Secret backend — used to resolve provider API keys stored via the UI */
  secretBackend?: SecretBackend;
  /** Override step runner for testing */
  stepRunner?: StepRunner;
  /** Override fetch for testing */
  fetchFn?: typeof fetch;
}

export class JobOrchestrator {
  private readonly tracker: TaskTracker;
  private readonly stepRunner: StepRunner;

  constructor(private readonly deps: JobOrchestratorDeps) {
    this.tracker = deps.taskTracker ?? new DbTaskTracker(deps.db);
    this.stepRunner = deps.stepRunner ?? new StepRunner({
      db: deps.db,
      boss: deps.boss,
      sandbox: deps.sandbox,
      taskTracker: this.tracker,
      log: deps.log,
      redisUrl: deps.redisUrl,
      mcpEndpoint: deps.mcpEndpoint,
      mcpSecret: deps.mcpSecret,
      controlPlaneUrl: deps.controlPlaneUrl,
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
    const providerEnv = await this.resolveProviderEnv();

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

      const workspace = sandboxInfo.workspacePath ?? '';
      await this.cloneRepo(jobRow, sandboxInfo, workspace, jobLog);

      // ── Load repo memory ─────────────────────────────────────────────────
      const memoryMarkdown = await this.loadRepoMemory(jobRow, jobLog);
      this.stepRunner.setMemory(memoryMarkdown);

      // ── Materialise steps (or restore from checkpoint) ───────────────────
      const isCheckpoint = await this.restoreCheckpointOrPrepare(jobRow);
      if (isCheckpoint) {
        jobLog.info('resuming from approved plan checkpoint — skipping plan phase');
      }

      // ── Run steps ────────────────────────────────────────────────────────
      const { learningModel: auxModel } = await this.resolveAuxiliaryModels();
      this.stepRunner.setProviderEnv(providerEnv);
      this.stepRunner.setAuxiliaryModel(auxModel);
      await this.stepRunner.run(jobRow, sandboxInfo);

      // QA loop disabled

      // ── Publish / Scout completion ───────────────────────────────────────
      await this.mustTransition(jobId, 'preparing', 'publishing');

      const stepCost = this.stepRunner.getCostSummary();
      let totalInputTokens = stepCost.inputTokens;
      let totalOutputTokens = stepCost.outputTokens;
      let totalCostUsd = stepCost.costUsd;

      const freshJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      const meta = (freshJob?.metadata ?? {}) as Record<string, unknown>;

      let noChanges = false;
      if (jobRow.triggerKind === 'scout') {
        // Scout jobs: skip publish, mark no-changes, extract findings from agent result
        const scoutOutput = await extractScoutOutput(db, jobId);
        await db.update(jobs).set({ noChanges: true, ...(scoutOutput ? { output: scoutOutput } : {}) }).where(eq(jobs.id, jobId));
        const seq = await appendTimeline(db, jobId, 'no-changes', {});
        await this.emit(jobId, seq, { kind: 'no-changes' } as NotifyEvent);
        if (scoutOutput) {
          const rSeq = await appendTimeline(db, jobId, 'report-generated', {
            jobType: 'scout',
            summary: typeof scoutOutput.summary === 'string' ? scoutOutput.summary : '',
          });
          jobLog.info({ jobId, seq: rSeq }, 'scout output extracted and stored');
        } else {
          jobLog.warn({ jobId }, 'scout output: could not extract JSON from agent result');
        }
        noChanges = true;
      } else {
        const finalizeResult = await this.finalize(jobRow, sandboxInfo, workspace, jobLog, providerEnv);
        noChanges = finalizeResult.noChanges;
      }

      // ── Learning pass (skipped for scout and no-op jobs) ─────────────────
      const { learningModel, reportModel } = await this.resolveAuxiliaryModels();
      const skipLearning = freshJob?.disableLearning || noChanges;
      if (!skipLearning) {
        await this.mustTransition(jobId, 'publishing', 'learning');
        const learningCost = await runLearningPass(jobId, sandboxInfo, workspace, { db, log: jobLog, auxiliaryModel: learningModel });
        totalInputTokens += learningCost.inputTokens;
        totalOutputTokens += learningCost.outputTokens;
        totalCostUsd += learningCost.costUsd;
        await this.mustTransition(jobId, 'learning', 'completed', { completedAt: new Date() });
      } else {
        await this.mustTransition(jobId, 'publishing', 'completed', { completedAt: new Date() });
      }

      // ── Report pass (implement jobs with generateReport=true only) ──
      // Scout jobs store output directly from the agent result above — no second LLM call needed.
      if (jobRow.triggerKind !== 'scout' && meta.generateReport) {
        const reportCost = await runReportPass(jobId, sandboxInfo, workspace, { db, log: jobLog, providerEnv, auxiliaryModel: reportModel });
        totalInputTokens += reportCost.inputTokens;
        totalOutputTokens += reportCost.outputTokens;
        totalCostUsd += reportCost.costUsd;
      }

      await db.update(jobs).set({ totalInputTokens, totalOutputTokens, totalCostUsd }).where(eq(jobs.id, jobId));
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

      const workspace = sandboxInfo.workspacePath ?? '';
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

        const providerEnv = await this.resolveProviderEnv();
        const { learningModel: coldAuxModel } = await this.resolveAuxiliaryModels();
        this.stepRunner.setProviderEnv(providerEnv);
        this.stepRunner.setAuxiliaryModel(coldAuxModel);
        await this.stepRunner.run(jobRow, sandboxInfo);

        // ── QA loop ────────────────────────────────────────────────────────
        const praxisConfig = await this.readPraxisConfig(sandboxInfo, workspace, log);
        if (praxisConfig?.qa?.steps?.length) {
          await this.runQaLoop(jobRow, sandboxInfo, workspace, praxisConfig.qa, log, providerEnv);
        }

        // ── Publish / no-op handling ───────────────────────────────────────
        await this.mustTransition(jobId, 'preparing', 'publishing');
        const finalizeResult = await this.finalize(jobRow, sandboxInfo, workspace, log, providerEnv);

        // ── Learning pass (skipped for no-op) ─────────────────────────────
        const stepCost = this.stepRunner.getCostSummary();
        let totalInputTokens = stepCost.inputTokens;
        let totalOutputTokens = stepCost.outputTokens;
        let totalCostUsd = stepCost.costUsd;

        const freshJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
        const meta = (freshJob?.metadata ?? {}) as Record<string, unknown>;
        const { learningModel: coldLearningModel, reportModel: coldReportModel } = await this.resolveAuxiliaryModels();
        const skipLearning = freshJob?.disableLearning || finalizeResult.noChanges;
        if (!skipLearning) {
          await this.mustTransition(jobId, 'publishing', 'learning');
          const learningCost = await runLearningPass(jobId, sandboxInfo, workspace, { db, log, auxiliaryModel: coldLearningModel });
          totalInputTokens += learningCost.inputTokens;
          totalOutputTokens += learningCost.outputTokens;
          totalCostUsd += learningCost.costUsd;
          await this.mustTransition(jobId, 'learning', 'completed', { completedAt: new Date() });
        } else {
          await this.mustTransition(jobId, 'publishing', 'completed', { completedAt: new Date() });
        }

        // ── Report pass ────────────────────────────────────────────────────
        if (meta.generateReport) {
          const reportCost = await runReportPass(jobId, sandboxInfo, workspace, { db, log, auxiliaryModel: coldReportModel });
          totalInputTokens += reportCost.inputTokens;
          totalOutputTokens += reportCost.outputTokens;
          totalCostUsd += reportCost.costUsd;
        }

        await db.update(jobs).set({ totalInputTokens, totalOutputTokens, totalCostUsd }).where(eq(jobs.id, jobId));
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

  /** Reads learning_model and report_model from the settings table, falling back to defaults. */
  private async resolveAuxiliaryModels(): Promise<{ learningModel: string; reportModel: string }> {
    const { db } = this.deps;
    const rows = await db.query.settings.findMany({
      where: (s, { inArray: inn }) => inn(s.key, [SETTING_KEYS.LEARNING_MODEL, SETTING_KEYS.REPORT_MODEL]),
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      learningModel: map.get(SETTING_KEYS.LEARNING_MODEL) ?? SETTING_DEFAULTS[SETTING_KEYS.LEARNING_MODEL],
      reportModel: map.get(SETTING_KEYS.REPORT_MODEL) ?? SETTING_DEFAULTS[SETTING_KEYS.REPORT_MODEL],
    };
  }

  private async loadRepoMemory(job: Job, log: Logger): Promise<string | null> {
    const { db } = this.deps;
    const backend = this.deps.memoryBackend ?? new S3MemoryBackend(db);
    try {
      const repoKey = normalizeRepoKey(job.githubUrl);
      const query = [job.title, job.description].filter(Boolean).join('\n');
      const ctx = await backend.loadForJob(repoKey, query);
      const sizeBytes = ctx ? Buffer.byteLength(ctx.content, 'utf-8') : 0;
      await appendTimeline(db, job.id, 'memory-loaded', {
        hasMemory: ctx !== null,
        sizeBytes,
        source: ctx?.source,
      });
      log.info({ repoKey, hasMemory: ctx !== null, sizeBytes, source: ctx?.source }, 'repo memory loaded');
      return ctx?.content ?? null;
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
    const cloneUrl = injectGithubToken(job.githubUrl);
    const meta = (job.metadata ?? {}) as Record<string, unknown>;
    const prFollowupBranch = typeof meta.prFollowupBranch === 'string' ? meta.prFollowupBranch : null;

    // For follow-up jobs, clone from the existing PR branch; otherwise clone base branch
    const cloneBranch = prFollowupBranch ?? job.githubBranch;
    const clone = await sandbox.exec(
      sandboxInfo.providerId,
      `git clone --depth 1 --branch ${cloneBranch} ${cloneUrl} .`,
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

    let branchName: string;
    if (prFollowupBranch) {
      // Already on the PR branch after clone — no new branch needed
      branchName = prFollowupBranch;
    } else {
      // Create a dedicated branch for this job's changes
      branchName = `praxis/job-${job.id.substring(0, 8)}`;
      const branch = await sandbox.exec(
        sandboxInfo.providerId,
        `git checkout -b ${branchName}`,
        { cwd: workspace },
      );
      if (branch.exitCode !== 0) {
        throw new Error(`git checkout -b failed: ${branch.stderr.slice(0, 500)}`);
      }
    }

    await appendTimeline(db, job.id, 'sandbox-ready', { event: 'branch-created', branchName });
    log.info({ commitSha, branchName }, 'repo cloned, branch ready');
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
    // Scout jobs always use SCOUT_WORKFLOW regardless of any specified workflowVersionId,
    // but inherit the model from the actual workflow version so the right provider is used.
    let workflow: WorkflowDefinition;
    let inheritedModel: string | undefined;
    if (job.triggerKind === 'scout') {
      workflow = SCOUT_WORKFLOW;
      if (job.workflowVersionId) {
        const [version] = await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, job.workflowVersionId))
          .limit(1);
        const wfDef = version?.definition as WorkflowDefinition | undefined;
        // Take the model from the first non-check step of the referenced workflow
        const firstStep = wfDef?.steps.find((s) => s.kind !== 'check') as { model?: string } | undefined;
        inheritedModel = firstStep?.model ?? undefined;
      }
    } else if (job.workflowVersionId) {
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

    const rows = workflow.steps.map((step, index) => {
      const config = substituteInputs(step as Record<string, unknown>, inputs) as Record<string, unknown>;
      // Inject inherited model into scout steps that have no model of their own
      if (step.kind === 'scout' && !(config.model) && inheritedModel) {
        config.model = inheritedModel;
      }
      return {
        jobId: job.id,
        stepIndex: index,
        kind: step.kind,
        name: step.name,
        config,
        status: 'pending',
      };
    });

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
    providerEnv: Record<string, string> = {},
  ): Promise<{ noChanges: boolean }> {
    const { db } = this.deps;
    const publishResult = await this.publish(job, sandboxInfo, log, providerEnv);

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
      log.info({ prUrl: publishResult.prUrl }, 'PR created, entering learning phase');
      return { noChanges: false };
    }

    // No changes — mark on the job row and emit a timeline event
    await db.update(jobs).set({ noChanges: true }).where(eq(jobs.id, job.id));
    const seq = await appendTimeline(db, job.id, 'no-changes', {});
    await this.emit(job.id, seq, { kind: 'no-changes' } as NotifyEvent);
    log.info({ jobId: job.id }, 'job completed with no file changes (task did not apply)');
    return { noChanges: true };
  }

  private async emitCompleted(jobId: string): Promise<void> {
    const { db, log } = this.deps;
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job) return;
    const seq = await appendTimeline(db, jobId, 'completed', {});
    await this.emit(jobId, seq, { kind: 'completed', summary: undefined });
    log.info({ jobId }, 'job completed');

    // Dispatch to conversation channels (e.g. Slack)
    if (job.conversationId) {
      const [prArtifact] = await db
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.jobId, jobId), eq(artifacts.kind, 'pr')))
        .limit(1);
      const prUrl = prArtifact?.url ?? '';
      await dispatchToConversation(db, job.conversationId, {
        type: 'job.completed',
        job: { id: job.id, title: job.title, githubUrl: job.githubUrl },
        prUrl,
      }, log).catch((err) => log.warn({ err, jobId }, 'channel dispatch (completed) failed'));
    }
  }

  private async publish(
    job: Job,
    sandboxInfo: SandboxInfo,
    log: Logger,
    providerEnv: Record<string, string> = {},
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

    const plan = await this.loadApprovedPlan(job.id);
    const prTitle = await this.generatePrTitle(job, plan, sandboxInfo, log, providerEnv);
    const prBody = buildPrBody(job, plan);

    const meta = (job.metadata ?? {}) as Record<string, unknown>;
    const prFollowupBranch = typeof meta.prFollowupBranch === 'string' ? meta.prFollowupBranch : null;
    const branchName = prFollowupBranch ?? `praxis/job-${job.id.substring(0, 8)}`;

    const requestId = randomUUID();
    const response = await (this.deps.fetchFn ?? fetch)(`${sandboxInfo.endpoint}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({
        sessionId: job.id,
        repoUrl: job.githubUrl,
        baseBranch: job.githubBranch,
        branchName,
        commitMessage: prTitle,
        prTitle,
        prBody,
        githubToken,
        gitAuthor: { name: 'praxis[bot]', email: 'bot@praxis.local' },
        workingDir: sandboxInfo.providerId.replace(/^local:\/\//, ''),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`publish failed: ${response.status} ${detail}`);
    }

    const result = await response.json() as Record<string, unknown>;

    // publish.service.ts returns { error: 'no_changes' } when the working tree is clean.
    // Treat this as a valid outcome — not a failure.
    if (result.error === 'no_changes') {
      return null;
    }

    return result as { branchName: string; commitSha: string; prNumber: number; prUrl: string };
  }

  /**
   * If the job already has an approved plan from a previous run (checkpoint
   * resume), marks all plan steps as passed and resets failed/running steps
   * to pending so the step runner skips planning and retries from the execute
   * phase. Returns true if checkpoint mode was activated, false for a fresh run.
   */
  private async restoreCheckpointOrPrepare(job: Job): Promise<boolean> {
    const { db } = this.deps;
    const approvedPlan = await this.loadApprovedPlan(job.id);
    const existingStep = await db.query.jobSteps.findFirst({
      where: eq(jobSteps.jobId, job.id),
    });

    if (!approvedPlan || !existingStep) {
      await this.prepareSteps(job);
      return false;
    }

    // Mark plan steps as passed so the step runner skips them
    await db
      .update(jobSteps)
      .set({ status: 'passed', completedAt: new Date() })
      .where(and(eq(jobSteps.jobId, job.id), eq(jobSteps.kind, 'plan')));

    // Reset failed/running steps to pending so they are retried
    await db
      .update(jobSteps)
      .set({ status: 'pending', startedAt: null, completedAt: null, errorMessage: null })
      .where(
        and(
          eq(jobSteps.jobId, job.id),
          inArray(jobSteps.status, ['failed', 'running']),
        ),
      );

    const seq = await appendTimeline(db, job.id, 'checkpoint-resume', {
      planId: approvedPlan.id,
      planVersion: approvedPlan.version,
    });
    await this.emit(job.id, seq, {
      kind: 'chunk',
      raw: { type: 'checkpoint-resume', message: 'Resuming from approved plan — skipping planning phase' },
    });

    return true;
  }

  private async loadApprovedPlan(jobId: string): Promise<Plan | null> {
    const plan = await this.deps.db.query.plans.findFirst({
      where: and(eq(plans.jobId, jobId), eq(plans.status, 'approved')),
      orderBy: desc(plans.version),
    });
    return plan ?? null;
  }

  /**
   * Single-turn LLM call: given job + plan, return a conventional commit title.
   * Falls back to job.title on any failure.
   */
  private async generatePrTitle(
    job: Job,
    plan: Plan | null,
    sandboxInfo: SandboxInfo,
    log: Logger,
    providerEnv: Record<string, string> = {},
  ): Promise<string> {
    const context = [
      `Task: ${job.title}`,
      job.description ? `Description: ${job.description}` : null,
      plan ? `Plan summary: ${plan.data.summary}` : null,
      plan?.data.affectedPaths.length
        ? `Affected paths: ${plan.data.affectedPaths.slice(0, 6).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await callSandboxSingleTurn(sandboxInfo, {
        sessionId: `${job.id}:pr-title`,
        jobId: job.id,
        title: 'Generate PR title',
        description: context,
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: PR_TITLE_SYSTEM_PROMPT,
        env: providerEnv,
        fetchFn: this.deps.fetchFn,
      });
      const generated = result.trim();
      if (generated) return generated;
    } catch (err) {
      log.warn({ err, jobId: job.id }, 'PR title generation failed; falling back to job title');
    }

    return job.title;
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

  // ── Provider key resolution ────────────────────────────────────────────────

  private async resolveProviderEnv(): Promise<Record<string, string>> {
    const { secretBackend, db } = this.deps;
    const env: Record<string, string> = {};

    // Load API keys from secret backend (fall back to process.env)
    const pairs: Array<[string, string]> = [
      ['provider:anthropic', 'ANTHROPIC_API_KEY'],
      ['provider:openai', 'OPENAI_API_KEY'],
      ['provider:openrouter', 'OPENROUTER_API_KEY'],
      ['provider:azure', 'AZURE_OPENAI_API_KEY'],
    ];

    for (const [secretKey, envKey] of pairs) {
      const dbKey = secretBackend ? await secretBackend.get(secretKey) : null;
      const resolved = dbKey ?? process.env[envKey] ?? '';
      if (resolved) env[envKey] = resolved;
    }

    // Load non-secret config fields from provider_configs table.
    // Each provider maps its config keys to env var names.
    const configEnvMap: Record<string, Record<string, string>> = {
      openrouter: { site_url: 'OPENROUTER_SITE_URL', site_name: 'OPENROUTER_SITE_NAME' },
      azure: { endpoint: 'AZURE_OPENAI_ENDPOINT', api_version: 'AZURE_OPENAI_API_VERSION' },
    };

    const rows = await db.select().from(providerConfigs);
    for (const row of rows) {
      const mapping = configEnvMap[row.provider];
      if (!mapping) continue;
      const config = (row.config ?? {}) as Record<string, string>;
      for (const [configKey, envKey] of Object.entries(mapping)) {
        const val = config[configKey] ?? process.env[envKey] ?? '';
        if (val) env[envKey] = val;
      }
    }

    return env;
  }

  // ── praxis.yml + QA loop ───────────────────────────────────────────────────

  private async readPraxisConfig(
    sandboxInfo: SandboxInfo,
    workspace: string,
    log: Logger,
  ): Promise<PraxisConfig | null> {
    try {
      const result = await this.deps.sandbox.exec(
        sandboxInfo.providerId,
        'cat praxis.yml',
        { cwd: workspace },
      );
      if (result.exitCode !== 0 || !result.stdout.trim()) return null;
      const config = parseYaml(result.stdout) as PraxisConfig;
      log.info({ qaSteps: config.qa?.steps?.length ?? 0 }, 'praxis.yml loaded');
      return config;
    } catch (err) {
      log.warn({ err }, 'could not read praxis.yml — skipping QA');
      return null;
    }
  }

  private async runQaLoop(
    job: Job,
    sandboxInfo: SandboxInfo,
    workspace: string,
    qaConfig: QaConfig,
    log: Logger,
    providerEnv: Record<string, string> = {},
  ): Promise<void> {
    const { db } = this.deps;
    const maxIterations = qaConfig.max_iterations ?? 3;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      await this.mustTransition(job.id, 'preparing', 'qa_running');

      const startSeq = await appendTimeline(db, job.id, 'qa-started', { iteration, maxIterations, steps: qaConfig.steps.length });
      await this.emit(job.id, startSeq, { kind: 'chunk', raw: { type: 'qa-started', iteration, maxIterations } });

      const failures: QaStepFailure[] = [];

      for (const step of qaConfig.steps) {
        const stepStartSeq = await appendTimeline(db, job.id, 'qa-step-started', { name: step.name, command: step.command });
        await this.emit(job.id, stepStartSeq, { kind: 'chunk', raw: { type: 'qa-step-started', name: step.name, command: step.command } });

        const result = await (this.deps.fetchFn ?? fetch)(`${sandboxInfo.endpoint}/exec`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: step.command, cwd: workspace, timeoutSeconds: 300 }),
        }).then((r) => r.json() as Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>);

        const output = `${result.stdout}\n${result.stderr}`.trim().slice(0, 4000);
        const passed = result.exitCode === 0;

        const stepDoneSeq = await appendTimeline(db, job.id, 'qa-step-result', {
          name: step.name,
          command: step.command,
          exitCode: result.exitCode,
          passed,
          output,
          durationMs: result.durationMs,
        });
        await this.emit(job.id, stepDoneSeq, { kind: 'chunk', raw: { type: 'qa-step-result', name: step.name, passed, exitCode: result.exitCode, output } });

        if (!passed) {
          failures.push({ name: step.name, command: step.command, exitCode: result.exitCode, output });
        }
      }

      if (failures.length === 0) {
        await this.mustTransition(job.id, 'qa_running', 'preparing');
        const passedSeq = await appendTimeline(db, job.id, 'qa-passed', { iteration });
        await this.emit(job.id, passedSeq, { kind: 'chunk', raw: { type: 'qa-passed', iteration } });
        log.info({ iteration }, 'QA passed');
        return;
      }

      // QA failed this iteration
      const failedSeq = await appendTimeline(db, job.id, 'qa-iteration-failed', {
        iteration,
        failures: failures.map((f) => ({ name: f.name, exitCode: f.exitCode })),
      });
      await this.emit(job.id, failedSeq, { kind: 'chunk', raw: { type: 'qa-iteration-failed', iteration, failures: failures.map((f) => f.name) } });
      log.warn({ iteration, failures: failures.map((f) => f.name) }, 'QA iteration failed');

      await this.mustTransition(job.id, 'qa_running', 'preparing');

      if (iteration === maxIterations) {
        throw new Error(
          `QA failed after ${maxIterations} iteration${maxIterations === 1 ? '' : 's'}. ` +
          `Failing steps: ${failures.map((f) => f.name).join(', ')}`,
        );
      }

      // Run a fix session then loop back
      await this.runQaFix(job, sandboxInfo, workspace, failures, iteration, maxIterations, log, providerEnv);
    }
  }

  private async runQaFix(
    job: Job,
    sandboxInfo: SandboxInfo,
    workspace: string,
    failures: QaStepFailure[],
    iteration: number,
    maxIterations: number,
    log: Logger,
    providerEnv: Record<string, string> = {},
  ): Promise<void> {
    const { db } = this.deps;
    const systemPrompt = buildQaFixSystemPrompt(failures, iteration, maxIterations, workspace);

    await this.mustTransition(job.id, 'preparing', 'executing');

    const fixSeq = await appendTimeline(db, job.id, 'qa-fix-started', { iteration });
    await this.emit(job.id, fixSeq, { kind: 'chunk', raw: { type: 'qa-fix-started', iteration } });

    const response = await (this.deps.fetchFn ?? fetch)(`${sandboxInfo.endpoint}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': randomUUID() },
      body: JSON.stringify({
        sessionId: `${job.id}:qa-fix-${iteration}`,
        jobId: job.id,
        title: job.title,
        description: `QA fix — iteration ${iteration} of ${maxIterations}`,
        workingDir: workspace,
        model: job.model ?? undefined,
        systemPrompt,
        sessionPhase: 'qa-fix',
        env: providerEnv,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`sandbox /prompt failed during QA fix: ${response.status}`);
    }

    for await (const chunk of parseSSE(response.body)) {
      let parsed: unknown = chunk;
      try { parsed = JSON.parse(chunk); } catch { /* leave as string */ }

      if (parsed && typeof parsed === 'object') {
        const msg = parsed as Record<string, unknown>;
        if (msg.type === 'error' && typeof msg.error === 'string') {
          throw new Error(`QA fix agent error: ${msg.error}`);
        }
      }

      const seq = await appendTimeline(db, job.id, 'chunk', { chunk: parsed });
      await this.emit(job.id, seq, { kind: 'chunk', raw: parsed });
    }

    await this.mustTransition(job.id, 'executing', 'preparing');
    log.info({ iteration }, 'QA fix session complete');
  }

  private async failJob(
    jobId: string,
    _staleStatus: JobStatus,
    err: unknown,
    log: Logger,
  ): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const classified = classifyProviderError(err);
    const errorCategory = classified.retryable ? 'transient' : classified.reason;
    log.error({ err, errorCategory }, 'job failed');

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
          errorCategory,
        });
        if (failed) {
          await this.emit(jobId, failed.seq + 1, {
            kind: 'failed',
            error: errorMessage,
            errorCategory,
          });
          // Dispatch to conversation channels (e.g. Slack)
          if (current?.conversationId) {
            await dispatchToConversation(this.deps.db, current.conversationId, {
              type: 'job.failed',
              job: { id: jobId, title: current.title, githubUrl: current.githubUrl },
              error: errorMessage,
            }, log).catch((err) => log.warn({ err, jobId }, 'channel dispatch (failed) failed'));
          }
        }
      } catch {
        log.error({ jobId, currentStatus }, 'could not transition to failed');
      }
    }
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

interface QaStep {
  name: string;
  command: string;
  requires_services?: boolean;
}

interface QaConfig {
  max_iterations?: number;
  steps: QaStep[];
}

interface PraxisConfig {
  qa?: QaConfig;
}

interface QaStepFailure {
  name: string;
  command: string;
  exitCode: number;
  output: string;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function buildQaFixSystemPrompt(
  failures: QaStepFailure[],
  iteration: number,
  maxIterations: number,
  workspace: string,
): string {
  const failureText = failures
    .map(
      (f) =>
        `### ${f.name}\nCommand: \`${f.command}\`\nExit code: ${f.exitCode}\n\nOutput:\n\`\`\`\n${f.output}\n\`\`\``,
    )
    .join('\n\n');

  return `\
You are fixing code issues found by the QA step (iteration ${iteration} of ${maxIterations}).

The repo is at ${workspace}. Read CLAUDE.md there for the file tree and conventions.

The following QA commands failed after the previous execute step. Fix the source code so all commands pass.
Do NOT modify test files — only fix the source code being tested.
When you are done, summarize what you changed.

## Failed QA steps

${failureText}
`;
}

const PR_TITLE_SYSTEM_PROMPT = `You generate pull request titles using conventional commits format.
Respond with ONLY the title — no explanation, no markdown, no punctuation at the end.
Format: <type>: <short description>
Types: feat (new feature), fix (bug fix), refactor (code restructure without behavior change),
chore (maintenance, deps, config), docs (documentation), test (tests), perf (performance).
Keep the description under 72 characters total.`;

/**
 * Makes a single-turn call to the sandbox /prompt endpoint and returns the text result.
 */
async function callSandboxSingleTurn(
  sandboxInfo: SandboxInfo,
  body: {
    sessionId: string;
    jobId: string;
    title: string;
    description: string;
    model: string;
    systemPrompt: string;
    env: Record<string, string>;
    fetchFn?: typeof fetch;
  },
): Promise<string> {
  const { fetchFn: _fetchFn, ...rest } = body;
  const fetchFn = _fetchFn ?? fetch;
  const response = await fetchFn(`${sandboxInfo.endpoint}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': randomUUID() },
    body: JSON.stringify({ ...rest, workingDir: '/', maxTurns: 1 }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`sandbox /prompt failed: ${response.status}`);
  }

  let text = '';

  for await (const chunk of parseSSE(response.body)) {
    try {
      const msg = JSON.parse(chunk) as Record<string, unknown>;
      if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string') {
        text = msg.result;
      }
    } catch { /* non-JSON frame */ }
  }

  return text;
}

/**
 * Reads the most recent 'result' chunk from the scout step's timeline events and
 * attempts to parse a JSON findings object from the agent's text output.
 */
async function extractScoutOutput(
  db: Database,
  jobId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ payload: jobTimeline.payload })
    .from(jobTimeline)
    .where(eq(jobTimeline.jobId, jobId))
    .orderBy(desc(jobTimeline.seq))
    .limit(100);

  for (const row of rows) {
    const p = row.payload as Record<string, unknown>;
    const chunk = p.chunk as Record<string, unknown> | undefined;
    if (chunk?.type === 'result' && typeof chunk.result === 'string') {
      return parseJsonFromText(chunk.result);
    }
  }
  return null;
}

/**
 * Best-effort JSON extraction from a text that may contain markdown fences,
 * surrounding explanation, or raw JSON.
 */
function parseJsonFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  // 1. Try direct parse
  try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { /* fall through */ }
  // 2. Extract from ```json ... ``` fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>; } catch { /* fall through */ }
  }
  // 3. Extract first {...} block
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return null;
}
