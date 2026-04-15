# Praxis

Self-hosted platform where you point an AI agent at a GitHub repo, give it a
task, and get reviewable work back. Work is produced inside an isolated sandbox
by a pipeline of agents and deterministic checks, with a human-in-the-loop plan
review at the front and a learning step at the end that improves the system for
the same repo on subsequent runs.

Praxis sits between two existing patterns:

- **A chat agent with tools** — like Cursor or Claude Desktop, but with durable
  state, multi-step pipelines, and a reviewable plan.
- **A CI pipeline** — like GitHub Actions, but where the "scripts" are AI
  sessions and the input is natural language.

The opinionated core: **build a plan, review the plan, execute the plan, verify
with deterministic checks, learn from the result.**

---

## Current status — scaffold

The repo currently implements the scaffold phase: the plumbing is in place and
every service boots, logs, and responds to health checks. No business logic yet.

What's wired up:

- **Monorepo layout** with `shared/*` path alias (`@shared/telemetry`,
  `@shared/contracts`, …) and a single root `package.json`.
- **Three services**
  - `services/backend` — Hono + oRPC + pg-boss, one codebase with a `MODE` env
    var dispatcher that can run as `control-plane`, `worker`, or `all`.
  - `services/sandbox-worker` — Hono server that will later execute jobs inside
    a sandbox container. Currently only exposes health endpoints and stub
    `/prompt` and `/exec` routes.
  - `services/web` — Vite + React + AntD + TanStack Query, calling the backend
    through an end-to-end typed oRPC client.
- **Infra via docker compose** — Postgres 18, Redis 7, MinIO.
- **Shared telemetry** — pino structured logging, Zod-validated env,
  OpenTelemetry SDK (opt-in), graceful shutdown, request-id middleware.
- **Auto-generated API docs** — `@orpc/openapi` + Scalar at `/docs`.
- **Smoke test** — `scripts/smoke.ts` exercises every scaffold exit criterion
  in one command.

### Service endpoints

| Service | URL | Notes |
|---|---|---|
| Backend control-plane | http://localhost:3000 | `/health`, `/ready`, `/rpc/*`, `/openapi.json`, `/docs` |
| Backend worker health | http://localhost:3101 | `/health`, `/ready` (pg-boss consumer runs in the same process) |
| Sandbox-worker | http://localhost:8787 | `/health`, `/ready`; `/prompt`, `/exec` return `501` for now |
| Web (Vite dev) | http://localhost:5173 | Single page calling `rpc.health()` |
| Postgres | localhost:5433 | user `praxis` / pass `praxis` / db `praxis` |
| Redis | localhost:6379 | |
| MinIO S3 | http://localhost:9000 | |
| MinIO console | http://localhost:9001 | `minioadmin` / `minioadmin` |

---

## Running it

Everything is driven through the `Makefile`. `make help` prints the full menu.

### One-time setup

```bash
make setup      # installs nvm, node (from .nvmrc), and pnpm globally
make prepare    # pnpm install --frozen-lockfile
cp .env.example .env.local    # backend reads this automatically at boot
```

### Day-to-day

```bash
make up         # infra-up (docker compose) + dev (all three services)
```

That runs Postgres/Redis/MinIO in docker and starts web + backend (MODE=all) +
sandbox-worker with hot reload. In another terminal:

```bash
make smoke      # 6 checks — prints "smoke test passed" if everything is green
```

### Individual services

```bash
make dev-backend          # MODE=all
make dev-sandbox-worker
make dev-web
```

To exercise the multi-process split (control-plane and worker as separate
processes):

```bash
pnpm dev:backend:control-plane   # in one terminal
pnpm dev:backend:worker          # in another
```

### Infra lifecycle

```bash
make infra-up         # start postgres / redis / minio
make infra-ps         # status
make infra-logs       # tail
make infra-down       # stop
make infra-reset      # stop + wipe volumes (clean slate)
```

### Quality

```bash
make typecheck
make lint
make format
```

### Cleanup

```bash
make clean            # node_modules, dist, .vite
```

---

## Configuration

Backend reads `.env.local` (then `.env`) via Node 24's built-in
`process.loadEnvFile` before Zod validation. See `.env.example` for the full
set. Key vars:

| Var | Default | Purpose |
|---|---|---|
| `MODE` | `all` | `control-plane`, `worker`, or `all` |
| `DATABASE_URL` | `postgres://praxis:praxis@localhost:5433/praxis` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `PORT` | `3000` | Control-plane HTTP port |
| `WORKER_HEALTH_PORT` | `3101` | Worker role health port |
| `LOG_LEVEL` | `info` | pino log level |
| `OTEL_TRACES` | `off` (dev) | `off`, `console`, or `otlp` — see below |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Required when `OTEL_TRACES=otlp` |

### Traces

OpenTelemetry tracing is **opt-in during development** to keep the console
quiet. Flip it on when you're debugging something:

```bash
OTEL_TRACES=console make dev     # dump spans to stdout
OTEL_TRACES=otlp OTEL_EXPORTER_OTLP_ENDPOINT=https://… make dev
```

---

## Repo layout

```
praxis/
├── Makefile                # all dev commands
├── docker/
│   └── docker-compose.dev.yml
├── scripts/
│   ├── dev.ts              # concurrently runs web + backend + sandbox
│   └── smoke.ts            # end-to-end smoke test
├── shared/
│   ├── contracts/          # oRPC router (shared types between backend + web)
│   └── telemetry/          # pino, OTel, shutdown, request-id
└── services/
    ├── backend/            # Hono + oRPC + pg-boss (MODE=control-plane|worker|all)
    ├── sandbox-worker/     # Hono server baked into the sandbox image
    └── web/                # Vite + React + AntD
```

Other `shared/*` directories (`core`, `db`, `sandbox`, `agent-runtime`,
`stream`, `storage`, `skills`, `mcp`, `memory`) are placeholders — they get
filled in as features land.
