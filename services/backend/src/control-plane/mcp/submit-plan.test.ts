import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { mintMcpToken } from '@shared/core';
import { registerMcpRoutes } from './submit-plan';

// ── Constants ─────────────────────────────────────────────────────────────────

const SECRET = 'test-secret-that-is-at-least-32-chars-long';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDb(job: unknown = null) {
  return {
    query: {
      jobs: { findFirst: vi.fn().mockResolvedValue(job) },
    },
  };
}

function makeTracker() {
  return {
    getLatestPlanForJob: vi.fn().mockResolvedValue(null),
    createPlan: vi.fn().mockResolvedValue({ id: 'plan-1', version: 1 }),
  };
}

const VALID_PLAN_BODY = {
  title: 'Fix the login bug',
  summary: 'We need to fix the authentication flow.',
  bodyMarkdown: '## Plan\n\nFix the code.',
  steps: [{ id: 'step-1', content: 'Write tests', status: 'pending' as const }],
  affectedPaths: ['src/auth.ts'],
};

// Mock DbTaskTracker so tests don't need a real DB
const mockTracker = makeTracker();
vi.mock('@shared/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/core')>();
  return {
    ...actual,
    DbTaskTracker: vi.fn().mockImplementation(() => mockTracker),
  };
});

// ── Build a test Hono app ─────────────────────────────────────────────────────

async function buildApp(overrides: {
  db?: ReturnType<typeof makeDb>;
  mcpSecret?: string;
  memoryBackend?: { loadForJob: ReturnType<typeof vi.fn> };
  log?: ReturnType<typeof makeLog>;
}) {
  const app = new Hono();
  registerMcpRoutes(app, {
    db: (overrides.db ?? makeDb()) as never,
    log: (overrides.log ?? makeLog()) as never,
    mcpSecret: overrides.mcpSecret,
    memoryBackend: overrides.memoryBackend as never,
  });
  return app;
}

async function post(app: Hono, path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  return app.request(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ── Tests: /mcp/submit_plan ───────────────────────────────────────────────────

describe('POST /mcp/submit_plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker.getLatestPlanForJob.mockResolvedValue(null);
    mockTracker.createPlan.mockResolvedValue({ id: 'plan-1', version: 1 });
  });

  it('returns 503 when mcpSecret is not configured', async () => {
    const app = await buildApp({ mcpSecret: undefined });
    const res = await post(app, '/mcp/submit_plan', VALID_PLAN_BODY);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('mcp_not_configured');
  });

  it('returns 401 when authorization header is missing', async () => {
    const app = await buildApp({ mcpSecret: SECRET });
    const res = await app.request('/mcp/submit_plan', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_token');
  });

  it('returns 401 when token is invalid', async () => {
    const app = await buildApp({ mcpSecret: SECRET });
    const res = await post(app, '/mcp/submit_plan', VALID_PLAN_BODY, 'invalid.jwt.token');
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_token');
  });

  it('returns 400 when plan body is invalid', async () => {
    const app = await buildApp({ mcpSecret: SECRET });
    const token = await mintMcpToken('job-1', SECRET);
    const res = await post(app, '/mcp/submit_plan', { title: '' }, token);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('creates plan and returns planId + version on success', async () => {
    const app = await buildApp({ mcpSecret: SECRET });
    const token = await mintMcpToken('job-1', SECRET);
    const res = await post(app, '/mcp/submit_plan', VALID_PLAN_BODY, token);
    expect(res.status).toBe(200);
    const body = await res.json() as { planId: string; version: number };
    expect(body.planId).toBe('plan-1');
    expect(body.version).toBe(1);
  });

  it('passes previousPlanId when a prior plan exists', async () => {
    mockTracker.getLatestPlanForJob.mockResolvedValue({ id: 'prev-plan' });
    const app = await buildApp({ mcpSecret: SECRET });
    const token = await mintMcpToken('job-1', SECRET);
    await post(app, '/mcp/submit_plan', VALID_PLAN_BODY, token);

    expect(mockTracker.createPlan).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ previousPlanId: 'prev-plan' }),
    );
  });

  it('passes undefined previousPlanId when no prior plan exists', async () => {
    mockTracker.getLatestPlanForJob.mockResolvedValue(null);
    const app = await buildApp({ mcpSecret: SECRET });
    const token = await mintMcpToken('job-1', SECRET);
    await post(app, '/mcp/submit_plan', VALID_PLAN_BODY, token);

    expect(mockTracker.createPlan).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ previousPlanId: undefined }),
    );
  });
});

