# Praxis — AI Agent Codebase Guide

## What this is

Praxis orchestrates multi-step AI coding jobs against GitHub repos: plan → user review → execute → check → publish PR. Two services coordinate: `backend` (control-plane + pg-boss worker) and `sandbox-worker` (runs inside an ephemeral workspace, calls Claude).

---

## Tech stack (exact versions)

| | |
|---|---|
| Runtime | Node ≥ 24, TypeScript 5.6 strict |
| HTTP | Hono 4.6 |
| RPC | oRPC 1.9 (contract → handler → client) |
| DB | Drizzle ORM 0.36 + Postgres |
| Queue | pg-boss 10 |
| AI | @anthropic-ai/claude-agent-sdk |
| Frontend | React 18, AntD 5, TanStack Query 5, React Router 6 |
| Lint/format | Biome 1.9 |
| Tests | Vitest 2.1 (installed, **no config yet**) |

---

## Directory map

```
services/
  backend/src/
    index.ts              boots as control-plane, worker, or both (MODE env)
    control-plane.ts      Hono app — mounts RPC, SSE, health, MCP routes
    worker.ts             pg-boss consumer — runs jobs, recovery cron
    routes/
      rpc.ts              ALL oRPC handlers wired here (see pattern below)
      sse.ts              GET /sse/jobs/:id — streams timeline events
      health.ts           /health, /ready
    services/             business logic — one file per domain
      jobs.service.ts
      plans.service.ts    approve / revise / reject
      workflows.service.ts
      agents.service.ts
      conversations.service.ts
      plugins.service.ts
    repositories/         DB queries — one file per table group
    queues/               pg-boss consumers (job-execute, recover-stuck)
    control-plane/mcp/
      submit-plan.ts      POST /mcp/submit_plan — receives plan from sandbox agent
    middleware/           error-handler, cors, validate
    lib/env.ts            typed env config

  sandbox-worker/src/
    index.ts              boots tiny Hono server inside the sandbox
    routes/
      prompt.ts           POST /prompt — runs Claude agent, streams SSE chunks
      exec.ts             POST /exec — runs shell command, returns {exitCode, stdout, stderr}
      publish.ts          POST /publish — commit + push + open PR
      abort.ts            POST /abort/:sessionId
    services/
      agent.service.ts    calls claude-agent-sdk; wires in-process MCP tools
      exec.service.ts
      publish.service.ts  git commit/push + Octokit PR creation

  web/src/
    pages/JobView.tsx      job detail + live timeline
    pages/ConversationDetail.tsx
    components/
      PlanReviewCard.tsx  approve / revise / reject UI
      StepProgress.tsx    step status bar
    rpc.ts                oRPC client (mirrors contract)

shared/
  contracts/src/
    router.ts             oRPC contract — source of truth for all API shapes
    schemas.ts            Zod DTOs (JobSchema, PlanSchema, AgentSchema …)
    events.ts             JOB_STATUSES, JOB_TRANSITIONS, NotifyEvent types

  core/src/
    run/
      job-orchestrator.ts  full job lifecycle (provision → clone → steps → publish)
      step-runner.ts       dispatches plan / execute / check steps
      transitions.ts       transitionJob() — CAS update + timeline append
      recovery.ts          recoverStuckJobs() cron helper
    ingress/task-ingest-service.ts  create job row + enqueue
    task-tracker/db-task-tracker.ts createPlan, approvePlan, recordRevisionRequest …
    prompts/
      plan-session.ts     buildPlanSessionSystemPrompt(parentContext, workingDir)
      execute-session.ts  buildExecuteSystemPrompt(plan, workingDir)
      revision-session.ts buildRevisionSystemPrompt(…)
    mcp/auth.ts           mintMcpToken / verifyMcpToken (HS256 JWT, 30 min TTL)
    egress/notify.ts      emitNotification → pg-boss → SSE fan-out
    defaults/
      default-agent.ts    { model, systemPrompt, allowedTools: [Read,Glob,Grep,Bash,Edit,Write] }
      default-workflow.ts [ plan step, execute step ]

  db/src/
    schema/
      jobs.ts             jobs table
      plans.ts            plans table (version, status, data JSON)
      job-steps.ts        job_steps (stepIndex, kind, config, status, output)
      job-timeline.ts     job_timeline (jobId, seq, type, payload) — immutable log
      agents.ts           agents + agent_versions + agent_skills
      workflows.ts        workflows + workflow_versions
      conversations.ts    conversations + messages
      plugins.ts          plugins (MCP stdio/http per conversation)
      artifacts.ts        artifacts (pr, diff …)
      sandboxes.ts        sandboxes (lifecycle tracking)
    client.ts             drizzle client factory
    index.ts              re-exports all tables + types

  workflows/src/types.ts  WorkflowDefinition, AgentDefinition, WorkflowStepDef (plan|execute|check)
  mcp/src/               PluginRegistry — resolves external MCP servers for a conversation
  sandbox/src/           LocalSandboxProvider interface + types
  telemetry/src/         pino logger, OTEL, request-id middleware
  stream/src/            SSE parsing helpers
```

