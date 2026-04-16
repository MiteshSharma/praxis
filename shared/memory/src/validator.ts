const HEADER_RE = /^# Repository Memory: \S+/m;
const SECTIONS = ['Conventions', 'Architecture', 'Tech debt', 'Decisions'] as const;
const ENTRY_TAGGED_RE = /^- \[(high|medium|low)\] .+ \(job:[a-z0-9]{8}\)$/;
const ENTRY_DATED_RE = /^- \d{4}-\d{2}-\d{2}: .+ \(job:[a-z0-9]{8}\)$/;

/** Hard limit per section. Prevents any section from becoming a dumping ground. */
export const SECTION_ENTRY_LIMIT = 20;

/** Warn threshold surfaced in the learning agent's system prompt. */
export const SECTION_PRUNE_THRESHOLD = 15;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  entryCount: number;
  entryCountBySection: Record<string, number>;
}

export class InvalidMemoryFormatError extends Error {
  constructor(public readonly errors: string[]) {
    super(`invalid memory format: ${errors.join('; ')}`);
    this.name = 'InvalidMemoryFormatError';
  }
}

export function validateMemoryFormat(markdown: string): ValidationResult {
  const errors: string[] = [];
  const entryCountBySection: Record<string, number> = {};

  if (!HEADER_RE.test(markdown)) {
    errors.push('missing or malformed "# Repository Memory: <repo>" header');
  }

  // Find each section header and record its position
  const sectionPositions: Record<string, number> = {};
  for (const section of SECTIONS) {
    const idx = markdown.indexOf(`## ${section}`);
    if (idx === -1) errors.push(`missing section "## ${section}"`);
    else sectionPositions[section] = idx;
  }

  // Verify sections appear in canonical order
  const positions = SECTIONS.map((s) => sectionPositions[s]).filter((p) => p !== undefined);
  if (positions.length === SECTIONS.length) {
    for (let i = 1; i < positions.length; i++) {
      if ((positions[i] as number) < (positions[i - 1] as number)) {
        errors.push('sections are not in canonical order');
        break;
      }
    }
  }

  // Validate entry format and count per section
  let entryCount = 0;
  for (let i = 0; i < SECTIONS.length; i++) {
    const section = SECTIONS[i] as (typeof SECTIONS)[number];
    const start = sectionPositions[section];
    if (start === undefined) continue;
    const end =
      i + 1 < SECTIONS.length
        ? (sectionPositions[SECTIONS[i + 1] as (typeof SECTIONS)[number]] ?? markdown.length)
        : markdown.length;
    const slice = markdown.substring(start, end);

    const lines = slice.split('\n').filter((l) => l.startsWith('- '));
    let sectionCount = 0;

    for (const line of lines) {
      const matchesTagged = ENTRY_TAGGED_RE.test(line);
      const matchesDated = ENTRY_DATED_RE.test(line);

      if (section === 'Decisions') {
        if (!matchesDated) errors.push(`Decisions entry malformed: ${line}`);
      } else {
        if (!matchesTagged) errors.push(`${section} entry malformed: ${line}`);
      }

      if (matchesTagged || matchesDated) {
        entryCount++;
        sectionCount++;
      }
    }

    entryCountBySection[section] = sectionCount;

    if (sectionCount > SECTION_ENTRY_LIMIT) {
      errors.push(
        `"${section}" has ${sectionCount} entries; limit is ${SECTION_ENTRY_LIMIT}. ` +
          `Merge near-duplicates or remove low-confidence entries before adding new ones.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, entryCount, entryCountBySection };
}