// ── Tests: /mcp/query_memory ──────────────────────────────────────────────────

describe('POST /mcp/query_memory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 503 when mcpSecret is not configured', async () => {
    const app = await buildApp({ mcpSecret: undefined });
    const res = await post(app, '/mcp/query_memory', { query: 'dependency injection' });
    expect(res.status).toBe(503);
  });

  it('returns null content when no memoryBackend is configured', async () => {
    const app = await buildApp({ mcpSecret: SECRET });
    const token = await mintMcpToken('job-1', SECRET);
    const res = await post(app, '/mcp/query_memory', { query: 'test' }, token);
    expect(res.status).toBe(200);
    const body = await res.json() as { content: null };
    expect(body.content).toBeNull();
  });

  it('returns 401 when authorization header is missing', async () => {
    const app = await buildApp({ mcpSecret: SECRET, memoryBackend: { loadForJob: vi.fn() } });
    const res = await app.request('/mcp/query_memory', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    const app = await buildApp({ mcpSecret: SECRET, memoryBackend: { loadForJob: vi.fn() } });
    const res = await post(app, '/mcp/query_memory', { query: 'test' }, 'bad.token.here');
    expect(res.status).toBe(401);
  });

  it('returns 404 when job is not found', async () => {
    const db = makeDb(null);
    const app = await buildApp({
      mcpSecret: SECRET,
      db,
      memoryBackend: { loadForJob: vi.fn() },
    });
    const token = await mintMcpToken('job-missing', SECRET);
    const res = await post(app, '/mcp/query_memory', { query: 'test' }, token);
    expect(res.status).toBe(404);
  });

  it('returns 400 when job githubUrl is invalid', async () => {
    const db = makeDb({ id: 'job-1', githubUrl: 'not-a-valid-url' });
    const app = await buildApp({
      mcpSecret: SECRET,
      db,
      memoryBackend: { loadForJob: vi.fn() },
    });
    const token = await mintMcpToken('job-1', SECRET);
    const res = await post(app, '/mcp/query_memory', { query: 'test' }, token);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_repo_url');
  });

  it('returns memory content on success', async () => {
    const db = makeDb({ id: 'job-1', githubUrl: 'https://github.com/owner/repo' });
    const memoryBackend = {
      loadForJob: vi.fn().mockResolvedValue({
        content: '## Conventions\n- [high] Use DI. (job:abc)',
        source: 'full',
        truncated: false,
      }),
    };
    const app = await buildApp({ mcpSecret: SECRET, db, memoryBackend });
    const token = await mintMcpToken('job-1', SECRET);
    const res = await post(app, '/mcp/query_memory', { query: 'dependency injection' }, token);
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; source: string; truncated: boolean };
    expect(body.content).toContain('Use DI');
    expect(body.source).toBe('full');
    expect(body.truncated).toBe(false);
  });

  it('returns null content when memory backend returns null', async () => {
    const db = makeDb({ id: 'job-1', githubUrl: 'https://github.com/owner/repo' });
    const memoryBackend = { loadForJob: vi.fn().mockResolvedValue(null) };
    const app = await buildApp({ mcpSecret: SECRET, db, memoryBackend });
    const token = await mintMcpToken('job-1', SECRET);
    const res = await post(app, '/mcp/query_memory', { query: 'anything' }, token);
    expect(res.status).toBe(200);
    const body = await res.json() as { content: null };
    expect(body.content).toBeNull();
  });
});