Path alias: `@shared/<name>` → `./shared/<name>/src`

---

## Job state machine

```
queued → provisioning → preparing → building → plan_ready → plan_review
                                                                ├─ plan_revising → plan_ready (loop)
                                                                ├─ plan_rejected (terminal)
                                                                └─ preparing → executing → checking → learning → publishing → completed
```

All valid transitions are listed in `shared/contracts/src/events.ts` → `JOB_TRANSITIONS`.  
**Adding a new status = update that map + add to `JOB_STATUSES` array.**

---

## Step runner dispatch

`shared/core/src/run/step-runner.ts` — `StepRunner.run()` iterates `job_steps` rows and calls:

| step kind | method | what it does |
|---|---|---|
| `plan` | `runPlanStep` | POST /prompt with plan system prompt → hold on Redis for user review |
| `execute` | `runExecuteStep` | POST /prompt with execute system prompt → agent edits files |
| `check` | `runCheckStep` | POST /exec with shell command → throw `CheckFailedError` on nonzero |

Between steps the job transitions through `preparing`. After all steps: `preparing → publishing → completed`.

---

## Adding a new oRPC endpoint (complete pattern)

```
1. shared/contracts/src/router.ts      — add to contract object
2. shared/contracts/src/schemas.ts     — add Zod DTO if needed
3. services/backend/src/routes/rpc.ts — add handler + wire into router
4. services/backend/src/services/     — add service method
5. services/backend/src/repositories/ — add DB query if needed
```

Example handler wire-up in `rpc.ts`:
```ts
const jobsMyAction = os.jobs.myAction.handler(({ input }) =>
  deps.jobsService.myAction(input.jobId),
);
// ... add to the router object at the bottom
```

---

## Adding an internal MCP tool (control-plane)

1. In `services/sandbox-worker/src/services/agent.service.ts`, create a `tool(name, description, schema, handler)` and add it to `internalTools[]`.  
   Tool name → auto-whitelisted as `mcp__praxis-control-plane__<name>`.
2. Add the HTTP handler in `services/backend/src/control-plane/mcp/` and register it in `registerMcpRoutes`.

---

## HTTP conventions

- All handlers use **Hono** (`c.json()`, `c.text()`, `streamSSE()`).
- **No custom `res` abstraction exists.** Use `c.json(data)` / `c.json(data, status)`.
- Validation middleware: `validateBody(Schema)` in `middleware/validate.ts`.

---

## Database patterns

```ts
// read
const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });

// transition (CAS — returns row or null if wrong status)
const result = await transitionJob(db, jobId, 'preparing', 'executing');

// append timeline event
const seq = await appendTimeline(db, jobId, 'my-event', { ...payload });

// emit to SSE clients
await emitNotification(boss, jobId, seq, { kind: 'chunk', raw: data });
```

---

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `REDIS_URL` | Redis (pg-boss + plan-event pub/sub) |
| `ANTHROPIC_API_KEY` | Claude API key (forwarded to sandbox-worker) |
| `GITHUB_TOKEN` | Clone repos + open PRs |
| `MCP_SHARED_SECRET` | Signs MCP JWTs — must be ≥ 32 chars |
| `CONTROL_PLANE_MCP_URL` | URL sandbox calls for MCP, e.g. `http://localhost:3000/mcp` |
| `MODE` | `control-plane` \| `worker` \| `all` |

---

## Key conventions & pitfalls

- **MCP JWT TTL** is 30 min (`shared/core/src/mcp/auth.ts`). Plan sessions can run long — don't reduce this.
- **`bypassPermissions`** covers built-in Claude Code tools. In-process MCP tools must also be in `allowedTools` — handled automatically via the `internalTools` array in `agent.service.ts`.
- **State transitions** must exist in `JOB_TRANSITIONS` before calling `transitionJob`/`assertTransition` — it throws otherwise.
- **Branch created at clone time** (`praxis/job-<8-char-id>`) by `JobOrchestrator.cloneRepo`. The execute agent writes to this branch; `/publish` just commits + pushes it — never runs `git checkout -b`.
- **SSE error propagation**: if `agent.service.ts` throws, the sandbox-worker emits `{ type: 'error', error: '...' }` into the stream. `callSandboxPrompt` in step-runner detects this and re-throws, which `failJob` catches and transitions to `failed`.
- **Adding a shared utility**: place in `shared/<existing-package>/src/`, re-export from its `index.ts`. Only create a new package for genuinely independent concerns.
- **Tests**: `vitest` is installed but no `vitest.config.ts` exists yet. Create one at repo root and place test files as `*.test.ts` beside source files.
- **Lint/format**: `npm run lint` (Biome check), `npm run format` (Biome write).
