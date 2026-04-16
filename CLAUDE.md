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

## File tree

Read this before exploring — it covers every source file in the repo.

```
CLAUDE.md                                ← you are here
tsconfig.json / tsconfig.base.json
biome.json
package.json

services/
  backend/src/
    index.ts                             boots as control-plane, worker, or both (MODE env)
    control-plane.ts                     Hono app — mounts RPC, SSE, health, MCP routes
    worker.ts                            pg-boss consumer — runs jobs, recovery cron
    lib/env.ts                           typed env config
    routes/
      index.ts                           composes all routes
      rpc.ts                             ALL oRPC handlers wired here
      sse.ts                             GET /sse/jobs/:id — streams timeline events
      health.ts                          /health, /ready
    services/
      jobs.service.ts
      plans.service.ts                   approve / revise / reject
      workflows.service.ts
      agents.service.ts
      conversations.service.ts
      plugins.service.ts
      memories.service.ts                listRepos, get, update, delete repo memory files
      notifier.service.ts
    repositories/
      jobs.repository.ts
      plans.repository.ts
      workflows.repository.ts
      agents.repository.ts
      conversations.repository.ts
      plugins.repository.ts
    queues/
      index.ts
      job-execute.ts                     consumer — runs JobOrchestrator
      notify-dispatch.ts                 consumer — fans out SSE events
      recover-stuck.ts                   cron — detects hung jobs
    control-plane/mcp/
      submit-plan.ts                     POST /mcp/submit_plan
    middleware/
      cors.ts
      error-handler.ts
      validate.ts
      request-context.ts
    dto/
      jobs.dto.ts
      health.dto.ts
      sse.dto.ts

  sandbox-worker/src/
    index.ts                             tiny Hono server inside the sandbox
    lib/env.ts
    routes/
      index.ts
      prompt.ts                          POST /prompt — runs Claude agent, streams SSE
      exec.ts                            POST /exec — runs shell command
      publish.ts                         POST /publish — commit + push + open PR
      abort.ts                           POST /abort/:sessionId
      health.ts
    services/
      agent.service.ts                   calls claude-agent-sdk; wires in-process MCP tools
      exec.service.ts
      publish.service.ts                 git commit/push + Octokit PR creation
    middleware/
      error-handler.ts
      validate.ts
      request-context.ts
    dto/
      agent.dto.ts
      exec.dto.ts
      publish.dto.ts
      abort.dto.ts

  web/src/
    App.tsx                              router setup
    main.tsx
    rpc.ts                               oRPC client
    pages/
      JobView.tsx                        job detail + live timeline
      ConversationDetail.tsx
      ConversationList.tsx
      CreateJob.tsx
      AgentBrowse.tsx
      WorkflowBrowse.tsx
      MemoryList.tsx                     /memories — list of repos with memory
      MemoryEditor.tsx                   /memories/* — view/edit a repo's MEMORY.md
    components/
      PlanReviewCard.tsx                 approve / revise / reject UI
      StepProgress.tsx                   step status bar
      PluginsPanel.tsx

shared/
  contracts/src/
    router.ts                            oRPC contract — source of truth for all API shapes
    schemas.ts                           Zod DTOs (JobSchema, PlanSchema, AgentSchema …)
    events.ts                            JOB_STATUSES, JOB_TRANSITIONS, NotifyEvent types
    index.ts

  core/src/
    index.ts
    run/
      index.ts
      job-orchestrator.ts               full job lifecycle (provision → clone → steps → learn → publish)
      step-runner.ts                    dispatches plan / execute / check steps; accepts memoryMarkdown
      transitions.ts                    transitionJob() — CAS update + timeline append
      recovery.ts                       recoverStuckJobs() cron helper
      learning.ts                       runLearningPass() — single-turn memory update after all steps
      job-context.ts                    gatherJobContext() — assembles job+plan+steps text for learning
    ingress/
      index.ts
      task-ingest-service.ts            create job row + enqueue
      task-source.ts
      sources/web-task-source.ts
    task-tracker/
      index.ts
      task-tracker.ts                   interface
      db-task-tracker.ts                createPlan, approvePlan, recordRevisionRequest …
    prompts/
      index.ts
      plan-session.ts                   buildPlanSessionSystemPrompt(parentContext, workingDir) + buildMemorySection()
      execute-session.ts                buildExecuteSystemPrompt(plan, workingDir)
      revision-session.ts               buildRevisionSystemPrompt(ctx, workingDir)
    mcp/
      index.ts
      auth.ts                           mintMcpToken / verifyMcpToken (HS256 JWT, 30 min TTL)
    egress/
      index.ts
      notify.ts                         emitNotification → pg-boss → SSE fan-out
      notifier-registry.ts
      task-notifier.ts
    defaults/
      index.ts
      default-agent.ts                  { model, systemPrompt, allowedTools }
      default-workflow.ts               [ plan step, execute step ]
      learning-agent.ts                 LEARNING_AGENT — single-turn memory updater, no tools
    http/
      res.ts                            res.json() helper
      res.test.ts

  db/src/
    index.ts                            re-exports all tables + types
    client.ts                           drizzle client factory
    migrate.ts
    schema/
      index.ts
      jobs.ts
      plans.ts                          (version, status, data JSON)
      job-steps.ts                      (stepIndex, kind, config, status, output)
      job-timeline.ts                   immutable event log
      agents.ts                         agents + agent_versions + agent_skills
      workflows.ts                      workflows + workflow_versions
      conversations.ts                  conversations + messages
      plugins.ts                        MCP stdio/http plugins per conversation
      artifacts.ts
      sandboxes.ts
      repo-memories.ts                  one row per repo — repoKey, contentUri, sizeBytes, entryCount
    drizzle/
      0001_init.sql
      0002_add_plans.sql
      0003_add_workflows.sql
      0004_add_conversations_plugins.sql
      0005_add_skills.sql
      0006_add_repo_memories.sql

  workflows/src/
    index.ts
    types.ts                            WorkflowDefinition, AgentDefinition, WorkflowStepDef
    parser.ts
    loader.ts

  mcp/src/
    index.ts
    registry.ts                         PluginRegistry — resolves MCP servers for a conversation

  memory/src/
    index.ts
    repo-key.ts                           normalizeRepoKey() — collapses HTTPS/SSH/.git variants
    validator.ts                          validateMemoryFormat() + SECTION_ENTRY_LIMIT/PRUNE_THRESHOLD
    memory-file.ts                        loadMemoryFile, saveMemoryFile, EMPTY_MEMORY_TEMPLATE

  storage/src/
    index.ts                              S3-compatible storage singleton via @aws-sdk/client-s3

  sandbox/src/
    index.ts
    types.ts
    local-sandbox-provider.ts

  telemetry/src/
    index.ts
    logger.ts                           pino
    otel.ts
    request-id.ts
    shutdown.ts

  stream/src/
    index.ts
    job-stream.ts                       SSE parsing helpers
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

Between steps the job transitions through `preparing`. After all steps: `preparing → learning → publishing → completed` (learning is skipped when `jobs.disable_learning = true`, in which case `preparing → publishing`).

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
| `STORAGE_ENDPOINT` | MinIO/S3 endpoint, e.g. `http://localhost:9000` (optional in dev) |
| `STORAGE_BUCKET` | Bucket name, default `praxis` |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | MinIO credentials |
| `STORAGE_REGION` | Region, default `us-east-1` |

