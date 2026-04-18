import { describe, it, expect, vi } from 'vitest';
import {
  loadMemoryFile,
  saveMemoryFile,
  EMPTY_MEMORY_TEMPLATE,
  MemoryTooLargeError,
  MAX_MEMORY_BYTES,
} from './memory-file';
import { InvalidMemoryFormatError } from './validator';
import { StorageNotConfiguredError } from '@shared/storage';
import { createMockStorageClient } from './__tests__/mocks';

// ── Minimal DB stub ──────────────────────────────────────────────────────────

function makeDb(row: { contentUri: string } | null = { contentUri: 'memory/owner_repo/MEMORY.md' }) {
  return {
    query: {
      repoMemories: {
        findFirst: vi.fn().mockResolvedValue(row),
      },
    },
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  } as never;
}

const VALID_MARKDOWN = `# Repository Memory: owner/repo

Last updated: 2026-01-01
Total entries: 1

## Conventions

- [high] Use tabs for indentation. (job:abc12345)

## Architecture

## Tech debt

## Decisions
`;

describe('loadMemoryFile', () => {
  it('returns null when no db row exists', async () => {
    const db = makeDb(null);
    const result = await loadMemoryFile(db, 'owner/repo');
    expect(result).toBeNull();
  });

  it('returns content from storage when row exists', async () => {
    const db = makeDb();
    const store = createMockStorageClient({
      'memory/owner_repo/MEMORY.md': VALID_MARKDOWN,
    });
    const result = await loadMemoryFile(db, 'owner/repo', store);
    expect(result).toBe(VALID_MARKDOWN);
  });

  it('returns null when StorageNotConfiguredError is thrown', async () => {
    const db = makeDb();
    const store = createMockStorageClient();
    store.getObjectAsString.mockRejectedValue(new StorageNotConfiguredError());
    const result = await loadMemoryFile(db, 'owner/repo', store);
    expect(result).toBeNull();
  });

  it('rethrows other storage errors', async () => {
    const db = makeDb();
    const store = createMockStorageClient();
    store.getObjectAsString.mockRejectedValue(new Error('network timeout'));
    await expect(loadMemoryFile(db, 'owner/repo', store)).rejects.toThrow('network timeout');
  });
});

describe('saveMemoryFile', () => {
  it('throws MemoryTooLargeError when content exceeds limit', async () => {
    const db = makeDb();
    const store = createMockStorageClient();
    const huge = 'x'.repeat(MAX_MEMORY_BYTES + 1);
    await expect(saveMemoryFile(db, 'owner/repo', huge, store)).rejects.toBeInstanceOf(
      MemoryTooLargeError,
    );
  });

  it('throws InvalidMemoryFormatError for malformed markdown', async () => {
    const db = makeDb();
    const store = createMockStorageClient();
    await expect(
      saveMemoryFile(db, 'owner/repo', 'not valid memory format', store),
    ).rejects.toBeInstanceOf(InvalidMemoryFormatError);
  });

  it('puts content to storage under correct key', async () => {
    const db = makeDb();
    const store = createMockStorageClient();
    await saveMemoryFile(db, 'owner/repo', VALID_MARKDOWN, store);
    expect(store.putObject).toHaveBeenCalledWith(
      'memory/owner_repo/MEMORY.md',
      VALID_MARKDOWN,
      'text/markdown',
    );
  });

  it('returns sizeBytes and entryCount', async () => {
    const db = makeDb();
    const store = createMockStorageClient();
    const result = await saveMemoryFile(db, 'owner/repo', VALID_MARKDOWN, store);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.entryCount).toBeGreaterThanOrEqual(1);
  });

  it('uses _ to replace / in storage key for repo key', async () => {
    const db = makeDb({ contentUri: 'memory/org_nested_repo/MEMORY.md' });
    const store = createMockStorageClient();
    await saveMemoryFile(db, 'org/nested/repo', VALID_MARKDOWN, store);
    expect(store.putObject).toHaveBeenCalledWith(
      expect.stringContaining('memory/org_nested_repo/MEMORY.md'),
      expect.any(String),
      expect.any(String),
    );
  });
});

describe('EMPTY_MEMORY_TEMPLATE', () => {
  it('includes the repo key in the heading', () => {
    const tmpl = EMPTY_MEMORY_TEMPLATE('acme/widget');
    expect(tmpl).toContain('acme/widget');
  });

  it('passes format validation', async () => {
    const { validateMemoryFormat } = await import('./validator');
    const result = validateMemoryFormat(EMPTY_MEMORY_TEMPLATE('owner/repo'));
    expect(result.ok).toBe(true);
  });
});
