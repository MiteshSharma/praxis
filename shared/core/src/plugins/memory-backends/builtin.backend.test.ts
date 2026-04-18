import { describe, it, expect, vi } from 'vitest';
import { InvalidMemoryFormatError } from '@shared/memory';

// Trigger self-registration and capture the registry — done once at module load.
await import('./builtin.backend.js');
const { memoryBackendRegistry } = await import('./registry.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_MEMORY = `# Repository Memory: github.com/owner/repo

Last updated: 2026-01-01
Total entries: 2

## Conventions

- [high] Use dependency injection. (job:aabbccdd)
- [medium] Prefer functional patterns. (job:11223344)

## Architecture

## Tech debt

## Decisions
`;

// ── DB mock helpers ───────────────────────────────────────────────────────────

function makeTx() {
  return {
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

function makeDb(overrides: {
  repoMemoriesRow?: { content: string } | null;
  ftsRows?: Array<{ chunk_index: number; content: string }>;
} = {}) {
  const tx = makeTx();
  return {
    execute: vi.fn().mockResolvedValue(overrides.ftsRows ?? []),
    query: {
      repoMemories: {
        findFirst: vi.fn().mockResolvedValue(
          overrides.repoMemoriesRow !== undefined ? overrides.repoMemoriesRow : null,
        ),
      },
    },
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

function createBackend(db: ReturnType<typeof makeDb>) {
  return memoryBackendRegistry.create('builtin', { db });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BuiltinMemoryBackend.loadForJob', () => {
  it('returns null when no FTS results and no repo_memories row', async () => {
    const db = makeDb({ ftsRows: [], repoMemoriesRow: null });
    const backend = createBackend(db);
    const result = await backend.loadForJob('github.com/owner/repo', 'query');
    expect(result).toBeNull();
  });

  it('returns FTS results when rows match query', async () => {
    const db = makeDb({
      ftsRows: [
        { chunk_index: 1, content: 'second chunk' },
        { chunk_index: 0, content: 'first chunk' },
      ],
    });
    const backend = createBackend(db);
    const result = await backend.loadForJob('github.com/owner/repo', 'dependency injection');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('fts');
    expect(result!.truncated).toBe(true);
    // Chunks are sorted by chunk_index before joining
    expect(result!.content).toMatch(/first chunk[\s\S]*second chunk/);
  });

  it('returns full content fallback when query is empty string', async () => {
    const db = makeDb({ ftsRows: [], repoMemoriesRow: { content: VALID_MEMORY } });
    const backend = createBackend(db);
    const result = await backend.loadForJob('github.com/owner/repo', '');
    expect(result!.source).toBe('full');
    expect(result!.truncated).toBe(false);
    expect(result!.content).toBe(VALID_MEMORY);
  });

  it('returns full content when query is whitespace only', async () => {
    const db = makeDb({ ftsRows: [], repoMemoriesRow: { content: VALID_MEMORY } });
    const backend = createBackend(db);
    const result = await backend.loadForJob('github.com/owner/repo', '   ');
    expect(result!.source).toBe('full');
  });

  it('returns null when repo_memories row has no content', async () => {
    const db = makeDb({ ftsRows: [], repoMemoriesRow: null });
    const backend = createBackend(db);
    const result = await backend.loadForJob('github.com/owner/repo', '');
    expect(result).toBeNull();
  });
});

describe('BuiltinMemoryBackend.save', () => {
  it('throws InvalidMemoryFormatError for invalid markdown', async () => {
    const backend = createBackend(makeDb());
    await expect(backend.save('github.com/owner/repo', 'not valid memory')).rejects.toThrow(
      InvalidMemoryFormatError,
    );
  });

  it('runs everything in a transaction', async () => {
    const db = makeDb();
    const backend = createBackend(db);
    await backend.save('github.com/owner/repo', VALID_MEMORY.trim());
    expect(db.transaction).toHaveBeenCalled();
  });

  it('returns sizeBytes and entryCount on success', async () => {
    const db = makeDb();
    const backend = createBackend(db);
    const result = await backend.save('github.com/owner/repo', VALID_MEMORY.trim());
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.entryCount).toBe(2);
  });

  it('deletes existing chunks before inserting new ones', async () => {
    const db = makeDb();
    const backend = createBackend(db);
    await backend.save('github.com/owner/repo', VALID_MEMORY.trim());
    expect(db._tx.delete).toHaveBeenCalled();
  });
});

describe('chunkMarkdown (via save)', () => {
  it('small memory produces at least one chunk', async () => {
    const db = makeDb();
    const backend = createBackend(db);
    await backend.save('github.com/owner/repo', VALID_MEMORY.trim());
    // insert was called (chunks + upsert)
    expect(db._tx.insert).toHaveBeenCalled();
  });

  it('large section is split at entry boundaries without throwing', async () => {
    // Validator caps entries per section at 20; use long entries to exceed 1600-char limit.
    const longEntryText = 'x'.repeat(120);
    const entries = Array.from({ length: 16 }, (_, i) =>
      `- [low] ${longEntryText} entry-${i}. (job:aabb${String(i).padStart(4, '0')})`,
    ).join('\n');
    const largeMemory = `# Repository Memory: github.com/large/repo

Last updated: 2026-01-01
Total entries: 16

## Conventions

${entries}

## Architecture

## Tech debt

## Decisions
`;
    const db = makeDb();
    const backend = createBackend(db);
    const result = await backend.save('github.com/large/repo', largeMemory.trim());
    expect(result.entryCount).toBe(16);
  });
});
