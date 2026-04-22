import { randomUUID } from 'node:crypto';
import type { JobStatus, NotifyEvent, PlanWakeEvent } from '@shared/contracts';
import { assertTransition } from '@shared/contracts';
import { type Database, type Job, type JobStep, agentSkills, agentVersions, agents, artifacts, conversations, jobSteps, jobs } from '@shared/db';
import type { SandboxInfo, SandboxProvider } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import type { AgentRef } from '@shared/workflows';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import type PgBoss from 'pg-boss';
import { emitNotification } from '../egress/notify';
import { DEFAULT_AGENT } from '../defaults/default-agent';
import { mintCallbackToken } from '../plan-review/auth';
import { dispatchToConversation } from '../channels/dispatch';
import { buildExecuteSystemPrompt } from '../prompts/execute-session';
import { buildMemorySection, buildPlanSessionSystemPrompt } from '../prompts/plan-session';
import { buildRevisionSystemPrompt } from '../prompts/revision-session';
import { buildScoutSystemPrompt } from '../prompts/scout-session';
import { SCOUT_AGENT } from '../defaults/scout-agent';
import type { TaskTracker } from '../task-tracker/task-tracker';
import { parseSSE } from './sse';
import { appendTimeline, transitionJob } from './transitions';
import { buildResumeContext, isContextOverflowError } from './compress';

const DEFAULT_PLAN_HOLD_HOURS = 24;


export type PluginRegistryFactory = (db: Database) => { resolveForConversation(conversationId: string | null | undefined): Promise<import('@shared/mcp').ResolvedPlugin[]> };

export interface StepRunnerDeps {
  db: Database;
  boss: PgBoss;
  sandbox: SandboxProvider;
  taskTracker: TaskTracker;
  log: Logger;
  redisUrl: string;
  mcpEndpoint?: string;
  mcpSecret?: string;
  /** Repo memory markdown loaded during the preparing phase. Injected into plan-session prompts. */
  memoryMarkdown?: string | null;
  /** Resolved provider API keys (DB or env fallback). Set by JobOrchestrator before run(). */
  providerEnv?: Record<string, string>;
  /** Public base URL of this control-plane, e.g. http://localhost:3000. Used to build callback URLs for plan review channels. */
  controlPlaneUrl?: string;
  /** Override plugin registry factory for testing */
  createPluginRegistry?: PluginRegistryFactory;
  /** Override fetch for testing */
  fetchFn?: typeof fetch;
  /** Override Redis subscriber for testing (replaces new Redis(redisUrl) in waitForWake) */
  createRedis?: (url: string) => import('ioredis').Redis;
  /** Override MCP token minting for testing */
  mintMcpToken?: (jobId: string) => Promise<string | undefined>;
  /**
   * Auxiliary model for context compression (haiku / flash). If not set,
   * falls back to the SETTING_DEFAULTS value. Set by JobOrchestrator.
   */
  auxiliaryModel?: string;
}

export class CheckFailedError extends Error {
  constructor(
    message: string,
    public readonly artifactId: string,
  ) {
    super(message);
    this.name = 'CheckFailedError';
  }
}

export class PlanRejectedError extends Error {
  constructor() {
    super('plan rejected by user');
    this.name = 'PlanRejectedError';
  }
}

export class HoldTimeoutError extends Error {
  constructor() {
    super('plan review hold timed out — entering cold suspension');
    this.name = 'HoldTimeoutError';
  }
}

/**
 * Strip workingDir prefix from file paths inside tool_use / tool_result chunks
 * so that all downstream consumers (Postgres timeline, Redis SSE, frontend) see
 * clean repo-relative paths instead of absolute sandbox paths.
 *
 * Handles both provider conventions:
 *   Claude SDK  → assistant.message.content[].tool_use { name:'Write'|'Edit', input.file_path }
 *   OpenAI/Demo → assistant.message.content[].tool_use { name:'write_file'|'edit_file', input.path }
 *   Phase-2 executor results → user.message.content[].tool_result { content: JSON { path, status } }
 */
