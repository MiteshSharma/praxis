import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecInput, ExecResult } from '../dto/exec.dto';

export type { ExecInput, ExecResult };

const execAsync = promisify(execCb);

export class ExecService {
  async run(input: ExecInput): Promise<ExecResult> {
    const started = Date.now();
    try {
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: input.cwd,
        env: { PATH: process.env.PATH ?? '', ...input.env },
        timeout: (input.timeoutSeconds ?? 120) * 1000,
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
