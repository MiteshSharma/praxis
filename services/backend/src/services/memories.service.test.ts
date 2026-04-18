import { describe, it, expect, vi } from 'vitest';
import { MemoriesService } from './memories.service';
import { createMockMemoryBackend } from '@shared/core/__tests__/mocks';
import { InvalidMemoryFormatError, MemoryTooLargeError } from '@shared/memory';

// ── DB helpers ────────────────────────────────────────────────────────────────

function makeRepoRow(overrides: Partial<{
  repoKey: string;
  sizeBytes: number;
  entryCount: number;
  contentUri: string;
  updatedAt: Date;
}> = {}) {
  return {
    repoKey: overrides.repoKey ?? 'owner/repo',
    sizeBytes: overrides.sizeBytes ?? 1024,
    entryCount: overrides.entryCount ?? 5,
    contentUri: overrides.contentUri ?? 'memory/owner_repo/MEMORY.md',
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01'),
  };
}

function makeDb(options: {
  repoRows?: ReturnType<typeof makeRepoRow>[];
  repoRow?: ReturnType<typeof makeRepoRow> | null;
} = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(options.repoRows ?? [makeRepoRow()]),
    query: {
      repoMemories: {
        findFirst: vi.fn().mockResolvedValue(options.repoRow !== undefined ? options.repoRow : makeRepoRow()),
      },
    },
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

// ── listRepos ─────────────────────────────────────────────────────────────────

describe('MemoriesService.listRepos', () => {
  it('returns mapped list of repos', async () => {
    const db = makeDb({
      repoRows: [
        makeRepoRow({ repoKey: 'owner/repo1', sizeBytes: 512, entryCount: 3 }),
        makeRepoRow({ repoKey: 'owner/repo2', sizeBytes: 1024, entryCount: 7 }),
      ],
    });
    const backend = createMockMemoryBackend();
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.listRepos();

    expect(result).toHaveLength(2);
    expect(result[0]!.repoKey).toBe('owner/repo1');
    expect(result[1]!.repoKey).toBe('owner/repo2');
  });

  it('converts updatedAt to ISO string', async () => {
    const date = new Date('2026-03-15T10:00:00Z');
    const db = makeDb({ repoRows: [makeRepoRow({ updatedAt: date })] });
    const backend = createMockMemoryBackend();
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.listRepos();
    expect(result[0]!.updatedAt).toBe('2026-03-15T10:00:00.000Z');
  });

  it('returns empty array when no repos', async () => {
    const db = makeDb({ repoRows: [] });
    const backend = createMockMemoryBackend();
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.listRepos();
    expect(result).toEqual([]);
  });
});

// ── get ───────────────────────────────────────────────────────────────────────

describe('MemoriesService.get', () => {
  it('returns null when no DB row exists', async () => {
    const db = makeDb({ repoRow: null });
    const backend = createMockMemoryBackend();
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.get('owner/repo');
    expect(result).toBeNull();
  });

  it('returns null when backend returns null for content', async () => {
    const db = makeDb();
    const backend = createMockMemoryBackend({ context: null });
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.get('owner/repo');
    expect(result).toBeNull();
  });

  it('returns combined row + content when both exist', async () => {
    const db = makeDb({ repoRow: makeRepoRow({ repoKey: 'owner/repo', sizeBytes: 200, entryCount: 2 }) });
    const backend = createMockMemoryBackend({
      context: { repoKey: 'owner/repo', content: '# Memory', jobTitle: '', timestamp: new Date() },
    });
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.get('owner/repo');
    expect(result).not.toBeNull();
    expect(result!.repoKey).toBe('owner/repo');
    expect(result!.content).toBe('# Memory');
    expect(result!.sizeBytes).toBe(200);
    expect(result!.entryCount).toBe(2);
  });

  it('updatedAt is ISO string', async () => {
    const date = new Date('2026-04-01T00:00:00Z');
    const db = makeDb({ repoRow: makeRepoRow({ updatedAt: date }) });
    const backend = createMockMemoryBackend({
      context: { repoKey: 'owner/repo', content: 'content', jobTitle: '', timestamp: new Date() },
    });
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.get('owner/repo');
    expect(result!.updatedAt).toBe('2026-04-01T00:00:00.000Z');
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe('MemoriesService.update', () => {
  it('delegates to memoryBackend.save and returns result', async () => {
    const db = makeDb();
    const backend = createMockMemoryBackend({
      saveResult: { sizeBytes: 400, entryCount: 4 },
    });
    const svc = new MemoriesService(db as never, backend);

    const result = await svc.update('owner/repo', '# Updated Memory');

    expect(backend.save).toHaveBeenCalledWith('owner/repo', '# Updated Memory');
    expect(result).toEqual({ sizeBytes: 400, entryCount: 4 });
  });
});

// ── isValidationError ─────────────────────────────────────────────────────────

describe('MemoriesService.isValidationError', () => {
  it('returns true for InvalidMemoryFormatError', () => {
    expect(MemoriesService.isValidationError(new InvalidMemoryFormatError(['bad']))).toBe(true);
  });

  it('returns true for MemoryTooLargeError', () => {
    expect(MemoriesService.isValidationError(new MemoryTooLargeError(40000, 32768))).toBe(true);
  });

  it('returns false for generic Error', () => {
    expect(MemoriesService.isValidationError(new Error('random'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(MemoriesService.isValidationError(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(MemoriesService.isValidationError('oops')).toBe(false);
  });
});

// ── delete ────────────────────────────────────────────────────────────────────

describe('MemoriesService.delete', () => {
  it('deletes from repoMemories and memoryChunks', async () => {
    const db = makeDb({ repoRow: makeRepoRow() });
    const backend = createMockMemoryBackend();
    const svc = new MemoriesService(db as never, backend);

    await svc.delete('owner/repo');

    // delete should be called twice (memoryChunks and repoMemories)
    expect(db.delete).toHaveBeenCalledTimes(2);
  });

  it('does not throw when repo row does not exist', async () => {
    const db = makeDb({ repoRow: null });
    const backend = createMockMemoryBackend();
    const svc = new MemoriesService(db as never, backend);

    await expect(svc.delete('missing/repo')).resolves.toBeUndefined();
  });
});
