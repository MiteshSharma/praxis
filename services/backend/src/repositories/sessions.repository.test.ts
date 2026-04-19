import { describe, it, expect } from 'vitest';
import {
  toSessionDto,
  toMessageDto,
  toPluginDto,
} from './sessions.repository';

// ── DTO converter tests ───────────────────────────────────────────────────────
// These are pure functions — no mocking needed.

describe('toSessionDto', () => {
  const row = {
    id: 'conv-1',
    title: 'My Session',
    defaultGithubUrl: 'https://github.com/owner/repo',
    defaultWorkflowId: 'wf-1',
    planHoldHours: 48,
    model: 'claude-sonnet-4-6',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
  };

  it('maps all fields correctly', () => {
    const dto = toSessionDto(row as never);
    expect(dto.id).toBe('conv-1');
    expect(dto.title).toBe('My Session');
    expect(dto.defaultGithubUrl).toBe('https://github.com/owner/repo');
    expect(dto.defaultWorkflowId).toBe('wf-1');
    expect(dto.planHoldHours).toBe(48);
    expect(dto.model).toBe('claude-sonnet-4-6');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('preserves null model as null', () => {
    const dto = toSessionDto({ ...row, model: null } as never);
    expect(dto.model).toBeNull();
  });

  it('preserves null defaultGithubUrl', () => {
    const dto = toSessionDto({ ...row, defaultGithubUrl: null } as never);
    expect(dto.defaultGithubUrl).toBeNull();
  });

  it('converts dates to ISO strings', () => {
    const dto = toSessionDto(row as never);
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('toMessageDto', () => {
  const row = {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'Fix the login bug',
    jobId: 'job-1',
    metadata: { source: 'web' },
    createdAt: new Date('2026-01-15T12:00:00Z'),
  };

  it('maps all fields correctly', () => {
    const dto = toMessageDto(row as never);
    expect(dto.id).toBe('msg-1');
    expect(dto.sessionId).toBe('conv-1');
    expect(dto.role).toBe('user');
    expect(dto.content).toBe('Fix the login bug');
    expect(dto.jobId).toBe('job-1');
    expect(dto.metadata).toEqual({ source: 'web' });
    expect(dto.createdAt).toBe('2026-01-15T12:00:00.000Z');
  });

  it('preserves null jobId', () => {
    const dto = toMessageDto({ ...row, jobId: null } as never);
    expect(dto.jobId).toBeNull();
  });

  it('uses empty object for null metadata', () => {
    const dto = toMessageDto({ ...row, metadata: null } as never);
    expect(dto.metadata).toEqual({});
  });

  it('converts createdAt to ISO string', () => {
    const dto = toMessageDto(row as never);
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('toPluginDto', () => {
  const row = {
    id: 'plugin-1',
    conversationId: 'conv-1',
    name: 'my-plugin',
    transport: 'stdio',
    command: 'node plugin.js',
    url: null,
    env: { API_KEY: 'secret' },
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('maps all fields correctly', () => {
    const dto = toPluginDto(row as never);
    expect(dto.id).toBe('plugin-1');
    expect(dto.sessionId).toBe('conv-1');
    expect(dto.name).toBe('my-plugin');
    expect(dto.transport).toBe('stdio');
    expect(dto.command).toBe('node plugin.js');
    expect(dto.url).toBeNull();
    expect(dto.env).toEqual({ API_KEY: 'secret' });
    expect(dto.enabled).toBe(true);
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('uses empty object for null env', () => {
    const dto = toPluginDto({ ...row, env: null } as never);
    expect(dto.env).toEqual({});
  });
});
