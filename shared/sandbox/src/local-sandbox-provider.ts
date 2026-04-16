import { exec as execCb } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  CreateSandboxOptions,
  ExecOptions,
  ExecResult,
  SandboxInfo,
  SandboxProvider,
} from './types';

const execAsync = promisify(execCb);

/**
 * Local, Dockerless sandbox for Phase 1 dev. Creates a temp directory on the
 * host for each job and points the orchestrator at a pre-existing
 * sandbox-worker process (typically the one `make dev` runs on :8787).
 *
 * The sandbox-worker operates on whatever `workingDir` the orchestrator passes
 * in each request, so no container isolation — but it is the simplest thing
 * that exercises the full pipeline end-to-end. The Docker-based provider
 * supersedes this in later phases without touching the orchestrator.
 */
export class LocalSandboxProvider implements SandboxProvider {
  private readonly endpoint: string;
  private readonly workspaces = new Map<string, string>();

  constructor(opts: { endpoint?: string } = {}) {
    this.endpoint = opts.endpoint ?? process.env.SANDBOX_WORKER_URL ?? 'http://localhost:8787';
  }

  async create(opts: CreateSandboxOptions): Promise<SandboxInfo> {
    const workspace = await mkdtemp(join(tmpdir(), `praxis-${opts.jobId.slice(0, 8)}-`));
    const providerId = `local://${workspace}`;
    this.workspaces.set(providerId, workspace);
    return {
      id: providerId,
      providerId,
      endpoint: this.endpoint,
      createdAt: new Date(),
    };
  }

  async destroy(providerId: string): Promise<void> {
    const workspace = this.workspaces.get(providerId);
    if (!workspace) return;
    this.workspaces.delete(providerId);
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }

  async healthCheck(info: SandboxInfo): Promise<boolean> {
    try {
      const res = await fetch(`${info.endpoint}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  workspaceFor(providerId: string): string {
    const ws = this.workspaces.get(providerId);
    if (!ws) throw new Error(`unknown sandbox ${providerId}`);
    return ws;
  }

  async exec(providerId: string, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const workspace = this.workspaceFor(providerId);
    const cwd = opts.cwd ?? workspace;
    const started = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        env: { PATH: process.env.PATH ?? '', ...opts.env },
        timeout: (opts.timeoutSeconds ?? 120) * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        exitCode: 0,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? String(err),
        durationMs: Date.now() - started,
      };
    }
  }
}
