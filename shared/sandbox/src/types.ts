export interface CreateSandboxOptions {
  jobId: string;
  env?: Record<string, string>;
}

export interface SandboxInfo {
  id: string;
  providerId: string;
  endpoint: string;
  createdAt: Date;
  /** Absolute path to the workspace on the host. Populated by LocalSandboxProvider. */
  workspacePath?: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxProvider {
  create(opts: CreateSandboxOptions): Promise<SandboxInfo>;
  destroy(providerId: string): Promise<void>;
  healthCheck(info: SandboxInfo): Promise<boolean>;
  exec(providerId: string, command: string, opts?: ExecOptions): Promise<ExecResult>;
}
