import { describe, expect, it } from 'vitest';
import { SECTION_ENTRY_LIMIT, validateMemoryFormat } from './validator';

const VALID_MEMORY = `# Repository Memory: github.com/user/repo

Last updated: 2024-01-01
Total entries: 2

## Conventions

- [high] Use TypeScript strict mode (job:abc12345)

## Architecture

- [medium] Services communicate via oRPC contracts (job:def67890)

## Tech debt

## Decisions

- 2024-01-01: Chose Postgres over MySQL for JSONB support (job:abc12345)
`;

describe('validateMemoryFormat', () => {
  it('accepts a valid memory file', () => {
    const result = validateMemoryFormat(VALID_MEMORY);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.entryCount).toBe(3);
  });

  it('reports missing header', () => {
    const bad = VALID_MEMORY.replace(/^# Repository Memory.*$/m, '# Wrong Header');
    const result = validateMemoryFormat(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('header'))).toBe(true);
  });

  it('reports missing section', () => {
    const bad = VALID_MEMORY.replace('## Tech debt', '');
    const result = validateMemoryFormat(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Tech debt'))).toBe(true);
  });

  it('reports malformed Conventions entry (missing severity tag)', () => {
    const bad = VALID_MEMORY.replace(
      '- [high] Use TypeScript strict mode (job:abc12345)',
      '- Use TypeScript strict mode (job:abc12345)',
    );
    const result = validateMemoryFormat(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Conventions entry malformed'))).toBe(true);
  });

  it('reports malformed Decisions entry (missing date prefix)', () => {
    const bad = VALID_MEMORY.replace(
      '- 2024-01-01: Chose Postgres over MySQL for JSONB support (job:abc12345)',
      '- Chose Postgres over MySQL for JSONB support (job:abc12345)',
    );
    const result = validateMemoryFormat(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Decisions entry malformed'))).toBe(true);
  });

  it('reports section over entry limit', () => {
    const entries = Array.from(
      { length: SECTION_ENTRY_LIMIT + 1 },
      (_, i) => `- [low] Entry ${i} (job:abc12345)`,
    ).join('\n');
    const markdown = `# Repository Memory: github.com/user/repo

## Conventions

${entries}

## Architecture

## Tech debt

## Decisions
`;
    const result = validateMemoryFormat(markdown);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('limit is'))).toBe(true);
  });

  it('counts entries per section correctly', () => {
    const result = validateMemoryFormat(VALID_MEMORY);
    expect(result.entryCountBySection['Conventions']).toBe(1);
    expect(result.entryCountBySection['Architecture']).toBe(1);
    expect(result.entryCountBySection['Tech debt']).toBe(0);
    expect(result.entryCountBySection['Decisions']).toBe(1);
  });
});
