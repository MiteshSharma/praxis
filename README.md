# Praxis

> **Praxis is the only coding agent platform where no code reaches a pull request without a human approving the plan — with full audit trail, per-repo institutional memory, and customizable workflows for your engineering standards.**

---

> *praxis* (n.) — from Greek πρᾶξις: the process by which theory is enacted and made real through deliberate, reflective action. Aristotle distinguished *praxis* from mere *poiesis* (making things) — praxis is action that carries meaning and learns from itself.

Praxis is a self-hosted platform that turns natural-language tasks into reviewed, tested, and merged pull requests. You point it at a GitHub repo, describe what you want, and an AI agent plans the work, waits for your approval, implements it, verifies it with your own checks, then opens a PR — and learns from every run so the next one is better.

**The cycle mirrors the word:** plan → review → execute → verify → publish → learn → repeat.

---

## Why Praxis

Every major coding agent — Devin, GitHub Copilot Workspace, OpenHands, background-agents — treats human review as optional or absent. Praxis is architected differently.

### Architecturally enforced plan → review → execute

No code runs until you approve the plan. This is not a UI courtesy — it is a structural constraint in the job state machine. The agent proposes, you decide, then execution begins.

### Per-repo persistent memory

After every job, a learning pass updates a structured `MEMORY.md` file scoped to that repository. The next job on the same repo starts with accumulated knowledge: conventions, pitfalls, internal library patterns, test setup requirements.

The agent gets smarter about your codebase over time. Not through fine-tuning — through structured, inspectable, editable memory that your team can review and correct.

### Composable workflow and agent DSL

Praxis is not a fixed pipeline. You define workflows as sequences of plan / execute / check steps, attach custom agents with their own system prompts and tool permissions, compose reusable skills with declared dependencies, and wire check steps to your own shell commands (tests, lint, type-check). Each part is versioned and swappable per conversation.

---

## How it works

```
You submit a task
       │
       ▼
  [ planning ]   Agent reads the repo and the repo's memory file,
                 proposes a structured plan with steps and open questions.
       │
       ▼
  [ plan review ] You approve, ask for revisions, or reject.
       │
       ▼
  [ executing ]  Agent implements the plan, editing files in an isolated sandbox.
       │
       ▼
  [ checking ]   Your own shell commands run as deterministic checks (tests,
                 lint, type-check). Failures trigger a recovery execute step.
       │
       ▼
  [ publishing ] Git commit + push + GitHub PR opened automatically.
       │
       ▼
  [ learning ]   A single-turn agent pass updates a per-repo MEMORY.md file
                 in object storage so future jobs on the same repo start smarter.
       │
       ▼
  [ completed ]  PR link available. Cost recorded.
```

Every status transition is streamed live to the UI via SSE.

---

## Features

- **Plan-first workflow** — agent always proposes a structured plan (title, summary, steps, affected paths, risks, open questions) before touching any code.
- **Human-in-the-loop review** — hot hold (10 min) waits for approve / revise / reject before executing. Cold resume if the hold expires.
- **Repo memory** — per-repo `MEMORY.md` stored in MinIO. Injected into the plan prompt so agents accumulate knowledge across jobs on the same repo.
- **Multi-step workflows** — configurable plan / execute / check step sequences. Recovery execute steps run automatically after a failed check.
- **Live timeline** — SSE stream shows every agent turn, tool call, status transition, and artifact in real time.
- **Phase progress bar** — visual indicator across Planning → Plan review → Executing → Publishing PR → Learning → Done.
- **Cost tracking** — input tokens, output tokens, and estimated USD cost stored per job and displayed in the header.
- **Multi-provider sandbox** — provider-agnostic architecture; Claude (Anthropic) and OpenAI/Codex are both active. Set model name in conversation settings to switch providers.
- **Per-conversation model selection** — override the default model per conversation; `claude-*` routes to Claude, `gpt-*`/`o-series`/`codex-*` routes to OpenAI.
- **MCP plugins** — per-conversation MCP servers (stdio or HTTP) wired into agent sessions.
- **Restart** — any failed job can be restarted with one click; a new job is created from the same inputs.

---

## Services