function normalizeChunkPaths(chunk: unknown, workingDir: string): unknown {
  if (!chunk || typeof chunk !== 'object') return chunk;
  const msg = chunk as Record<string, unknown>;

  // On macOS /var is a symlink to /private/var, so the SDK may resolve cwd to
  // the canonical /private/... form while workingDir was created without it (or
  // vice-versa).  Normalise both sides to the /private-stripped form before
  // comparing so the prefix check works regardless of which variant each holds.
  const depriv = (s: string) => (s.startsWith('/private/') ? s.slice('/private'.length) : s);
  const wdNorm = depriv(workingDir);
  function stripPrefix(p: string): string {
    const pNorm = depriv(p);
    return pNorm.startsWith(wdNorm) ? pNorm.slice(wdNorm.length).replace(/^\//, '') : p;
  }

  if (msg.type === 'assistant') {
    const message = msg.message as { content?: unknown[] } | undefined;
    if (!message?.content) return chunk;
    let changed = false;
    const newContent = message.content.map((block) => {
      if (!block || typeof block !== 'object') return block;
      const b = block as Record<string, unknown>;
      if (b.type !== 'tool_use') return block;
      if (b.name !== 'Write' && b.name !== 'Edit' && b.name !== 'write_file' && b.name !== 'edit_file') return block;
      const input = b.input as Record<string, unknown> | undefined;
      if (!input) return block;
      if (typeof input.file_path === 'string') {
        const rel = stripPrefix(input.file_path);
        if (rel !== input.file_path) { changed = true; return { ...b, input: { ...input, file_path: rel } }; }
      }
      if (typeof input.path === 'string') {
        const rel = stripPrefix(input.path);
        if (rel !== input.path) { changed = true; return { ...b, input: { ...input, path: rel } }; }
      }
      return block;
    });
    return changed ? { ...msg, message: { ...message, content: newContent } } : chunk;
  }

  if (msg.type === 'user') {
    const message = msg.message as { content?: unknown[] } | undefined;
    if (!message?.content) return chunk;
    let changed = false;
    const newContent = message.content.map((block) => {
      if (!block || typeof block !== 'object') return block;
      const b = block as Record<string, unknown>;
      if (b.type !== 'tool_result' || typeof b.content !== 'string') return block;
      try {
        const json = JSON.parse(b.content) as { path?: string; status?: string };
        if (typeof json.path === 'string') {
          const rel = stripPrefix(json.path);
          if (rel !== json.path) { changed = true; return { ...b, content: JSON.stringify({ ...json, path: rel }) }; }
        }
      } catch { /* not structured JSON */ }
      return block;
    });
    return changed ? { ...msg, message: { ...message, content: newContent } } : chunk;
  }

  return chunk;
}

export class StepRunner {
  private _totalInputTokens = 0;
  private _totalOutputTokens = 0;
  private _totalCostUsd = 0;

  constructor(private readonly deps: StepRunnerDeps) {}

  /** Called by JobOrchestrator after loading repo memory during the preparing phase. */
  setMemory(memoryMarkdown: string | null): void {
    this.deps.memoryMarkdown = memoryMarkdown;
  }

  /** Called by JobOrchestrator with resolved provider API keys before run(). */
  setProviderEnv(env: Record<string, string>): void {
    this.deps.providerEnv = env;
  }

  /** Called by JobOrchestrator with the auxiliary model for compression passes. */
  setAuxiliaryModel(model: string): void {
    this.deps.auxiliaryModel = model;
  }

  /** Returns accumulated token + cost totals across all steps run so far. */
  getCostSummary(): { inputTokens: number; outputTokens: number; costUsd: number } {
    return {
      inputTokens: this._totalInputTokens,
      outputTokens: this._totalOutputTokens,
      costUsd: this._totalCostUsd,
    };
  }

  async run(job: Job, sandboxInfo: SandboxInfo): Promise<void> {
    const { db } = this.deps;
    const log = this.deps.log.child({ jobId: job.id });
    const workspace = sandboxInfo.workspacePath ?? '';

    const steps = await db.query.jobSteps.findMany({
      where: eq(jobSteps.jobId, job.id),
      orderBy: [asc(jobSteps.stepIndex)],
    });

    if (steps.length === 0) {
      log.warn('no steps found for job');
      return;
    }

    let cursor = job.currentStepIndex ?? 0;

    while (cursor < steps.length) {
      const step = steps[cursor];
      if (!step) break;

      if (step.status === 'passed' || step.status === 'skipped') {
        cursor++;
        continue;
      }

      // Mark step as running
      await db
        .update(jobs)
        .set({ currentStepIndex: cursor, updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
      await db
        .update(jobSteps)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(jobSteps.id, step.id));
      const seq = await appendTimeline(db, job.id, 'step-started', {
        stepId: step.id,
        index: cursor,
        kind: step.kind,
        name: step.name,
      });
      await this.emit(job.id, seq, {
        kind: 'chunk',
        raw: { type: 'step-started', stepId: step.id, name: step.name, stepKind: step.kind },
      });

      try {
        switch (step.kind) {
          case 'plan':
            await this.runPlanStep(job, step, sandboxInfo, workspace, log);
            break;
          case 'execute':
            await this.runExecuteStep(job, step, sandboxInfo, workspace, log);
            break;
          case 'check':
            await this.runCheckStep(job, step, sandboxInfo, workspace, log);
            break;
          case 'scout':
            await this.runScoutStep(job, step, sandboxInfo, workspace, log);
            break;
          default:
            throw new Error(`unknown step kind: ${step.kind}`);
        }

        // Step passed
        await this.markStepPassed(step);
        log.info({ stepId: step.id, kind: step.kind, name: step.name }, 'step passed');

        // After a recovery execute, re-queue the failed check as a retry
        if (
          step.kind === 'execute' &&
          (step.config as { condition?: string }).condition === 'previous_check_failed'
        ) {
          const retriedAt = await this.requeueFailedChecksAsRetries(job.id, steps, cursor);
          if (retriedAt !== null) {
            // Reload steps (new retry rows were inserted); restart from retry position
            const refreshed = await db.query.jobSteps.findMany({
              where: eq(jobSteps.jobId, job.id),
              orderBy: [asc(jobSteps.stepIndex)],
            });
            steps.splice(0, steps.length, ...refreshed);
            cursor = retriedAt;
            continue;
          }
        }
      } catch (err) {
        if (err instanceof PlanRejectedError) throw err;
        if (err instanceof HoldTimeoutError) throw err;

        await this.markStepFailed(step, err);
        log.error({ stepId: step.id, kind: step.kind, err }, 'step failed');

        // Look for a recovery execute step immediately after this one
        const nextStep = steps[cursor + 1];
        if (
          nextStep &&
          nextStep.kind === 'execute' &&
          (nextStep.config as { condition?: string }).condition === 'previous_check_failed'
        ) {
          // Skip any steps between current and recovery step (none in this case, but be safe)
          cursor++;
          continue;
        }

        throw err;
      }

      cursor++;
    }
  }

  // ── Step handlers ──────────────────────────────────────────────────────────

  private async runPlanStep(
    job: Job,
    _step: JobStep,
    sandboxInfo: SandboxInfo,
    workspace: string,
    log: Logger,
  ): Promise<void> {
    const { db } = this.deps;

    await this.mustTransition(job.id, 'preparing', 'building');

    // Load parent context for follow-up jobs
    let parentContext: import('../prompts/plan-session').ParentContext | undefined;
    if (job.parentJobId) {
      const parentPlan = await this.deps.taskTracker.getLatestPlanForJob(job.parentJobId);
      if (parentPlan) {
        const data = parentPlan.data as { bodyMarkdown?: string };
        const parentJob = await this.deps.db.query.jobs.findFirst({ where: eq(jobs.id, job.parentJobId) });
        if (data.bodyMarkdown && parentJob) {
          parentContext = { planBodyMarkdown: data.bodyMarkdown, jobTitle: parentJob.title };
        }
      }
    }

    const resolvedPlugins = await this.resolvePlugins(job.conversationId);

    const mcpToken = await this.mintToken(job.id);
    if (!mcpToken || !this.deps.mcpEndpoint) {
      throw new Error(
        'Plan steps require MCP to be configured. ' +
        'Set MCP_SHARED_SECRET (≥32 chars) and CONTROL_PLANE_MCP_URL in .env.local and restart the backend.',
      );
    }

    const resolved = await this.resolveStepAgent(_step, job.model ?? undefined);
    const basePrompt = buildPlanSessionSystemPrompt(parentContext, workspace);
    const memorySection = this.deps.memoryMarkdown
      ? buildMemorySection(this.deps.memoryMarkdown)
      : '';
    const systemPrompt = resolved?.systemPrompt
      ? `${basePrompt}\n\n${resolved.systemPrompt}${memorySection}`
      : `${basePrompt}${memorySection}`;

    const planPromptSeq = await appendTimeline(this.deps.db, job.id, 'prompt-snapshot', { phase: 'plan', systemPrompt });
    await this.emit(job.id, planPromptSeq, { kind: 'prompt-snapshot', phase: 'plan', systemPrompt });

    await this.callSandboxPrompt(
      job,
      sandboxInfo,
      {
        model: resolved?.model ?? job.model ?? undefined,
        systemPrompt,
        allowedTools: resolved?.allowedTools,
        workingDir: workspace,
        mcpToken,
        mcpEndpoint: this.deps.mcpEndpoint,
        sessionPhase: 'plan',
        plugins: resolvedPlugins,
        stepId: _step.id,
      },
      log,
    );

    await this.mustTransition(job.id, 'building', 'plan_ready');
    await this.mustTransition(job.id, 'plan_ready', 'plan_review');

    // Load hold hours from conversation (falls back to default)
    const holdHours = await this.getHoldHours(job);

    // Dispatch plan-review notifications to configured channels (fire-and-forget)
    await this.dispatchReviewNotifications(job, holdHours, log);

    // Auto-approve: skip hold, proceed immediately
    if (job.autoApprove) {
      await this.mustTransition(job.id, 'plan_review', 'preparing');
      log.info('plan auto-approved — skipping review hold');
      return;
    }

    const action = await this.holdForPlanReview(job.id, sandboxInfo, holdHours, log);

    switch (action.kind) {
      case 'approve': {
        await this.mustTransition(job.id, 'plan_review', 'preparing');
        log.info('plan approved — proceeding to execute');
        return;
      }
      case 'revise': {
        await this.mustTransition(job.id, 'plan_review', 'plan_revising');
        await this.runRevisionSession(job, sandboxInfo, workspace, log);
        await this.mustTransition(job.id, 'plan_revising', 'plan_ready');
        await this.mustTransition(job.id, 'plan_ready', 'plan_review');
        // Dispatch notifications for the revised plan
        await this.dispatchReviewNotifications(job, holdHours, log);
        // Back to preparing before recursing — runPlanStep expects this state
        await this.mustTransition(job.id, 'plan_review', 'preparing');
        // Recurse into another review cycle
        // Reload job to get updated planRevisionCount
        const refreshed = await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) });
        await this.runPlanStep(refreshed ?? job, _step, sandboxInfo, workspace, log);
        return;
      }
      case 'reject': {
        await this.mustTransition(job.id, 'plan_review', 'plan_rejected');
        throw new PlanRejectedError();
      }
      case 'timeout': {
        log.info('plan review hold timed out — cold suspension');
        throw new HoldTimeoutError();
      }
    }
  }

  private async runExecuteStep(
    job: Job,
    step: JobStep,
    sandboxInfo: SandboxInfo,
    workspace: string,
    log: Logger,
  ): Promise<void> {
    const plan = await this.deps.taskTracker.getLatestPlanForJob(job.id);

    const cfg = step.config as { condition?: string; recoveryContext?: string };
    let systemPrompt: string;

    if (cfg.condition === 'previous_check_failed' && cfg.recoveryContext) {
      // Recovery execute: inject failure context into system prompt
      const base = plan ? buildExecuteSystemPrompt(plan, workspace) : '';
      systemPrompt = `${base}\n\n## Recovery context\n\nThe previous check step failed. Here is the failure output:\n\n${cfg.recoveryContext}\n\nPlease fix the issues and ensure the check passes.`;
    } else if (plan) {
      systemPrompt = buildExecuteSystemPrompt(plan, workspace);
    } else {
      // No plan — fall back to generic implementation prompt
      systemPrompt = DEFAULT_AGENT.systemPrompt;
    }

    // Inject upstream context from scout/verify jobs declared in contextJobIds
    const ctxIds = job.contextJobIds as string[] | null;
    if (ctxIds?.length) {
      const upstream = await this.deps.db.query.jobs.findMany({
        where: inArray(jobs.id, ctxIds),
        columns: { id: true, title: true, output: true, triggerKind: true },
      });
      const parts = upstream
        .filter((j) => j.output != null)
        .map((j) => `### Findings from: ${j.title} (${j.triggerKind})\n${JSON.stringify(j.output, null, 2)}`);
      if (parts.length > 0) {
        systemPrompt += `\n\n---\n## Upstream findings\n\n${parts.join('\n\n')}`;
      }
    }

    const resolvedPlugins = await this.resolvePlugins(job.conversationId);

    const resolved = await this.resolveStepAgent(step, job.model ?? undefined);
    if (resolved?.systemPrompt) {
      systemPrompt = `${systemPrompt}\n\n${resolved.systemPrompt}`;
    }

    const execPromptSeq = await appendTimeline(this.deps.db, job.id, 'prompt-snapshot', { phase: 'execute', systemPrompt });
    await this.emit(job.id, execPromptSeq, { kind: 'prompt-snapshot', phase: 'execute', systemPrompt });

    const mcpToken = await this.mintToken(job.id);

    await this.mustTransition(job.id, 'preparing', 'executing');

    const MAX_RESUME_ATTEMPTS = 2;
    let resumeContext = '';
    let attempt = 0;

    while (true) {
      try {
        await this.callSandboxPrompt(
          job,
          sandboxInfo,
          {
            model: resolved?.model ?? job.model ?? undefined,
            systemPrompt: systemPrompt + resumeContext,
            allowedTools: resolved?.allowedTools,
            workingDir: workspace,
            mcpToken,
            mcpEndpoint: this.deps.mcpEndpoint,
            sessionPhase: 'execute',
            plugins: resolvedPlugins,
            stepId: step.id,
          },
          log,
        );
        break; // success
      } catch (err) {
        if (!isContextOverflowError(err) || attempt >= MAX_RESUME_ATTEMPTS) throw err;
        attempt++;
        log.warn({ jobId: job.id, attempt }, 'execute: context overflow — compressing and retrying');
        await appendTimeline(this.deps.db, job.id, 'context-compressed', { attempt });
        resumeContext = await buildResumeContext(job.id, sandboxInfo, workspace, {
          db: this.deps.db,
          log,
          auxiliaryModel: this.deps.auxiliaryModel ?? 'claude-haiku-4-5-20251001',
          providerEnv: this.deps.providerEnv ?? {},
          fetchFn: this.deps.fetchFn,
        });
      }
    }

    await this.mustTransition(job.id, 'executing', 'preparing');
  }

  private async runCheckStep(
    job: Job,
    step: JobStep,
    sandboxInfo: SandboxInfo,
    _workspace: string,
    log: Logger,
  ): Promise<void> {
    const { db } = this.deps;
    const cfg = step.config as { command: string; timeoutSeconds?: number; capture?: string };

    log.info({ command: cfg.command }, 'running check step');

    const fetchFn = this.deps.fetchFn ?? fetch;
    const result = await fetchFn(`${sandboxInfo.endpoint}/exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: cfg.command,
        cwd: _workspace,
        timeoutSeconds: cfg.timeoutSeconds ?? 300,
      }),
    }).then((r) => r.json() as Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>);

    // Capture output per capture mode
    const capture = cfg.capture ?? 'both';
    const logBody =
      capture === 'stdout'
        ? result.stdout
        : capture === 'stderr'
          ? result.stderr
          : `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

    const [artifact] = await db
      .insert(artifacts)
      .values({
        jobId: job.id,
        kind: 'log',
        path: null,
        url: null,
        metadata: {
          stepId: step.id,
          command: cfg.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          output: logBody.slice(0, 8000), // cap at 8kb inline
        },
      })
      .returning();

    if (artifact) {
      await db
        .update(jobSteps)
        .set({
          output: {
            exitCode: result.exitCode,
            artifactId: artifact.id,
            output: logBody.slice(0, 2000),
          },
        })
        .where(eq(jobSteps.id, step.id));
    }

    if (result.exitCode !== 0) {
      throw new CheckFailedError(
        `${cfg.command} exited with ${result.exitCode}`,
        artifact?.id ?? '',
      );
    }

    log.info({ command: cfg.command, exitCode: result.exitCode }, 'check step passed');
  }

  private async runScoutStep(
    job: Job,
    step: JobStep,
    sandboxInfo: SandboxInfo,
    workspace: string,
    log: Logger,
  ): Promise<void> {
    const systemPrompt = buildScoutSystemPrompt(
      job.description ?? job.title,
      workspace,
    );

    const execPromptSeq = await appendTimeline(this.deps.db, job.id, 'prompt-snapshot', { phase: 'scout', systemPrompt });
    await this.emit(job.id, execPromptSeq, { kind: 'prompt-snapshot', phase: 'scout', systemPrompt });

    await this.mustTransition(job.id, 'preparing', 'executing');
    const stepModel = (step.config as { model?: string }).model;
    await this.callSandboxPrompt(
      job,
      sandboxInfo,
      {
        model: stepModel ?? job.model ?? undefined,
        systemPrompt,
        allowedTools: SCOUT_AGENT.allowedTools,
        workingDir: workspace,
        sessionPhase: 'scout',
        stepId: step.id,
      },
      log,
    );
    await this.mustTransition(job.id, 'executing', 'preparing');
  }

  // ── Revision session ───────────────────────────────────────────────────────

  private async runRevisionSession(
    job: Job,
    sandboxInfo: SandboxInfo,
    workspace: string,
    log: Logger,
  ): Promise<void> {
    const previousPlan = await this.deps.taskTracker.getLatestPlanForJob(job.id);
    if (!previousPlan) throw new Error('no previous plan for revision');

    const feedback = previousPlan.feedbackFromUser
      ? (JSON.parse(previousPlan.feedbackFromUser) as {
          answers?: Record<string, string>;
          additionalFeedback?: string;
        })
      : {};

    const systemPrompt = buildRevisionSystemPrompt({
      previousPlan,
      answers: feedback.answers,
      additionalFeedback: feedback.additionalFeedback,
    }, workspace);

    const mcpToken = await this.mintToken(job.id);
    if (!mcpToken || !this.deps.mcpEndpoint) {
      throw new Error(
        'Revision steps require MCP to be configured. ' +
        'Set MCP_SHARED_SECRET (≥32 chars) and CONTROL_PLANE_MCP_URL in .env.local and restart the backend.',
      );
    }

    await this.callSandboxPrompt(
      job,
      sandboxInfo,
      {
        systemPrompt,
        workingDir: workspace,
        mcpToken,
        mcpEndpoint: this.deps.mcpEndpoint,
        sessionPhase: 'revise',
      },
      log,
    );
  }

  // ── Hot hold ───────────────────────────────────────────────────────────────

  private async holdForPlanReview(
    jobId: string,
    _sandboxInfo: SandboxInfo,
    holdHours: number,
    log: Logger,
  ): Promise<PlanWakeEvent | { kind: 'timeout' }> {
    const { db } = this.deps;
    const holdMs = holdHours * 60 * 60 * 1000;
    const holdUntil = new Date(Date.now() + holdMs);

    await db
      .update(jobs)
      .set({ planReviewHoldUntil: holdUntil, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    log.info({ holdUntil, holdHours }, 'entering hot hold for plan review');

    const result = await Promise.race([
      this.waitForWake(jobId),
      sleep(holdMs).then((): { kind: 'timeout' } => ({ kind: 'timeout' })),
    ]);

    if (result.kind !== 'timeout') {
      // CAS: claim the hold atomically to prevent race with timeout
      const claimed = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(jobs)
          .set({ planReviewHoldUntil: null, updatedAt: new Date() })
          .where(eq(jobs.id, jobId))
          .returning();
        return !!row;
      });

      if (!claimed) {
        log.warn('CAS failed on plan hold claim — falling back to timeout path');
        return { kind: 'timeout' };
      }
    } else {
      await db
        .update(jobs)
        .set({ planReviewHoldUntil: null, updatedAt: new Date() })
        .where(eq(jobs.id, jobId));
    }

    return result;
  }

  private async waitForWake(jobId: string): Promise<PlanWakeEvent> {
    const channel = `run:${jobId}:plan-event`;
    const createRedis = this.deps.createRedis ?? ((url) => new Redis(url));
    const sub = createRedis(this.deps.redisUrl);

    return new Promise((resolve, reject) => {
      sub.subscribe(channel, (err) => {
        if (err) {
          sub.disconnect();
          reject(err);
        }
      });
      sub.on('message', (_, msg) => {
        sub.disconnect();
        try {
          resolve(JSON.parse(msg) as PlanWakeEvent);
        } catch {
          reject(new Error(`invalid wake message: ${msg}`));
        }
      });
    });
  }

  // ── Recovery helpers ───────────────────────────────────────────────────────

  /**
   * After a recovery execute step passes, find the failed check steps that
   * preceded it and insert new retry rows after the execute step.
   * Returns the index of the first new retry step (so the caller can resume there),
   * or null if nothing was re-queued.
   */
  private async requeueFailedChecksAsRetries(
    jobId: string,
    steps: JobStep[],
    executeCursor: number,
  ): Promise<number | null> {
    const { db } = this.deps;

    // Walk backwards from the execute step to find failed check steps
    const failedChecks: JobStep[] = [];
    for (let i = executeCursor - 1; i >= 0; i--) {
      const s = steps[i];
      if (!s) break;
      if (s.kind === 'check' && s.status === 'failed') {
        failedChecks.unshift(s); // collect in original order
      } else {
        break;
      }
    }

    if (failedChecks.length === 0) return null;

    // Find the highest existing stepIndex to place retries after it
    const maxIndex = Math.max(...steps.map((s) => s.stepIndex));
    const retryRows = failedChecks.map((fc, i) => ({
      jobId,
      stepIndex: maxIndex + 1 + i,
      retryOf: fc.id,
      kind: fc.kind,
      name: `${fc.name} (retry)`,
      config: fc.config,
      status: 'pending' as const,
    }));

    await db.insert(jobSteps).values(retryRows);

    // Return the index position of the first retry in the new steps array
    return executeCursor + 1;
  }

  // ── Agent + skill resolution ───────────────────────────────────────────────

  /**
   * Resolves the agent definition for a step by loading the agent version from
   * the DB and merging in all attached skills (ordered by position) plus any
   * step-level skill override. Returns null when the step has no agent/skill
   * config, signalling the caller to fall back to the default prompts.
   */
  private async resolveStepAgent(step: JobStep, jobModel?: string): Promise<{
    model: string;
    systemPrompt: string;
    allowedTools: string[];
  } | null> {
    const cfg = step.config as {
      agent?: { ref: string; agentId?: string };
      skillId?: string;
      model?: string;
    };

    // Step-level model with no agent: return just the model override, no prompt injection
    if (!cfg.agent && !cfg.skillId) {
      return cfg.model ? { model: cfg.model, systemPrompt: '', allowedTools: DEFAULT_AGENT.allowedTools } : null;
    }

    let model = jobModel ?? DEFAULT_AGENT.model;
    let basePrompt = '';
    let baseTools: string[] = [...DEFAULT_AGENT.allowedTools];

    // Load the primary agent's latest version
    if (cfg.agent?.ref === 'id' && cfg.agent.agentId) {
      const [version] = await this.deps.db
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.agentId, cfg.agent.agentId))
        .orderBy(desc(agentVersions.version))
        .limit(1);

      if (version) {
        const def = version.definition as { model?: string; systemPrompt?: string; allowedTools?: string[] };
        model = def.model ?? model;
        basePrompt = def.systemPrompt ?? '';
        baseTools = def.allowedTools ?? baseTools;
      }
    }

    // When skill is used standalone (no agent), load its declared dependency agents.
    // Stored separately so skill instructions appear first in the final prompt —
    // the skill establishes what to do, the dependency agents provide how to do it.
    const skillDepSections: string[] = [];

    if (!cfg.agent && cfg.skillId) {
      const [skillVer] = await this.deps.db
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.agentId, cfg.skillId))
        .orderBy(desc(agentVersions.version))
        .limit(1);

      const dependsOn = (skillVer?.definition as { dependsOn?: string[] })?.dependsOn ?? [];

      for (const depId of dependsOn) {
        const [[depAgent], [depVer]] = await Promise.all([
          this.deps.db.select().from(agents).where(eq(agents.id, depId)).limit(1),
          this.deps.db
            .select()
            .from(agentVersions)
            .where(eq(agentVersions.agentId, depId))
            .orderBy(desc(agentVersions.version))
            .limit(1),
        ]);

        if (depVer) {
          const def = depVer.definition as { model?: string; systemPrompt?: string; allowedTools?: string[] };
          if (!jobModel && def.model) model = def.model;
          if (def.systemPrompt) {
            const label = depAgent ? `# ${depAgent.name}\n\n` : '';
            skillDepSections.push(`${label}${def.systemPrompt}`);
          }
          if (def.allowedTools?.length) baseTools = [...new Set([...baseTools, ...def.allowedTools])];
        }
      }
    }

    // Collect skill IDs: agent-attached skills (in position order) + step-level skill
    const skillIds: string[] = [];

    if (cfg.agent?.ref === 'id' && cfg.agent.agentId) {
      const attached = await this.deps.db
        .select()
        .from(agentSkills)
        .where(eq(agentSkills.agentId, cfg.agent.agentId))
        .orderBy(asc(agentSkills.position));
      skillIds.push(...attached.map((r) => r.skillId));
    }

    if (cfg.skillId && !skillIds.includes(cfg.skillId)) {
      skillIds.push(cfg.skillId);
    }

    // Load each skill's latest version and merge instructions + tools.
    // Each skill section is labeled with the skill name so the model knows which
    // instructions come from which skill.
    const skillInstructions: string[] = [];
    const skillTools: string[] = [];

    for (const sid of skillIds) {
      const [[skillAgent], [sv]] = await Promise.all([
        this.deps.db.select().from(agents).where(eq(agents.id, sid)).limit(1),
        this.deps.db
          .select()
          .from(agentVersions)
          .where(eq(agentVersions.agentId, sid))
          .orderBy(desc(agentVersions.version))
          .limit(1),
      ]);

      if (sv) {
        const def = sv.definition as { systemPrompt?: string; allowedTools?: string[] };
        if (def.systemPrompt) {
          const label = skillAgent ? `# ${skillAgent.name}\n\n` : '';
          skillInstructions.push(`${label}${def.systemPrompt}`);
        }
        if (def.allowedTools?.length) skillTools.push(...def.allowedTools);
      }
    }

    // Order: primary agent (if any) → skill instructions → dependency agents
    // For skill-standalone: skill comes first (establishes orchestration),
    // then dependency agents (provide the detailed sub-agent prompts).
    // Step-level model always wins — it's the most specific override.
    const finalModel = cfg.model ?? model;
    return {
      model: finalModel,
      systemPrompt: [basePrompt, ...skillInstructions, ...skillDepSections].filter(Boolean).join('\n\n'),
      allowedTools: [...new Set([...baseTools, ...skillTools])],
    };
  }

  // ── Plan review helpers ────────────────────────────────────────────────────

  private async getHoldHours(job: Job): Promise<number> {
    if (!job.conversationId) return DEFAULT_PLAN_HOLD_HOURS;
    const conv = await this.deps.db.query.conversations.findFirst({
      where: eq(conversations.id, job.conversationId),
    });
    return conv?.planHoldHours ?? DEFAULT_PLAN_HOLD_HOURS;
  }

  private async dispatchReviewNotifications(job: Job, holdHours: number, log: Logger): Promise<void> {
    if (!job.conversationId) return;
    if (!this.deps.mcpSecret || !this.deps.controlPlaneUrl) return;

    const plan = await this.deps.taskTracker.getLatestPlanForJob(job.id);
    if (!plan) return;

    const planData = plan.data as {
      title?: string; summary?: string; bodyMarkdown?: string;
      steps?: Array<{ id: string; content: string; status: string }>;
      affectedPaths?: string[]; risks?: string[];
    };

    try {
      const callbackToken = await mintCallbackToken(job.id, this.deps.mcpSecret, holdHours);
      const callbackUrl = `${this.deps.controlPlaneUrl}/plan-review/respond`;

      await dispatchToConversation(
        this.deps.db,
        job.conversationId,
        {
          type: 'plan.ready',
          job: {
            id: job.id,
            title: job.title,
            description: job.description,
            githubUrl: job.githubUrl,
          },
          plan: {
            title: planData.title ?? job.title,
            summary: planData.summary ?? '',
            bodyMarkdown: planData.bodyMarkdown ?? '',
            steps: planData.steps ?? [],
            affectedPaths: planData.affectedPaths ?? [],
            risks: planData.risks ?? [],
          },
          callbackToken,
          callbackUrl,
        },
        log,
      );
    } catch (err) {
      log.warn({ err, jobId: job.id }, 'failed to dispatch plan review notifications');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async callSandboxPrompt(
    job: Job,
    sandboxInfo: SandboxInfo,
    opts: {
      model?: string;
      systemPrompt: string;
      allowedTools?: string[];
      workingDir: string;
      mcpToken?: string;
      mcpEndpoint?: string;
      sessionPhase: string;
      plugins?: import('@shared/mcp').ResolvedPlugin[];
      stepId?: string;
    },
    log: Logger,
  ): Promise<void> {
    const { db } = this.deps;
    const requestId = randomUUID();

    const response = await (this.deps.fetchFn ?? fetch)(`${sandboxInfo.endpoint}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({
        sessionId: job.id,
        jobId: job.id,
        title: job.title,
        description: job.description,
        workingDir: opts.workingDir,
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        allowedTools: opts.allowedTools,
        sessionPhase: opts.sessionPhase,
        env: this.deps.providerEnv ?? {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
        },
        mcpToken: opts.mcpToken,
        mcpEndpoint: opts.mcpEndpoint,
        plugins: opts.plugins ?? [],
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`sandbox /prompt failed: ${response.status}`);
    }

    // Heartbeat: touch updated_at every 30 s so the stuck-job recovery cron
    // does not mistake an active sandbox session for a hung job.
    let lastHeartbeat = Date.now();
    let perCallInputTokens = 0;
    let perCallOutputTokens = 0;
    let perCallCostUsd = 0;

    for await (const chunk of parseSSE(response.body)) {
      if (Date.now() - lastHeartbeat > 30_000) {
        lastHeartbeat = Date.now();
        await db.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, job.id));
      }

      let parsed: unknown = chunk;
      try {
        parsed = JSON.parse(chunk);
      } catch {
        /* leave as string */
      }

      if (parsed !== null && typeof parsed === 'object') {
        const msg = parsed as Record<string, unknown>;
        // Surface agent-level errors (e.g. "Credit balance is too low") as job failures.
        if (msg.type === 'error' && typeof msg.error === 'string') {
          throw new Error(`Agent error: ${msg.error}`);
        }
        // Accumulate cost from the SDK's final result message.
        if (msg.type === 'result' && msg.subtype === 'success') {
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          perCallInputTokens = usage?.input_tokens ?? 0;
          perCallOutputTokens = usage?.output_tokens ?? 0;
          perCallCostUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : 0;
          this._totalInputTokens += perCallInputTokens;
          this._totalOutputTokens += perCallOutputTokens;
          this._totalCostUsd += perCallCostUsd;
        }
      }

      const normalized = normalizeChunkPaths(parsed, opts.workingDir);
      const seq = await appendTimeline(db, job.id, 'chunk', { chunk: normalized });
      await this.emit(job.id, seq, { kind: 'chunk', raw: normalized });
    }

    // Persist per-step cost to job_steps.output so the UI can show it per step.
    if (opts.stepId && (perCallInputTokens > 0 || perCallCostUsd > 0)) {
      await db.update(jobSteps)
        .set({ output: { inputTokens: perCallInputTokens, outputTokens: perCallOutputTokens, costUsd: perCallCostUsd } })
        .where(eq(jobSteps.id, opts.stepId));
    }

    log.info({ phase: opts.sessionPhase }, 'sandbox session finished');
  }

  private async resolvePlugins(conversationId: string | null | undefined): Promise<import('@shared/mcp').ResolvedPlugin[]> {
    if (this.deps.createPluginRegistry) {
      const registry = this.deps.createPluginRegistry(this.deps.db);
      return registry.resolveForConversation(conversationId);
    }
    const { PluginRegistry } = await import('@shared/mcp');
    const registry = new PluginRegistry(this.deps.db);
    return registry.resolveForConversation(conversationId);
  }

  private async mintToken(jobId: string): Promise<string | undefined> {
    if (!this.deps.mcpEndpoint || !this.deps.mcpSecret) return undefined;
    if (this.deps.mintMcpToken) return this.deps.mintMcpToken(jobId);
    const { mintMcpToken } = await import('../mcp/auth');
    return mintMcpToken(jobId, this.deps.mcpSecret);
  }

  private async mustTransition(jobId: string, from: JobStatus, to: JobStatus): Promise<void> {
    assertTransition(from, to);
    const result = await transitionJob(this.deps.db, jobId, from, to);
    if (!result) throw new Error(`transition ${from} → ${to} rejected for job ${jobId}`);
    await this.emit(jobId, result.seq, { kind: 'status-changed', from, to });
  }

  private async emit(jobId: string, seq: number, event: NotifyEvent): Promise<void> {
    try {
      await emitNotification(this.deps.boss, jobId, seq, event);
    } catch (err) {
      this.deps.log.error({ err, jobId, event: event.kind }, 'notification enqueue failed');
    }
  }

  private async markStepPassed(step: JobStep): Promise<void> {
    await this.deps.db
      .update(jobSteps)
      .set({ status: 'passed', completedAt: new Date() })
      .where(eq(jobSteps.id, step.id));
  }

  private async markStepFailed(step: JobStep, err: unknown): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await this.deps.db
      .update(jobSteps)
      .set({ status: 'failed', completedAt: new Date(), errorMessage })
      .where(eq(jobSteps.id, step.id));
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

