import type { TaskSource } from '../task-source';

/**
 * Splits the single web textarea into title + description.
 * First line → title; everything after → description (or null).
 */
export function splitWebInput(raw: string): { title: string; description: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('empty input');

  const newlineIdx = trimmed.indexOf('\n');
  if (newlineIdx === -1) {
    return { title: trimmed, description: null };
  }

  const title = trimmed.slice(0, newlineIdx).trim();
  const description = trimmed.slice(newlineIdx + 1).trim() || null;
  return { title, description };
}

export class WebTaskSource implements TaskSource {
  readonly name = 'web' as const;
}
