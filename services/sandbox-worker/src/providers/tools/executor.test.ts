import { describe, expect, it, beforeEach } from 'vitest';
import { toolRegistry } from './index';
import { createMockExecService } from '../../__tests__/mocks';
import type { ToolContext } from './index';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let workDir: string;

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    workingDir: workDir,
    exec: createMockExecService(),
    ...overrides,
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'praxis-test-'));
});

// ── bash ─────────────────────────────────────────────────────────────────────

describe('toolRegistry.execute bash', () => {
  it('delegates to the injected exec service', async () => {
    const exec = createMockExecService({ exitCode: 0, stdout: 'hello', stderr: '' });
    const ctx = makeCtx({ exec });

    const result = await toolRegistry.execute('bash', { command: 'echo hello' }, ctx);

    expect(exec.run).toHaveBeenCalledOnce();
    expect(exec.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'echo hello', cwd: workDir }),
    );
    expect(result).toContain('hello');
  });

  it('returns exit code message on failure', async () => {
    const exec = createMockExecService({ exitCode: 1, stdout: '', stderr: 'command not found' });
    const ctx = makeCtx({ exec });

    const result = await toolRegistry.execute('bash', { command: 'bad-cmd' }, ctx);

    expect(result).toContain('Exit 1');
    expect(result).toContain('command not found');
  });
});

// ── read_file / write_file ───────────────────────────────────────────────────

describe('toolRegistry.execute read_file', () => {
  it('reads file content relative to workingDir', async () => {
    writeFileSync(join(workDir, 'hello.txt'), 'world');
    const ctx = makeCtx();

    const result = await toolRegistry.execute('read_file', { path: 'hello.txt' }, ctx);

    expect(result).toBe('world');
  });
});

describe('toolRegistry.execute write_file', () => {
  it('writes file content and returns confirmation', async () => {
    const ctx = makeCtx();

    const result = await toolRegistry.execute('write_file', { path: 'out.txt', content: 'test content' }, ctx);

    expect(result).toContain('out.txt');

    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(workDir, 'out.txt'), 'utf-8')).toBe('test content');
  });
});

// ── edit_file ────────────────────────────────────────────────────────────────

describe('toolRegistry.execute edit_file', () => {
  it('replaces unique old_string with new_string', async () => {
    writeFileSync(join(workDir, 'edit.txt'), 'hello world');
    const ctx = makeCtx();

    await toolRegistry.execute('edit_file', { path: 'edit.txt', old_string: 'world', new_string: 'praxis' }, ctx);

    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(workDir, 'edit.txt'), 'utf-8')).toBe('hello praxis');
  });

  it('returns an error when old_string is not found', async () => {
    writeFileSync(join(workDir, 'edit.txt'), 'hello world');
    const ctx = makeCtx();

    const result = await toolRegistry.execute('edit_file', { path: 'edit.txt', old_string: 'missing', new_string: 'new' }, ctx);

    expect(result).toContain('not found');
  });

  it('returns an error when old_string appears more than once', async () => {
    writeFileSync(join(workDir, 'edit.txt'), 'foo foo');
    const ctx = makeCtx();

    const result = await toolRegistry.execute('edit_file', { path: 'edit.txt', old_string: 'foo', new_string: 'bar' }, ctx);

    expect(result).toContain('ambiguous');
  });
});

// ── unknown tool ─────────────────────────────────────────────────────────────

describe('toolRegistry — unknown tool', () => {
  it('returns an unknown tool message', async () => {
    const ctx = makeCtx();
    const result = await toolRegistry.execute('not_a_tool', {}, ctx);
    expect(result).toContain('Unknown tool');
  });
});
