import { vi } from 'vitest';
import type { JobDto, PlanDto } from '@shared/contracts';
import type { JobsRepository } from '../repositories/jobs.repository';
import type { PlansRepository } from '../repositories/plans.repository';

// ── JobsRepository ────────────────────────────────────────────────────────────

export function createMockJobsRepository(
  defaults: Partial<{
    findById: ReturnType<JobsRepository['findById']> extends Promise<infer T> ? T : never;
    findMany: JobDto[];
  }> = {},
): {
  findById: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findStepsByJobId: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  findArtifactsByJobId: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn().mockResolvedValue(defaults.findById ?? undefined),
    findMany: vi.fn().mockResolvedValue(defaults.findMany ?? []),
    findStepsByJobId: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    findArtifactsByJobId: vi.fn().mockResolvedValue([]),
  };
}

// ── PlansRepository ───────────────────────────────────────────────────────────

export function createMockPlansRepository(defaults: {
  findLatestForJob?: PlanDto;
  findAllForJob?: PlanDto[];
} = {}) {
  return {
    findById: vi.fn().mockResolvedValue(undefined),
    findLatestForJob: vi.fn().mockResolvedValue(defaults.findLatestForJob ?? undefined),
    findAllForJob: vi.fn().mockResolvedValue(defaults.findAllForJob ?? []),
  };
}

// ── TaskIngestService stub ─────────────────────────────────────────────────────

export function createMockTaskIngestService(jobId = 'job-1') {
  return {
    ingest: vi.fn().mockResolvedValue({ id: jobId }),
  };
}

// ── pg-boss ───────────────────────────────────────────────────────────────────

export function createMockBoss() {
  return {
    send: vi.fn().mockResolvedValue('boss-id'),
    subscribe: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Redis ─────────────────────────────────────────────────────────────────────

export function createMockRedis() {
  return {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Logger ────────────────────────────────────────────────────────────────────

export function createMockLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}