| Service | URL | Role |
|---|---|---|
| Backend (control-plane) | http://localhost:3000 | oRPC API, SSE, MCP endpoint |
| Backend (worker health) | http://localhost:3101 | pg-boss consumer health check |
| Sandbox-worker | http://localhost:8787 | Runs agent sessions inside the sandbox |
| Web (Vite dev) | http://localhost:5173 | React UI |
| Postgres | localhost:5433 | Primary database |
| Redis | localhost:6379 | pg-boss queue + plan-event pub/sub |
| MinIO S3 | http://localhost:9000 | Artifact + memory file storage |
| MinIO console | http://localhost:9001 | Bucket browser (`minioadmin` / `minioadmin`) |
| API docs (Scalar) | http://localhost:3000/docs | Auto-generated from oRPC contract |

---

## Prerequisites

- macOS or Linux
- [nvm](https://github.com/nvm-sh/nvm) (installed by `make setup`)
- Node 24 (pinned in `.nvmrc`, selected automatically by make targets)
- pnpm 10 (installed by `make setup`)
- Docker Desktop or equivalent

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/MiteshSharma/praxis.git
cd praxis
make setup      # installs nvm, node 24, pnpm 10
make prepare    # pnpm install --frozen-lockfile
```

### 2. Configure

```bash
cp .env.example .env.local
```

Edit `.env.local` — at minimum set:

```
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=github_pat_...
MCP_SHARED_SECRET=at-least-32-random-characters-here
```

### 3. Start infrastructure

```bash
make infra-up   # starts Postgres, Redis, MinIO (and creates the praxis bucket)
```

### 4. Run database migrations

```bash
make migrate
```

This applies all SQL files in `shared/db/drizzle/` in order. Falls back to the default `DATABASE_URL` if the env var is not set.

### 5. Start all services

```bash
make dev        # web + backend (MODE=all) + sandbox-worker, all with hot reload
```

Or start everything at once (infra + dev):

```bash
make up
```

Open http://localhost:5173 and submit a job.

---

## Configuration

Backend reads `.env.local` (then `.env`) at startup via Node 24's built-in `process.loadEnvFile`.

| Variable | Default | Purpose |
|---|---|---|
| `MODE` | `all` | `control-plane`, `worker`, or `all` |
| `DATABASE_URL` | `postgres://praxis:praxis@localhost:5433/praxis` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis (pg-boss + plan-event pub/sub) |
| `PORT` | `3000` | Control-plane HTTP port |
| `WORKER_HEALTH_PORT` | `3101` | Worker health port |
| `LOG_LEVEL` | `info` | pino log level |
| `ANTHROPIC_API_KEY` | — | Required for Claude agent sessions |
| `GITHUB_TOKEN` | — | Clone repos + open PRs |
| `MCP_SHARED_SECRET` | — | Signs MCP JWTs (≥ 32 chars) |
| `CONTROL_PLANE_MCP_URL` | `http://localhost:3000/mcp` | URL the sandbox calls for `submit_plan` |
| `STORAGE_ENDPOINT` | `http://localhost:9000` | MinIO/S3 endpoint |
| `STORAGE_BUCKET` | `praxis` | Bucket for artifacts and repo memory |
| `STORAGE_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `STORAGE_SECRET_KEY` | `minioadmin` | MinIO secret key |
| `STORAGE_REGION` | `us-east-1` | Storage region |
| `OPENAI_API_KEY` | — | Optional — used for `gpt-*`, `o1`/`o3`/`o4-*`, `codex-*` models |
| `MEMORY_BACKEND` | `s3` | `s3` (MinIO/S3), `builtin` (Postgres FTS), `qmd`, or `honcho` |
| `OTEL_TRACES` | `off` | `off`, `console`, or `otlp` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Required when `OTEL_TRACES=otlp` |

---

## Development commands

```bash
make up                  # full local stack (infra + all services)
make migrate             # apply all SQL migrations in shared/db/drizzle/
make dev                 # services only (assumes infra already running)
make dev-backend         # backend only (MODE=all)
make dev-sandbox-worker  # sandbox-worker only
make dev-web             # Vite dev server only

make typecheck           # tsc --noEmit across the workspace
make lint                # Biome check
make format              # Biome format --write
make smoke               # end-to-end smoke test against a running stack

make infra-up            # start Postgres / Redis / MinIO
make infra-down          # stop infra
make infra-reset         # stop + wipe volumes (clean slate)
make infra-logs          # tail infra container logs
make infra-ps            # show container status

make clean               # remove node_modules, dist, .vite
```

To run control-plane and worker as separate processes:

```bash
pnpm dev:backend:control-plane   # terminal 1
pnpm dev:backend:worker          # terminal 2
```

---

## Repo layout

```
praxis/
├── Makefile
├── docker/
│   └── docker-compose.dev.yml     Postgres 18, Redis 7, MinIO
├── scripts/
│   ├── dev.ts                     concurrently: web + backend + sandbox-worker
│   └── smoke.ts                   end-to-end smoke test
│
├── shared/
│   ├── contracts/                 oRPC contract + Zod DTOs + event types
│   ├── core/                      job orchestrator, step runner, learning pass,
│   │                              prompts, MCP auth, default agent/workflow
│   ├── db/                        Drizzle ORM schema + migrations + client
│   ├── memory/                    repo-key normalisation, MEMORY.md load/save/validate
│   ├── storage/                   S3-compatible storage singleton (MinIO)
│   ├── mcp/                       MCP plugin registry
│   ├── sandbox/                   local sandbox provider
│   ├── telemetry/                 pino, OpenTelemetry, graceful shutdown
│   └── workflows/                 workflow definition types, parser, loader
│
└── services/
    ├── backend/                   Hono + oRPC + pg-boss
    │   └── src/
    │       ├── control-plane.ts   mounts RPC, SSE, health, MCP routes
    │       ├── worker.ts          pg-boss consumer
    │       ├── routes/            rpc.ts, sse.ts, health.ts
    │       └── services/          jobs, plans, workflows, agents,
    │                              conversations, plugins, memories
    │
    ├── sandbox-worker/            Hono server running inside the sandbox
    │   └── src/
    │       ├── routes/            /prompt, /exec, /publish, /abort, /health
    │       ├── services/          agent, exec, publish
    │       └── providers/         AgentProvider interface + ProviderRegistry + Claude, OpenAI, Demo
    │           └── tools/         ToolDefinition schemas + ToolExecutor (for non-Claude providers)
    │
    └── web/                       Vite + React + AntD + TanStack Query
        └── src/
            ├── pages/             JobView, CreateJob, MemoryList, MemoryEditor,
            │                      ConversationDetail, AgentBrowse, WorkflowBrowse
            └── components/        JobPhaseBar, StepProgress, PlanReviewCard, PluginsPanel
```

---

## Job state machine

```
queued → provisioning → preparing → building → plan_ready → plan_review
                                                                 │
                                              ┌──────────────────┤
                                              │                  │
                                        plan_revising      preparing
                                              │                  │
                                         plan_ready         executing ←──┐
                                              │                  │       │
                                         plan_review         checking    │
                                              │                  │       │
                                        plan_rejected       preparing ───┘
                                                                 │
                                                            publishing
                                                           (PR created)
                                                                 │
                                                            learning
                                                           (memory update)
                                                                 │
                                                            completed
```

Terminal states: `completed`, `plan_rejected`, `failed`.  
All valid transitions are defined in `shared/contracts/src/events.ts` → `JOB_TRANSITIONS`.

---

## Adding a new provider

The sandbox-worker uses a self-registering provider registry — each AI provider is one file behind the `AgentProvider` interface:

```
providers/
  types.ts           AgentProvider interface + normalized SSE format spec
  registry.ts        ProviderRegistry — ordered (matcher, factory) pairs; first match wins
  index.ts           barrel: imports claude, openai, demo in priority order
  claude.ts          Anthropic Claude — handles claude-* models
  openai.ts          OpenAI / Codex — handles gpt-*, o1/o3/o4-*, codex-* models
  demo.ts            Deterministic demo agent (no API key needed) — catch-all
  tools/
    definitions.ts   Tool schemas in OpenAI function-calling format
    executor.ts      Executes read_file, write_file, edit_file, bash, glob, grep, submit_plan
```

To add a new provider: create `providers/<name>.ts`, implement `AgentProvider.run()`, call `registerProvider(matcherFn, factory)` at module level, add the import to `providers/index.ts`. The orchestrator, step-runner, and UI need no changes.

---

## Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node 24, TypeScript 5.6 strict |
| HTTP framework | Hono 4.6 |
| RPC | oRPC 1.9 (contract → handler → client, end-to-end typed) |
| Database | Postgres 18 + Drizzle ORM 0.36 |
| Queue | pg-boss 10 (Postgres-backed job queue) |
| Pub/sub | Redis 7 (plan-event wake signals) |
| AI | @anthropic-ai/claude-agent-sdk (Claude), openai@6 (GPT / Codex) |
| Object storage | MinIO (S3-compatible) via @aws-sdk/client-s3 |
| Frontend | React 18, Ant Design 5, TanStack Query 5, React Router 6 |
| Lint / format | Biome 1.9 |
| Tests | Vitest 2.1 (installed; test suite forthcoming) |
