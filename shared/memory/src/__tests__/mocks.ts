import { vi } from 'vitest';
import type { StorageClient } from '@shared/storage';

// ── StorageClient ─────────────────────────────────────────────────────────────

export function createMockStorageClient(
  store: Record<string, string> = {},
): StorageClient & {
  getObjectAsString: ReturnType<typeof vi.fn>;
  putObject: ReturnType<typeof vi.fn>;
  deleteObject: ReturnType<typeof vi.fn>;
} {
  const data = { ...store };
  return {
    getObjectAsString: vi.fn().mockImplementation((key: string) => {
      if (key in data) return Promise.resolve(data[key]);
      return Promise.reject(new Error(`storage: key not found: ${key}`));
    }),
    putObject: vi.fn().mockImplementation((key: string, body: string) => {
      data[key] = body;
      return Promise.resolve();
    }),
    deleteObject: vi.fn().mockImplementation((key: string) => {
      delete data[key];
      return Promise.resolve();
    }),
  };
}
