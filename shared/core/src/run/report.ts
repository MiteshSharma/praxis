import { randomUUID } from 'node:crypto';
import { type Database, artifacts, jobs } from '@shared/db';
import type { SandboxInfo } from '@shared/sandbox';
import type { Logger } from '@shared/telemetry';
import { eq } from 'drizzle-orm';
import { gatherJobContext } from './job-context';
import { parseSSE } from './sse';
import { appendTimeline } from './transitions';

/**
 * Runs a single-turn report generation pass after a job completes.
 *
 * Produces a structured JSON summary of what the job did (or found, for scout jobs)
 * and stores it in jobs.output + a 'report' artifact. This is separate from the
 * learning pass: learning writes to long-term repo memory; this produces short-term
 * job output for human review and downstream job context.
 *
 * Never throws — errors are logged at warn and the job completes normally.
 */

export interface ReportCost {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const REPORT_AGENT_MODEL = 'claude-sonnet-4-6';

const REPORT_SYSTEM_PROMPT = `You are a job summariser. You will receive context about a
completed Praxis job. Produce a structured JSON report of what happened.

Return ONLY raw JSON — no markdown fences, no explanation before or after.

Required structure:
{
  "jobType": "implement" | "scout" | "verify",
  "noChanges": boolean,
  "objective": "what the job set out to do in one sentence",
  "summary": "1-3 sentence plain-English description of what actually happened",
  "frameworks": ["key frameworks/libraries encountered, e.g. express@4.18 — empty for implement"],
  "patterns": ["architectural patterns observed — empty for implement"],
  "changesMade": ["files created/modified/deleted — empty for scout or noop"],
  "apisChanged": ["external API changes visible to other services — empty if none"],
  "dependenciesDiscovered": ["cross-repo or cross-service dependencies found"],
  "missingPieces": ["gaps relevant to the goal — primarily for scout"],
  "notDone": ["things explicitly not done and why"],
  "openQuestions": ["questions for downstream jobs or the operator"],
  "prUrl": null,
  "prNumber": null,
  "prBranch": null
}

All fields are required. Use empty arrays or null where nothing applies.`;

export async function runReportPass(
  jobId: string,
  sandboxInfo: SandboxInfo,
  workspace: string,
  deps: {
    db: Database;
    log: Logger;
    fetchFn?: typeof fetch;
    providerEnv?: Record<string, string>;
    auxiliaryModel?: string;
  },
): Promise<ReportCost> {
  const { db, log } = deps;
  const zeroCost: ReportCost = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) {
    log.warn({ jobId }, 'report pass: job not found, skipping');
    return zeroCost;
  }

  // Determine jobType from triggerKind
  const jobType = job.triggerKind === 'scout' ? 'scout' : 'implement';

  const jobContext = await gatherJobContext(jobId, db);

  const userPrompt = `Job id: ${job.id.substring(0, 8)}
Title: ${job.title}
Trigger: ${job.triggerKind}
No changes: ${job.noChanges}
Type: ${jobType}

Job context:
${jobContext}`;

  const model = deps.auxiliaryModel ?? REPORT_AGENT_MODEL;
  const env = deps.providerEnv ?? {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
  };

  let callResult: { text: string } & ReportCost;
  try {
    callResult = await callSandboxForText(sandboxInfo, {
      sessionId: `${jobId}:report`,
      jobId,
      title: `Report pass for job ${job.id.substring(0, 8)}`,
      description: userPrompt,
      workingDir: workspace,
      model,
      systemPrompt: REPORT_SYSTEM_PROMPT,
      maxTurns: 1,
      env,
      fetchFn: deps.fetchFn,
    });
  } catch (err) {
    log.warn({ err, jobId }, 'report pass: LLM call failed; skipping');
    return zeroCost;
  }

  const { text, inputTokens, outputTokens, costUsd } = callResult;
  const cost: ReportCost = { inputTokens, outputTokens, costUsd };

  if (!text.trim()) {
    log.warn({ jobId }, 'report pass: empty response; skipping');
    return cost;
  }

  // Extract JSON — handles raw JSON, ```json fences, or JSON embedded in explanation text
  const parsed = extractJson(text);
  if (!parsed) {
    log.warn({ jobId }, 'report pass: response is not valid JSON; skipping');
    return cost;
  }

  try {
    await db.update(jobs).set({ output: parsed }).where(eq(jobs.id, jobId));
    await db.insert(artifacts).values({
      jobId,
      kind: 'report',
      path: null,
      url: null,
      metadata: { reportType: jobType, structured: true, data: parsed },
      createdAt: new Date(),
    });
    const seq = await appendTimeline(db, jobId, 'report-generated', {
      jobType,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    });
    log.info({ jobId, seq, jobType }, 'report generated and stored');
  } catch (err) {
    log.warn({ jobId, err }, 'report pass: failed to persist; skipping');
  }

  return cost;
}

// ── Internal sandbox call (mirrors learning.ts) ────────────────────────────

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
): Promise<{ text: string } & ReportCost> {
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
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  for await (const chunk of parseSSE(response.body)) {
    let parsed: unknown = chunk;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      /* leave as string */
    }

    if (parsed !== null && typeof parsed === 'object') {
      const msg = parsed as Record<string, unknown>;
      if (msg.type === 'error' && typeof msg.error === 'string') {
        throw new Error(`Agent error: ${msg.error}`);
      }
      if (msg.type === 'result') {
        if (msg.subtype === 'success' && typeof msg.result === 'string') {
          text = msg.result;
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          inputTokens = usage?.input_tokens ?? 0;
          outputTokens = usage?.output_tokens ?? 0;
          costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : 0;
        } else if (typeof msg.subtype === 'string' && msg.subtype.startsWith('error')) {
          throw new Error(`Agent ended with error: ${msg.subtype}`);
        }
      }
    }
  }

  return { text, inputTokens, outputTokens, costUsd };
}

function extractJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return null;
}
