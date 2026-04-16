import { randomUUID } from 'node:crypto';
import type { JobStatus, NotifyEvent, PlanWakeEvent } from '@shared/contracts';
import { assertTransition } from '@shared/contracts';
import { type Database, type Job, type JobStep, agentSkills, agentVersions, artifacts, jobSteps, jobs } from '@shared/db';
import type { LocalSandboxProvider, SandboxInfo } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import type { AgentRef } from '@shared/workflows';
import { asc, desc, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import type PgBoss from 'pg-boss';
import { emitNotification } from '../egress/notify';
import { DEFAULT_AGENT } from '../defaults/default-agent';
import { buildExecuteSystemPrompt } from '../prompts/execute-session';
import { buildPlanSessionSystemPrompt } from '../prompts/plan-session';
import { buildRevisionSystemPrompt } from '../prompts/revision-session';
import type { TaskTracker } from '../task-tracker/task-tracker';
import { appendTimeline, transitionJob } from './transitions';

const PLAN_HOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface StepRunnerDeps {
  db: Database;
  boss: PgBoss;
  sandbox: LocalSandboxProvider;
  taskTracker: TaskTracker;
  log: Logger;
  redisUrl: string;
  mcpEndpoint?: string;
  mcpSecret?: string;
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

export class StepRunner {
  constructor(private readonly deps: StepRunnerDeps) {}

  async run(job: Job, sandboxInfo: SandboxInfo): Promise<void> {
    const { db } = this.deps;
    const log = this.deps.log.child({ jobId: job.id });
    const workspace = this.deps.sandbox.workspaceFor(sandboxInfo.providerId);

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

    const { PluginRegistry } = await import('@shared/mcp');
    const registry = new PluginRegistry(this.deps.db);
    const resolvedPlugins = await registry.resolveForConversation(job.conversationId ?? undefined);

    const mcpToken = await this.mintToken(job.id);
    if (!mcpToken || !this.deps.mcpEndpoint) {
      throw new Error(
        'Plan steps require MCP to be configured. ' +
        'Set MCP_SHARED_SECRET (≥32 chars) and CONTROL_PLANE_MCP_URL in .env.local and restart the backend.',
      );
    }

    const resolved = await this.resolveStepAgent(_step);
    const basePrompt = buildPlanSessionSystemPrompt(parentContext, workspace);
    const systemPrompt = resolved
      ? `${basePrompt}\n\n${resolved.systemPrompt}`
      : basePrompt;

    await this.callSandboxPrompt(
      job,
      sandboxInfo,
      {
        model: resolved?.model,
        systemPrompt,
        allowedTools: resolved?.allowedTools,
        workingDir: workspace,
        mcpToken,
        mcpEndpoint: this.deps.mcpEndpoint,
        sessionPhase: 'plan',
        plugins: resolvedPlugins,
      },
      log,
    );

    await this.mustTransition(job.id, 'building', 'plan_ready');
    await this.mustTransition(job.id, 'plan_ready', 'plan_review');

    const action = await this.holdForPlanReview(job.id, sandboxInfo, log);

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
      const base = plan ? buildExecuteSystemPrompt(plan) : '';
      systemPrompt = `${base}\n\n## Recovery context\n\nThe previous check step failed. Here is the failure output:\n\n${cfg.recoveryContext}\n\nPlease fix the issues and ensure the check passes.`;
    } else if (plan) {
      systemPrompt = buildExecuteSystemPrompt(plan);
    } else {
      // No plan — fall back to generic implementation prompt
      systemPrompt = DEFAULT_AGENT.systemPrompt;
    }

    const { PluginRegistry } = await import('@shared/mcp');
    const registry = new PluginRegistry(this.deps.db);
    const resolvedPlugins = await registry.resolveForConversation(job.conversationId ?? undefined);

    const resolved = await this.resolveStepAgent(step);
    if (resolved) {
      systemPrompt = `${systemPrompt}\n\n${resolved.systemPrompt}`;
    }

    await this.mustTransition(job.id, 'preparing', 'executing');
    await this.callSandboxPrompt(
      job,
      sandboxInfo,
      {
        model: resolved?.model,
        systemPrompt,
        allowedTools: resolved?.allowedTools,
        workingDir: workspace,
        sessionPhase: 'execute',
        plugins: resolvedPlugins,
      },
      log,
    );
    await this.mustTransition(job.id, 'executing', 'preparing');
  }

  private async runCheckStep(
    job: Job,
    step: JobStep,
    sandboxInfo: SandboxInfo,
    _workspace: string,
    log: Logger,
  ): Promise<void> {
    const { db, sandbox } = this.deps;
    const cfg = step.config as { command: string; timeoutSeconds?: number; capture?: string };

    log.info({ command: cfg.command }, 'running check step');

    const result = await fetch(`${sandboxInfo.endpoint}/exec`, {
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
    });

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
    log: Logger,
  ): Promise<PlanWakeEvent | { kind: 'timeout' }> {
    const { db } = this.deps;
    const holdUntil = new Date(Date.now() + PLAN_HOLD_MS);

    await db
      .update(jobs)
      .set({ planReviewHoldUntil: holdUntil, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));

    log.info({ holdUntil }, 'entering hot hold for plan review');

    const result = await Promise.race([
      this.waitForWake(jobId),
      sleep(PLAN_HOLD_MS).then((): { kind: 'timeout' } => ({ kind: 'timeout' })),
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
    const sub = new Redis(this.deps.redisUrl);

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
  private async resolveStepAgent(step: JobStep): Promise<{
    model: string;
    systemPrompt: string;
    allowedTools: string[];
  } | null> {
    const cfg = step.config as {
      agent?: { ref: string; agentId?: string };
      skillId?: string;
    };

    if (!cfg.agent && !cfg.skillId) return null;

    let model = DEFAULT_AGENT.model;
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

    // Load each skill's latest version and merge instructions + tools
    const skillInstructions: string[] = [];
    const skillTools: string[] = [];

    for (const sid of skillIds) {
      const [sv] = await this.deps.db
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.agentId, sid))
        .orderBy(desc(agentVersions.version))
        .limit(1);

      if (sv) {
        const def = sv.definition as { systemPrompt?: string; allowedTools?: string[] };
        if (def.systemPrompt) skillInstructions.push(def.systemPrompt);
        if (def.allowedTools?.length) skillTools.push(...def.allowedTools);
      }
    }

    return {
      model,
      systemPrompt: [basePrompt, ...skillInstructions].filter(Boolean).join('\n\n'),
      allowedTools: [...new Set([...baseTools, ...skillTools])],
    };
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
    },
    log: Logger,
  ): Promise<void> {
    const { db } = this.deps;
    const requestId = randomUUID();

    const response = await fetch(`${sandboxInfo.endpoint}/prompt`, {
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
        env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
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

      // Surface agent-level errors (e.g. "Credit balance is too low") as job failures.
      if (parsed !== null && typeof parsed === 'object') {
        const msg = parsed as Record<string, unknown>;
        if (msg.type === 'error' && typeof msg.error === 'string') {
          throw new Error(`Agent error: ${msg.error}`);
        }
      }

      const seq = await appendTimeline(db, job.id, 'chunk', { chunk: parsed });
      await this.emit(job.id, seq, { kind: 'chunk', raw: parsed });
    }

    log.info({ phase: opts.sessionPhase }, 'sandbox session finished');
  }

  private async mintToken(jobId: string): Promise<string | undefined> {
    if (!this.deps.mcpEndpoint || !this.deps.mcpSecret) return undefined;
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

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6));
        if (dataLines.length === 0) continue;
        yield dataLines.join('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
