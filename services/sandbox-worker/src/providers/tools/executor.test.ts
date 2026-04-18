import { describe, expect, it, beforeEach } from 'vitest';
import { ToolExecutor } from './executor';
import { createMockExecService } from '../../__tests__/mocks';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'praxis-test-'));
});

// ── bash ─────────────────────────────────────────────────────────────────────

describe('ToolExecutor.bash', () => {
  it('delegates to the injected exec service', async () => {
    const exec = createMockExecService({ exitCode: 0, stdout: 'hello', stderr: '' });
    const executor = new ToolExecutor({ workingDir: workDir, exec });

    const result = await executor.execute('bash', { command: 'echo hello' });

    expect(exec.run).toHaveBeenCalledOnce();
    expect(exec.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'echo hello', cwd: workDir }),
    );
    expect(result).toContain('hello');
  });

  it('returns exit code message on failure', async () => {
    const exec = createMockExecService({
      exitCode: 1,
      stdout: '',
      stderr: 'command not found',
    });
    const executor = new ToolExecutor({ workingDir: workDir, exec });

    const result = await executor.execute('bash', { command: 'bad-cmd' });

    expect(result).toContain('Exit 1');
    expect(result).toContain('command not found');
  });
});

// ── read_file / write_file ───────────────────────────────────────────────────

describe('ToolExecutor.read_file', () => {
  it('reads file content relative to workingDir', async () => {
    writeFileSync(join(workDir, 'hello.txt'), 'world');
    const executor = new ToolExecutor({ workingDir: workDir });

    const result = await executor.execute('read_file', { path: 'hello.txt' });

    expect(result).toBe('world');
  });
});

describe('ToolExecutor.write_file', () => {
  it('writes file content and returns confirmation', async () => {
    const executor = new ToolExecutor({ workingDir: workDir });

    const result = await executor.execute('write_file', {
      path: 'out.txt',
      content: 'test content',
    });

    expect(result).toContain('Written out.txt');

    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(workDir, 'out.txt'), 'utf-8')).toBe('test content');
  });
});

// ── edit_file ────────────────────────────────────────────────────────────────

describe('ToolExecutor.edit_file', () => {
  it('replaces unique old_string with new_string', async () => {
    writeFileSync(join(workDir, 'edit.txt'), 'hello world');
    const executor = new ToolExecutor({ workingDir: workDir });

    const result = await executor.execute('edit_file', {
      path: 'edit.txt',
      old_string: 'world',
      new_string: 'praxis',
    });

    expect(result).toContain('Edited');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(workDir, 'edit.txt'), 'utf-8')).toBe('hello praxis');
  });

  it('returns an error when old_string is not found', async () => {
    writeFileSync(join(workDir, 'edit.txt'), 'hello world');
    const executor = new ToolExecutor({ workingDir: workDir });

    const result = await executor.execute('edit_file', {
      path: 'edit.txt',
      old_string: 'missing',
      new_string: 'new',
    });

    expect(result).toContain('not found');
  });

  it('returns an error when old_string appears more than once', async () => {
    writeFileSync(join(workDir, 'edit.txt'), 'foo foo');
    const executor = new ToolExecutor({ workingDir: workDir });

    const result = await executor.execute('edit_file', {
      path: 'edit.txt',
      old_string: 'foo',
      new_string: 'bar',
    });

    expect(result).toContain('ambiguous');
  });
});

// ── unknown tool ─────────────────────────────────────────────────────────────

describe('ToolExecutor — unknown tool', () => {
  it('returns an unknown tool message', async () => {
    const executor = new ToolExecutor({ workingDir: workDir });
    const result = await executor.execute('not_a_tool', {});
    expect(result).toContain('Unknown tool');
  });
});
