/**
 * Public MCP dispatcher — 32 tools across 9 groups.
 *
 * Every tool is a thin wrapper over an existing service method.
 * No business logic lives here. Tool naming follows the canonical convention
 * from phase-10-external-mcp-server.md: <group>_<action>.
 *
 * Groups: sessions(7) jobs(6) plans(5) steps(1) timeline(3) workflows(2) agents(2) memory(4) permissions(2)
 */

import type { AgentsService } from '../../services/agents.service';
import type { JobsService } from '../../services/jobs.service';
import type { MemoriesService } from '../../services/memories.service';
import type { PlansService } from '../../services/plans.service';
import type { SessionsService } from '../../services/sessions.service';
import type { WorkflowsService } from '../../services/workflows.service';

export interface PublicMcpDeps {
  jobsService: JobsService;
  plansService: PlansService;
  workflowsService: WorkflowsService;
  agentsService: AgentsService;
  sessionsService: SessionsService;
  memoriesService: MemoriesService;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

// ── Tool manifest ──────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  // ── Sessions ────────────────────────────────────────────────────────────────
  {
    name: 'sessions_list',
    description: 'List all Praxis sessions. A session is a project workspace that groups related jobs for a repo.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 50)' } } },
  },
  {
    name: 'sessions_get',
    description: 'Get a single session — title, default GitHub URL, default workflow, model override.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  },
  {
    name: 'sessions_create',
    description: 'Create a new session (project workspace).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        githubUrl: { type: 'string', description: 'Default GitHub repo URL for jobs in this session' },
        workflowId: { type: 'string', description: 'Default workflow UUID' },
        model: { type: 'string', description: 'Default model override, e.g. claude-opus-4-6' },
      },
      required: ['title'],
    },
  },
  {
    name: 'sessions_update',
    description: 'Update session settings.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        title: { type: 'string' },
        githubUrl: { type: 'string', nullable: true },
        workflowId: { type: 'string', nullable: true },
        model: { type: 'string', nullable: true },
        planHoldHours: { type: 'number', description: 'How long to hold plan_review before auto-expiry (1–168h)' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'sessions_delete',
    description: 'Delete a session. Fails if the session has active (non-terminal) jobs.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  },
  {
    name: 'sessions_history',
    description: 'Read paginated message log for a session — shows submitted tasks and assistant responses.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        limit: { type: 'number', description: 'Max messages (default 20)' },
        before: { type: 'string', description: 'ISO datetime cursor for pagination' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'sessions_send',
    description: 'Submit a task to a session as a chat message. Creates a job and returns its ID immediately. The job will plan, wait for approval, then execute.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        message: { type: 'string', description: 'Natural language task description' },
        githubUrl: { type: 'string', description: 'Override session default GitHub URL' },
        workflowId: { type: 'string', description: 'Override session default workflow' },
        autoApprove: { type: 'boolean', description: 'Skip plan review and execute immediately (default false)' },
      },
      required: ['sessionId', 'message'],
    },
  },

  // ── Jobs ────────────────────────────────────────────────────────────────────
  {
    name: 'jobs_list',
    description: 'List jobs, optionally filtered by session or status.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        status: { type: 'string', description: 'Filter by job status, e.g. plan_review, executing, completed' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'jobs_get',
    description: 'Get full job details — status, model, cost, PR link, current step, error.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'jobs_create',
    description: 'Submit a job directly (without a chat message). Returns the full job object.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        task: { type: 'string', description: 'What to build or fix' },
        githubUrl: { type: 'string', description: 'Override session default GitHub URL' },
        workflowId: { type: 'string' },
        autoApprove: { type: 'boolean', description: 'Skip plan review (default false)' },
      },
      required: ['sessionId', 'task'],
    },
  },
  {
    name: 'jobs_cancel',
    description: 'Cancel a running job. Sends an abort signal to the active sandbox.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'jobs_restart',
    description: 'Restart a failed or completed job with the same inputs. Creates a new job.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'jobs_resume_from_plan',
    description: 'Resume a failed job from its last approved plan checkpoint, skipping the planning phase.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },

  // ── Plans ───────────────────────────────────────────────────────────────────
  {
    name: 'jobs_plan_get',
    description: 'Get the current plan for a job — title, summary, steps, affected paths, risks, open questions. Read this before approving.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'jobs_plan_list',
    description: 'List all plan versions for a job, including original and all revisions.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'jobs_plan_approve',
    description: 'Approve the current plan. Triggers code execution immediately.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'jobs_plan_revise',
    description: 'Request a plan revision. The agent will revise and return a new plan for review.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        feedback: { type: 'string', description: 'What to change' },
        answers: { type: 'object', description: 'Answers to open questions, keyed by question ID' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'jobs_plan_reject',
    description: 'Reject the plan. The job is marked plan_rejected and no code will run.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['jobId'],
    },
  },

  // ── Steps ───────────────────────────────────────────────────────────────────
  {
    name: 'steps_list',
    description: 'List all steps for a job — kind (plan/execute/check), status, duration, cost, model used.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },

  // ── Timeline ─────────────────────────────────────────────────────────────────
  {
    name: 'timeline_get',
    description: 'Read the job timeline — agent turns, tool calls, status transitions, prompt snapshots. Supports cursor-based pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        limit: { type: 'number', description: 'Max events (default 200)' },
        cursor: { type: 'number', description: 'Sequence number to start after (for pagination)' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'timeline_poll',
    description: 'Non-blocking poll for new timeline events since a sequence number. Returns immediately — empty array if no new events.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        cursor: { type: 'number', description: 'Last seen sequence number' },
        limit: { type: 'number', description: 'Max new events to return (default 50)' },
      },
      required: ['jobId', 'cursor'],
    },
  },
  {
    name: 'timeline_wait',
    description: 'Long-poll for the next timeline event. Blocks until a new event arrives after the cursor or the timeout elapses. Use this to watch job progress without hammering the server.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        cursor: { type: 'number', description: 'Last seen sequence number' },
        timeoutSeconds: { type: 'number', description: 'How long to wait (default 30, max 60)' },
      },
      required: ['jobId', 'cursor'],
    },
  },

  // ── Workflows ────────────────────────────────────────────────────────────────
  {
    name: 'workflows_list',
    description: 'List all available workflows with their step summary.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'workflows_get',
    description: 'Get full workflow definition — steps, agent/skill assignments, models per step.',
    inputSchema: { type: 'object', properties: { workflowId: { type: 'string' } }, required: ['workflowId'] },
  },

  // ── Agents & Skills ──────────────────────────────────────────────────────────
  {
    name: 'agents_list',
    description: 'List agents or skills. Agents have custom system prompts and tool configs. Skills are composable modules agents can depend on.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['agent', 'skill'], description: 'Filter by kind (default: both)' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'agents_get',
    description: 'Get a single agent or skill — system prompt, model, allowed tools, dependsOn skills.',
    inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
  },

  // ── Memory ───────────────────────────────────────────────────────────────────
  {
    name: 'memory_list',
    description: 'List all repos that have persistent memory, with entry counts and byte sizes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_get',
    description: 'Read the full MEMORY.md for a repo. This is the institutional context injected into every plan prompt.',
    inputSchema: {
      type: 'object',
      properties: { repoKey: { type: 'string', description: 'e.g. "github.com/owner/repo"' } },
      required: ['repoKey'],
    },
  },
  {
    name: 'memory_update',
    description: 'Write or overwrite repo memory. The content must be valid MEMORY.md format.',
    inputSchema: {
      type: 'object',
      properties: {
        repoKey: { type: 'string' },
        content: { type: 'string', description: 'Full MEMORY.md content' },
      },
      required: ['repoKey', 'content'],
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete all memory for a repo.',
    inputSchema: { type: 'object', properties: { repoKey: { type: 'string' } }, required: ['repoKey'] },
  },

  // ── Permissions ──────────────────────────────────────────────────────────────
  {
    name: 'permissions_list_open',
    description: 'List all jobs currently waiting for plan approval across all sessions.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string', description: 'Filter by session (optional)' } } },
  },
  {
    name: 'permissions_respond',
    description: 'Single-call plan approval. Wraps jobs_plan_approve / jobs_plan_revise / jobs_plan_reject. Use this when you want to respond without knowing which specific tool to call.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        action: { type: 'string', enum: ['approve', 'revise', 'reject'] },
        feedback: { type: 'string', description: 'Required when action=revise' },
        answers: { type: 'object', description: 'Open question answers when action=revise' },
        reason: { type: 'string', description: 'Reason when action=reject' },
      },
      required: ['jobId', 'action'],
    },
  },
] as const;

