import type { TaskSource } from '../task-source';

/**
 * Splits the single web textarea into title + description.
 * First line → title; full input → description (so agents see the complete text).
 */
export function splitWebInput(raw: string): { title: string; description: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('empty input');

  const newlineIdx = trimmed.indexOf('\n');
  const title = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx).trim();
  return { title, description: trimmed };
}

export class WebTaskSource implements TaskSource {
  readonly name = 'web' as const;
}
