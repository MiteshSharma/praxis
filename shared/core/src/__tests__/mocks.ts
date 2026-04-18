/**
 * Shared mock factories for all major interfaces.
 *
 * Each factory returns a vi.fn()-based implementation so test assertions
 * can verify call counts and arguments without touching real infrastructure.
 *
 * Usage:
 *   const tracker = createMockTaskTracker();
 *   tracker.createPlan.mockResolvedValue(somePlan);
 */
import { vi } from 'vitest';
import type { MemoryBackend, MemoryContext } from '@shared/memory';
import type { SandboxInfo, SandboxProvider } from '@shared/sandbox';
import type { TaskTracker, PlanDraft, PlanStatus } from '../task-tracker/task-tracker';

// ── TaskTracker ─────────────────────────────────────────────────────────────

export function createMockTaskTracker(): {
  [K in keyof TaskTracker]: ReturnType<typeof vi.fn>;
} & TaskTracker {
  return {
    createPlan: vi.fn(),
    getPlan: vi.fn().mockResolvedValue(null),
    getLatestPlanForJob: vi.fn().mockResolvedValue(null),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    recordRevisionRequest: vi.fn(),
    updatePlanStatus: vi.fn().mockResolvedValue(undefined),
    listPlansForJob: vi.fn().mockResolvedValue([]),
  };
}

// ── MemoryBackend ────────────────────────────────────────────────────────────

export function createMockMemoryBackend(
  defaults?: Partial<{ context: MemoryContext | null; saveResult: { sizeBytes: number; entryCount: number } }>,
): { [K in keyof MemoryBackend]: ReturnType<typeof vi.fn> } & MemoryBackend {
  return {
    loadForJob: vi.fn().mockResolvedValue(defaults?.context ?? null),
    save: vi.fn().mockResolvedValue(defaults?.saveResult ?? { sizeBytes: 0, entryCount: 0 }),
  };
}

// ── SandboxProvider ──────────────────────────────────────────────────────────

export function createMockSandboxProvider(
  sandboxInfo?: Partial<SandboxInfo>,
): { [K in keyof SandboxProvider]: ReturnType<typeof vi.fn> } & SandboxProvider {
  const info: SandboxInfo = {
    id: 'mock-sandbox',
    providerId: 'mock-provider',
    endpoint: 'http://localhost:8787',
    createdAt: new Date(),
    workspacePath: '/tmp/workspace',
    ...sandboxInfo,
  };
  return {
    create: vi.fn().mockResolvedValue(info),
    destroy: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 }),
  };
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Creates a mock fetch that returns a single SSE event frame.
 * The event payload is JSON.stringify(data).
 */
export function createMockSseResponse(data: unknown): Response {
  const body = `data: ${JSON.stringify(data)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/**
 * Creates a mock fetch that streams a list of SSE events in order.
 */
export function createMockFetch(
  responses: Array<{ status?: number; body?: string; json?: unknown }>,
): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => {
    const spec = responses[callIndex++] ?? { status: 200, body: '' };
    if (spec.json !== undefined) {
      return new Response(JSON.stringify(spec.json), {
        status: spec.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(spec.body ?? '', {
      status: spec.status ?? 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  });
}
