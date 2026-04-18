import { vi } from 'vitest';
import type { IExecService } from '../services/exec.interface';
import type { ExecResult } from '../dto/exec.dto';
import type { OctokitLike } from '../services/publish.service';

// ── IExecService ─────────────────────────────────────────────────────────────

export function createMockExecService(
  defaultResult?: Partial<ExecResult>,
): IExecService & { run: ReturnType<typeof vi.fn> } {
  const result: ExecResult = {
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 0,
    ...defaultResult,
  };
  const mock = { run: vi.fn().mockResolvedValue(result) };
  return mock as unknown as IExecService & { run: ReturnType<typeof vi.fn> };
}

// ── OctokitLike ──────────────────────────────────────────────────────────────

export function createMockOctokit(pr?: { number: number; html_url: string }): OctokitLike & {
  pulls: { create: ReturnType<typeof vi.fn> };
} {
  const prData = pr ?? { number: 42, html_url: 'https://github.com/owner/repo/pull/42' };
  return {
    pulls: {
      create: vi.fn().mockResolvedValue({ data: prData }),
    },
  };
}

// ── Shell function ────────────────────────────────────────────────────────────

export function createMockShell(
  responses: Record<string, string> = {},
): (cmd: string, cwd: string) => Promise<string> {
  return vi.fn().mockImplementation((cmd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return Promise.resolve(response);
    }
    return Promise.resolve('');
  });
}

// ── AgentProvider ─────────────────────────────────────────────────────────────

export function createMockAgentProvider() {
  return { run: vi.fn().mockResolvedValue(undefined) };
}
