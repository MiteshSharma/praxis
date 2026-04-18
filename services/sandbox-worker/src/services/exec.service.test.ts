import { describe, it, expect, vi, beforeEach } from 'vitest';

// We mock child_process before importing ExecService so the module
// picks up the mock when it calls promisify(execCb).
const execMock = vi.fn();

vi.mock('node:child_process', () => ({
  exec: execMock,
}));

// Import after mock is set up
const { ExecService } = await import('./exec.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Make exec resolve with stdout/stderr */
function execSuccess(stdout: string, stderr = '') {
  execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout, stderr });
  });
}

/** Make exec call callback with an error */
function execError(err: { code?: number; stdout?: string; stderr?: string; message?: string }) {
  execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (err: unknown) => void) => {
    cb(err);
  });
}

const BASE_INPUT = {
  command: 'echo hello',
  cwd: '/tmp',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExecService.run', () => {
  let svc: InstanceType<typeof ExecService>;

  beforeEach(() => {
    svc = new ExecService();
    execMock.mockReset();
  });

  it('returns exitCode=0 and captured stdout on success', async () => {
    execSuccess('hello world\n');
    const result = await svc.run(BASE_INPUT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world\n');
    expect(result.stderr).toBe('');
  });

  it('captures stderr output on success', async () => {
    execSuccess('', 'warning: something\n');
    const result = await svc.run(BASE_INPUT);
    expect(result.stderr).toBe('warning: something\n');
  });

  it('returns exitCode from error.code when command fails', async () => {
    execError({ code: 127, stdout: '', stderr: 'command not found' });
    const result = await svc.run(BASE_INPUT);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe('command not found');
  });

  it('returns exitCode=1 when error has no code', async () => {
    execError({ message: 'SIGKILL' });
    const result = await svc.run(BASE_INPUT);
    expect(result.exitCode).toBe(1);
  });

  it('includes durationMs in result', async () => {
    execSuccess('');
    const result = await svc.run(BASE_INPUT);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes env variables merged with PATH', async () => {
    execSuccess('');
    await svc.run({ ...BASE_INPUT, env: { MY_VAR: 'hello' } });

    const callOpts = execMock.mock.calls[0]![1] as { env: Record<string, string> };
    expect(callOpts.env.MY_VAR).toBe('hello');
    expect(callOpts.env.PATH).toBeDefined();
  });

  it('uses provided timeoutSeconds converted to ms', async () => {
    execSuccess('');
    await svc.run({ ...BASE_INPUT, timeoutSeconds: 30 });

    const callOpts = execMock.mock.calls[0]![1] as { timeout: number };
    expect(callOpts.timeout).toBe(30000);
  });

  it('defaults to 120s timeout when not specified', async () => {
    execSuccess('');
    await svc.run(BASE_INPUT);

    const callOpts = execMock.mock.calls[0]![1] as { timeout: number };
    expect(callOpts.timeout).toBe(120000);
  });

  it('uses cwd from input', async () => {
    execSuccess('');
    await svc.run({ ...BASE_INPUT, cwd: '/custom/dir' });

    const callOpts = execMock.mock.calls[0]![1] as { cwd: string };
    expect(callOpts.cwd).toBe('/custom/dir');
  });
});