---

## Key conventions & pitfalls

- **MCP JWT TTL** is 30 min (`shared/core/src/mcp/auth.ts`). Plan sessions can run long — don't reduce this.
- **`bypassPermissions`** covers built-in Claude Code tools. In-process MCP tools must also be in `allowedTools` — handled automatically via the `internalTools` array in `agent.service.ts`.
- **State transitions** must exist in `JOB_TRANSITIONS` before calling `transitionJob`/`assertTransition` — it throws otherwise.
- **Branch created at clone time** (`praxis/job-<8-char-id>`) by `JobOrchestrator.cloneRepo`. The execute agent writes to this branch; `/publish` just commits + pushes it — never runs `git checkout -b`.
- **SSE error propagation**: if `agent.service.ts` throws, the sandbox-worker emits `{ type: 'error', error: '...' }` into the stream. `callSandboxPrompt` in step-runner detects this and re-throws, which `failJob` catches and transitions to `failed`.
- **Repo memory**: stored in MinIO at `memory/<repo_key>/MEMORY.md`. Injected into the plan-session system prompt (not execute). Hard limit 32 KB / 20 entries per section. Learning pass runs after all steps as a single-turn agent call; failures are logged at warn and do NOT fail the job.
- **Storage not configured**: `@shared/storage` throws `StorageNotConfiguredError` when STORAGE_* env vars are absent. `loadMemoryFile` returns `null`, `runLearningPass` logs warn and skips. Jobs still complete normally.
- **Adding a shared utility**: place in `shared/<existing-package>/src/`, re-export from its `index.ts`. Only create a new package for genuinely independent concerns.
- **Tests**: `vitest` is installed but no `vitest.config.ts` exists yet. Create one at repo root and place test files as `*.test.ts` beside source files.
- **Lint/format**: `npm run lint` (Biome check), `npm run format` (Biome write).