// ── Dispatcher ─────────────────────────────────────────────────────────────────

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function rpcErr(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function handleMcpRequest(
  body: unknown,
  deps: PublicMcpDeps,
): Promise<JsonRpcResponse> {
  if (!body || typeof body !== 'object') {
    return rpcErr(null, -32700, 'Parse error');
  }

  const req = body as JsonRpcRequest;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return rpcErr(req.id ?? null, -32600, 'Invalid request');
  }

  const { id, method, params = {} } = req;

  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'praxis', version: '1.0.0' },
        });

      case 'notifications/initialized':
        return ok(id, null);

      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, { tools: TOOL_DEFINITIONS });

      case 'tools/call':
        return callTool(id, params as { name?: string; arguments?: Record<string, unknown> }, deps);

      default:
        return rpcErr(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return rpcErr(id, -32603, e instanceof Error ? e.message : String(e));
  }
}

async function callTool(
  id: string | number | null,
  params: { name?: string; arguments?: Record<string, unknown> },
  deps: PublicMcpDeps,
): Promise<JsonRpcResponse> {
  const { name, arguments: a = {} } = params;
  if (!name) return rpcErr(id, -32602, 'tools/call requires params.name');

  const { jobsService, plansService, workflowsService, agentsService, sessionsService, memoriesService } = deps;

  try {
    let result: unknown;

    switch (name) {
      // ── Sessions ────────────────────────────────────────────────────────────
      case 'sessions_list':
        result = await sessionsService.list(num(a.limit, 50));
        break;
      case 'sessions_get':
        result = await sessionsService.getById(str(a.sessionId));
        break;
      case 'sessions_create':
        result = await sessionsService.create({
          title: str(a.title),
          githubUrl: a.githubUrl ? str(a.githubUrl) : undefined,
          workflowId: a.workflowId ? str(a.workflowId) : undefined,
          model: a.model ? str(a.model) : undefined,
        });
        break;
      case 'sessions_update':
        result = await sessionsService.update(str(a.sessionId), {
          title: a.title ? str(a.title) : undefined,
          githubUrl: a.githubUrl !== undefined ? (a.githubUrl === null ? null : str(a.githubUrl)) : undefined,
          workflowId: a.workflowId !== undefined ? (a.workflowId === null ? null : str(a.workflowId)) : undefined,
          model: a.model !== undefined ? (a.model === null ? null : str(a.model)) : undefined,
          planHoldHours: a.planHoldHours ? num(a.planHoldHours) : undefined,
        });
        break;
      case 'sessions_delete':
        await sessionsService.delete(str(a.sessionId));
        result = { ok: true };
        break;
      case 'sessions_history':
        result = await sessionsService.history(
          str(a.sessionId),
          num(a.limit, 20),
          a.before ? str(a.before) : undefined,
        );
        break;
      case 'sessions_send':
        result = await sessionsService.send({
          sessionId: str(a.sessionId),
          message: str(a.message),
          githubUrl: a.githubUrl ? str(a.githubUrl) : undefined,
          workflowId: a.workflowId ? str(a.workflowId) : undefined,
          autoApprove: a.autoApprove === true,
        });
        break;

      // ── Jobs ─────────────────────────────────────────────────────────────────
      case 'jobs_list':
        result = await jobsService.list(num(a.limit, 20), {
          sessionId: a.sessionId ? str(a.sessionId) : undefined,
          status: a.status as never,
        });
        break;
      case 'jobs_get':
        result = await jobsService.getById(str(a.jobId));
        break;
      case 'jobs_create':
        result = await jobsService.create({
          sessionId: str(a.sessionId),
          task: str(a.task),
          githubUrl: a.githubUrl ? str(a.githubUrl) : undefined,
          workflowId: a.workflowId ? str(a.workflowId) : undefined,
          autoApprove: a.autoApprove === true,
        });
        break;
      case 'jobs_cancel':
        await jobsService.cancel(str(a.jobId));
        result = { ok: true };
        break;
      case 'jobs_restart':
        result = await jobsService.restart(str(a.jobId));
        break;
      case 'jobs_resume_from_plan':
        result = await jobsService.resumeFromPlan(str(a.jobId));
        break;

      // ── Plans ─────────────────────────────────────────────────────────────────
      case 'jobs_plan_get':
        result = await plansService.getLatestPlan(str(a.jobId));
        break;
      case 'jobs_plan_list':
        result = await plansService.listPlans(str(a.jobId));
        break;
      case 'jobs_plan_approve':
        await plansService.approvePlan(str(a.jobId));
        result = { ok: true };
        break;
      case 'jobs_plan_revise':
        await plansService.revisePlan(
          str(a.jobId),
          a.answers as Record<string, string> | undefined,
          a.feedback ? str(a.feedback) : undefined,
        );
        result = { ok: true };
        break;
      case 'jobs_plan_reject':
        await plansService.rejectPlan(str(a.jobId), a.reason ? str(a.reason) : undefined);
        result = { ok: true };
        break;

      // ── Steps ─────────────────────────────────────────────────────────────────
      case 'steps_list':
        result = await jobsService.listSteps(str(a.jobId));
        break;

      // ── Timeline ─────────────────────────────────────────────────────────────
      case 'timeline_get':
        result = await jobsService.getTimeline(
          str(a.jobId),
          num(a.limit, 200),
          a.cursor !== undefined ? num(a.cursor) : undefined,
        );
        break;
      case 'timeline_poll':
        result = await jobsService.getTimeline(
          str(a.jobId),
          num(a.limit, 50),
          num(a.cursor),
        );
        break;
      case 'timeline_wait':
        result = await timelineWait(
          str(a.jobId),
          num(a.cursor),
          Math.min(num(a.timeoutSeconds, 30), 60),
          jobsService,
        );
        break;

      // ── Workflows ─────────────────────────────────────────────────────────────
      case 'workflows_list':
        result = await workflowsService.list(num(a.limit, 50));
        break;
      case 'workflows_get':
        result = await workflowsService.getById(str(a.workflowId));
        break;

      // ── Agents & Skills ───────────────────────────────────────────────────────
      case 'agents_list':
        result = await agentsService.list(
          num(a.limit, 50),
          a.kind as 'agent' | 'skill' | undefined,
        );
        break;
      case 'agents_get':
        result = await agentsService.getById(str(a.agentId));
        break;

      // ── Memory ────────────────────────────────────────────────────────────────
      case 'memory_list':
        result = await memoriesService.listRepos();
        break;
      case 'memory_get':
        result = await memoriesService.get(str(a.repoKey));
        break;
      case 'memory_update':
        result = await memoriesService.update(str(a.repoKey), str(a.content));
        break;
      case 'memory_delete':
        await memoriesService.delete(str(a.repoKey));
        result = { ok: true };
        break;

      // ── Permissions ───────────────────────────────────────────────────────────
      case 'permissions_list_open':
        result = await jobsService.list(50, {
          sessionId: a.sessionId ? str(a.sessionId) : undefined,
          status: 'plan_review',
        });
        break;
      case 'permissions_respond': {
        const action = str(a.action);
        if (action === 'approve') {
          await plansService.approvePlan(str(a.jobId));
        } else if (action === 'revise') {
          await plansService.revisePlan(
            str(a.jobId),
            a.answers as Record<string, string> | undefined,
            a.feedback ? str(a.feedback) : undefined,
          );
        } else if (action === 'reject') {
          await plansService.rejectPlan(str(a.jobId), a.reason ? str(a.reason) : undefined);
        } else {
          return rpcErr(id, -32602, `Invalid action: ${action}. Must be approve | revise | reject`);
        }
        result = { ok: true };
        break;
      }

      default:
        return rpcErr(id, -32601, `Unknown tool: ${name}`);
    }

    return ok(id, {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    });
  } catch (e) {
    // Surface as a tool-level error (isError: true) rather than a JSON-RPC
    // protocol error so MCP clients display it as a tool result.
    const message = e instanceof Error ? e.message : String(e);
    return ok(id, {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    });
  }
}

// ── timeline_wait — the 32nd tool ─────────────────────────────────────────────

/**
 * Polls for new timeline events every 500ms until either:
 * - at least one new event arrives after `cursor`, or
 * - `timeoutSeconds` elapses
 *
 * Returns the same shape as getTimeline. No Redis or WebSocket needed.
 */
async function timelineWait(
  jobId: string,
  cursor: number,
  timeoutSeconds: number,
  jobsService: JobsService,
): Promise<unknown> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const POLL_INTERVAL_MS = 500;

  while (Date.now() < deadline) {
    const result = await jobsService.getTimeline(jobId, 50, cursor);
    if (result.events.length > 0) return result;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
  }

  // Timed out — return empty result with the same cursor so caller knows where to resume
  return { events: [], hasMore: false, nextCursor: undefined };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Coercion helpers ───────────────────────────────────────────────────────────

function str(v: unknown, fallback?: string): string {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw new Error('missing required string parameter');
  }
  return String(v);
}

function num(v: unknown, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return n;
}
