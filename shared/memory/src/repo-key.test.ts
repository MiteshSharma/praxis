import { describe, expect, it } from 'vitest';
import { normalizeRepoKey } from './repo-key';

describe('normalizeRepoKey', () => {
  it('normalizes a plain HTTPS URL', () => {
    expect(normalizeRepoKey('https://github.com/User/Repo')).toBe('github.com/user/repo');
  });

  it('strips .git suffix', () => {
    expect(normalizeRepoKey('https://github.com/User/Repo.git')).toBe('github.com/user/repo');
  });

  it('strips inline credentials', () => {
    expect(normalizeRepoKey('https://x-access-token:TOKEN@github.com/User/Repo.git')).toBe(
      'github.com/user/repo',
    );
  });

  it('lowercases owner and repo', () => {
    expect(normalizeRepoKey('https://github.com/MiteshSharma/Praxis')).toBe(
      'github.com/miteshsharma/praxis',
    );
  });

  it('throws when URL has no owner/repo', () => {
    expect(() => normalizeRepoKey('https://github.com/')).toThrow('Cannot normalize repo URL');
  });

  it('throws when URL has only owner', () => {
    expect(() => normalizeRepoKey('https://github.com/owner')).toThrow('Cannot normalize repo URL');
  });
});
