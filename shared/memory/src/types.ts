/**
 * What a memory backend returns when asked for context for a specific job.
 * `content` is injected verbatim into the plan-session system prompt.
 */
export interface MemoryContext {
  /** Markdown to inject into the plan prompt. */
  content: string;
  /** Where it came from — used in logs and timeline events. */
  source: 'full' | 'fts' | 'vector' | 'hybrid' | 'honcho' | 'qmd';
  /** True when the backend filtered a larger set down to this content. */
  truncated: boolean;
}

/**
 * A memory backend owns both sides of the memory lifecycle for a repo:
 *   1. loadForJob  — called during the preparing phase, before the plan agent starts
 *   2. save        — called after the learning pass completes
 *
 * The `query` parameter on loadForJob is the job title + description.
 * Simple backends (S3) ignore it and return the full file.
 * Search-capable backends (Builtin, QMD, Honcho) use it to return
 * only the most relevant chunks.
 */
export interface MemoryBackend {
  loadForJob(repoKey: string, query: string): Promise<MemoryContext | null>;
  save(repoKey: string, markdown: string): Promise<{ sizeBytes: number; entryCount: number }>;
}
