import { type Database, repoMemories } from '@shared/db';
import { storage, StorageNotConfiguredError } from '@shared/storage';
import { eq } from 'drizzle-orm';
import { InvalidMemoryFormatError, validateMemoryFormat } from './validator';

const MEMORY_KEY = (repoKey: string) =>
  `memory/${repoKey.replace(/\//g, '_')}/MEMORY.md`;

/** Hard ceiling — prevents runaway growth from injecting too many tokens into the plan prompt. */
export const MAX_MEMORY_BYTES = 32_768; // 32 KB ≈ 8 K tokens

export { InvalidMemoryFormatError };

export class MemoryTooLargeError extends Error {
  constructor(actual: number, limit: number) {
    super(
      `memory file is ${actual} bytes; limit is ${limit} bytes — condense entries before saving`,
    );
    this.name = 'MemoryTooLargeError';
  }
}

export async function loadMemoryFile(db: Database, repoKey: string): Promise<string | null> {
  const row = await db.query.repoMemories.findFirst({
    where: eq(repoMemories.repoKey, repoKey),
  });
  if (!row) return null;
  try {
    return await storage.getObjectAsString(row.contentUri);
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return null;
    throw err;
  }
}

export async function saveMemoryFile(
  db: Database,
  repoKey: string,
  markdown: string,
): Promise<{ sizeBytes: number; entryCount: number }> {
  const sizeBytes = Buffer.byteLength(markdown, 'utf-8');
  if (sizeBytes > MAX_MEMORY_BYTES) {
    throw new MemoryTooLargeError(sizeBytes, MAX_MEMORY_BYTES);
  }

  const validation = validateMemoryFormat(markdown);
  if (!validation.ok) {
    throw new InvalidMemoryFormatError(validation.errors);
  }

  const contentUri = MEMORY_KEY(repoKey);
  await storage.putObject(contentUri, markdown, 'text/markdown');

  const entryCount = validation.entryCount;

  await db
    .insert(repoMemories)
    .values({ repoKey, contentUri, sizeBytes, entryCount, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: repoMemories.repoKey,
      set: { contentUri, sizeBytes, entryCount, updatedAt: new Date() },
    });

  return { sizeBytes, entryCount };
}

export function EMPTY_MEMORY_TEMPLATE(repoKey: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `# Repository Memory: ${repoKey}

Last updated: ${today}
Total entries: 0

## Conventions

Established patterns this repo uses. New code should follow these.

## Architecture

Higher-level system structure decisions.

## Tech debt

Things that work but should be improved. Don't fix unless asked.

## Decisions

Past architectural decisions worth remembering, often with rationale.
`;
}
