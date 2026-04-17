import { randomUUID } from 'node:crypto';
import type { JobStatus, NotifyEvent } from '@shared/contracts';
import { assertTransition } from '@shared/contracts';
import { type Database, type Job, artifacts, jobSteps, jobs, plans, sandboxes, workflowVersions } from '@shared/db';
import { type MemoryBackend, S3MemoryBackend, normalizeRepoKey } from '@shared/memory';
import type { SandboxInfo, SandboxProvider } from '@shared/sandbox';
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
      await this.stepRunner.run(jobRow, sandboxInfo);

      // ── Publish (PR creation) ────────────────────────────────────────────
      await this.mustTransition(jobId, 'preparing', 'publishing');
      await this.finalize(jobRow, sandboxInfo, workspace, jobLog);

      // ── Learning pass (after PR) ─────────────────────────────────────────
      const stepCost = this.stepRunner.getCostSummary();
      let totalInputTokens = stepCost.inputTokens;
      let totalOutputTokens = stepCost.outputTokens;
      let totalCostUsd = stepCost.costUsd;

      const freshJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!freshJob?.disableLearning) {
        await this.mustTransition(jobId, 'publishing', 'learning');
        const learningCost = await runLearningPass(jobId, sandboxInfo, workspace, { db, log: jobLog });
        totalInputTokens += learningCost.inputTokens;
        totalOutputTokens += learningCost.outputTokens;
        totalCostUsd += learningCost.costUsd;
        await this.mustTransition(jobId, 'learning', 'completed', { completedAt: new Date() });
      } else {
        await this.mustTransition(jobId, 'publishing', 'completed', { completedAt: new Date() });
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

        await this.stepRunner.run(jobRow, sandboxInfo);

        // ── Publish (PR creation) ──────────────────────────────────────────
        await this.mustTransition(jobId, 'preparing', 'publishing');
        await this.finalize(jobRow, sandboxInfo, workspace, log);

        // ── Learning pass (after PR) ───────────────────────────────────────
        const stepCost = this.stepRunner.getCostSummary();
        let totalInputTokens = stepCost.inputTokens;
        let totalOutputTokens = stepCost.outputTokens;
        let totalCostUsd = stepCost.costUsd;

        const freshJob = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
        if (!freshJob?.disableLearning) {
          await this.mustTransition(jobId, 'publishing', 'learning');
          const learningCost = await runLearningPass(jobId, sandboxInfo, workspace, { db, log });
          totalInputTokens += learningCost.inputTokens;
          totalOutputTokens += learningCost.outputTokens;
          totalCostUsd += learningCost.costUsd;
          await this.mustTransition(jobId, 'learning', 'completed', { completedAt: new Date() });
        } else {
          await this.mustTransition(jobId, 'publishing', 'completed', { completedAt: new Date() });
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

    const plan = await this.loadApprovedPlan(job.id);
    const prTitle = await this.generatePrTitle(job, plan, sandboxInfo, log);
    const prBody = buildPrBody(job, plan);

    const requestId = randomUUID();
    const response = await fetch(`${sandboxInfo.endpoint}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({
        sessionId: job.id,
        repoUrl: job.githubUrl,
        baseBranch: job.githubBranch,
        branchName: `praxis/job-${job.id.substring(0, 8)}`,
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

    return (await response.json()) as {
      branchName: string;
      commitSha: string;
      prNumber: number;
      prUrl: string;
    };
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
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
        },
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

const PR_TITLE_SYSTEM_PROMPT = `You generate pull request titles using conventional commits format.
Respond with ONLY the title — no explanation, no markdown, no punctuation at the end.
Format: <type>: <short description>
Types: feat (new feature), fix (bug fix), refactor (code restructure without behavior change),
chore (maintenance, deps, config), docs (documentation), test (tests), perf (performance).
Keep the description under 72 characters total.`;

/**
 * Builds a markdown PR body from the job description and approved plan.
 */
function buildPrBody(job: Job, plan: Plan | null): string {
  const parts: string[] = [];

  if (job.description) {
    parts.push(`## Task\n\n${job.description}`);
  }

  if (plan) {
    parts.push(`## Plan\n\n**${plan.data.title}**\n\n${plan.data.summary}`);

    if (plan.data.steps.length > 0) {
      const steps = plan.data.steps
        .map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${s.content}`)
        .join('\n');
      parts.push(`### Steps\n\n${steps}`);
    }

    if (plan.data.affectedPaths.length > 0) {
      parts.push(`### Affected files\n\n${plan.data.affectedPaths.map((p) => `- \`${p}\``).join('\n')}`);
    }

    if (plan.data.risks && plan.data.risks.length > 0) {
      parts.push(`### Risks\n\n${plan.data.risks.map((r) => `- ${r}`).join('\n')}`);
    }

    if (plan.data.bodyMarkdown) {
      parts.push(`### Full plan\n\n${plan.data.bodyMarkdown}`);
    }
  }

  parts.push(`---\n_Created by [Praxis](https://github.com/MiteshSharma/praxis) · job \`${job.id.substring(0, 8)}\`_`);

  return parts.join('\n\n');
}

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
  },
): Promise<string> {
  const response = await fetch(`${sandboxInfo.endpoint}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': randomUUID() },
    body: JSON.stringify({ ...body, workingDir: '/', maxTurns: 1 }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`sandbox /prompt failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic stream frame split
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n');
        if (!data) continue;
        try {
          const msg = JSON.parse(data) as Record<string, unknown>;
          if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string') {
            text = msg.result;
          }
        } catch { /* non-JSON frame */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return text;
}

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
