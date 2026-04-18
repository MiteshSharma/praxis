import type { ExecInput, ExecResult } from '../dto/exec.dto';

export type { ExecInput, ExecResult };

export interface IExecService {
  run(input: ExecInput): Promise<ExecResult>;
}
