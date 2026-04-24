import { randomUUID } from 'node:crypto';
import type { Database } from '@shared/db';
import type { SandboxInfo } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import { gatherJobContext } from './job-context';
import { parseSSE } from './sse';

/**
 * Context compression for long-running execute steps.
 *
 * When an execute step hits the model's context window limit, the step runner
 * calls buildResumeContext() to produce a compact summary of completed work.
 * That summary is appended to the execute system prompt and the step retries
 * from where it left off — without re-doing already-completed work.
 *
 * Uses the auxiliary model (haiku / flash) — this is a cheap summarisation
 * call, not a full coding pass.
 */

const COMPRESS_SYSTEM_PROMPT = `You are summarising the completed portion of an interrupted coding session.
Return ONLY raw JSON — no markdown fences, no prose before or after.

Required structure:
{
  "completedWork": ["list of things actually finished — be specific, include file names"],
  "changedFiles": ["files created or modified so far"],
  "remainingWork": "what still needs to be done to finish the original goal",
  "criticalState": "any state the agent must know to continue correctly (env, branch, blockers)"
}`;

/** Detect context-overflow errors from either the Claude SDK or OpenAI provider. */
export function isContextOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('max_tokens') ||
    msg.includes('error_max_tokens') ||
    msg.includes('context_length_exceeded') ||
    msg.includes('maximum context length') ||
    msg.includes('context window')
  );
}

/**
 * Calls the auxiliary model to summarise completed work, then returns a string
 * to append to the execute system prompt on resume.
 *
 * Never throws — on failure returns a minimal placeholder so the retry still
 * has some guidance.
 */
export async function buildResumeContext(
  jobId: string,
  sandboxInfo: SandboxInfo,
  workspace: string,
  deps: {
    db: Database;
    log: Logger;
    auxiliaryModel: string;
    providerEnv: Record<string, string>;
    fetchFn?: typeof fetch;
  },
): Promise<string> {
  const { db, log, auxiliaryModel, providerEnv } = deps;

  let summary = '';
  try {
    const jobContext = await gatherJobContext(jobId, db);
    const userPrompt = `Job context (what happened before context limit was hit):\n\n${jobContext}`;

    const result = await callSandboxForText(sandboxInfo, {
      sessionId: `${jobId}:compress`,
      jobId,
      title: `Compression pass for job ${jobId.substring(0, 8)}`,
      description: userPrompt,
      workingDir: workspace,
      model: auxiliaryModel,
      systemPrompt: COMPRESS_SYSTEM_PROMPT,
      maxTurns: 1,
      env: providerEnv,
      fetchFn: deps.fetchFn,
    });

    summary = result.text.trim();
    log.info({ jobId, model: auxiliaryModel }, 'context compression summary generated');
  } catch (err) {
    log.warn({ jobId, err }, 'context compression failed — using minimal placeholder');
    summary = JSON.stringify({
      completedWork: [],
      changedFiles: [],
      remainingWork: 'Continue the original goal',
      criticalState: 'Context was truncated — check git diff for what was already done',
    });
  }

  return `\n\n---\n## Resume context (previous session hit context window limit)\n\nThe execute step was interrupted when the context window filled. The following summarises what was completed before the interruption. Do NOT redo already-completed work. Continue from where execution stopped.\n\n${summary}`;
}

// ── Minimal sandbox call (mirrors learning.ts / report.ts) ────────────────────

async function callSandboxForText(
  sandboxInfo: SandboxInfo,
  body: {
    sessionId: string;
    jobId: string;
    title: string;
    description: string;
    workingDir: string;
    model: string;
    systemPrompt: string;
    maxTurns: number;
    env: Record<string, string>;
    fetchFn?: typeof fetch;
  },
): Promise<{ text: string }> {
  const { fetchFn, ...rest } = body;
  const requestId = randomUUID();
  const response = await (fetchFn ?? fetch)(`${sandboxInfo.endpoint}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(rest),
  });

  if (!response.ok || !response.body) {
    throw new Error(`sandbox /prompt failed: ${response.status}`);
  }

  let text = '';
  for await (const chunk of parseSSE(response.body)) {
    let parsed: unknown = chunk;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      /* leave as string */
    }
    if (parsed !== null && typeof parsed === 'object') {
      const msg = parsed as Record<string, unknown>;
      if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string') {
        text = msg.result;
      }
    }
  }

  return { text };
}
