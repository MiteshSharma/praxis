import { describe, it, expect } from 'vitest';
import { toAgentDto, toAgentVersionDto } from './agents.repository';

// ── Pure DTO converter tests ───────────────────────────────────────────────────

const agentVersionRow = {
  id: 'ver-1',
  agentId: 'agent-1',
  version: 1,
  source: 'form',
  contentUri: 'form:1234567890',
  definition: { model: 'claude-sonnet-4-6', systemPrompt: 'You are helpful.' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const agentRow = {
  id: 'agent-1',
  kind: 'agent',
  name: 'My Agent',
  description: 'Does things',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
};

describe('toAgentVersionDto', () => {
  it('maps all fields correctly', () => {
    const dto = toAgentVersionDto(agentVersionRow as never);
    expect(dto.id).toBe('ver-1');
    expect(dto.agentId).toBe('agent-1');
    expect(dto.version).toBe(1);
    expect(dto.source).toBe('form');
    expect(dto.contentUri).toBe('form:1234567890');
    expect(dto.definition).toEqual({ model: 'claude-sonnet-4-6', systemPrompt: 'You are helpful.' });
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('converts createdAt to ISO string', () => {
    const dto = toAgentVersionDto(agentVersionRow as never);
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('toAgentDto', () => {
  it('maps all fields correctly with a latestVersion', () => {
    const dto = toAgentDto(agentRow as never, agentVersionRow as never);
    expect(dto.id).toBe('agent-1');
    expect(dto.kind).toBe('agent');
    expect(dto.name).toBe('My Agent');
    expect(dto.description).toBe('Does things');
    expect(dto.latestVersion).not.toBeNull();
    expect(dto.latestVersion!.id).toBe('ver-1');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('sets latestVersion to null when no version provided', () => {
    const dto = toAgentDto(agentRow as never, null);
    expect(dto.latestVersion).toBeNull();
  });

  it('maps kind=skill correctly', () => {
    const skillRow = { ...agentRow, kind: 'skill' };
    const dto = toAgentDto(skillRow as never, null);
    expect(dto.kind).toBe('skill');
  });

  it('converts dates to ISO strings', () => {
    const dto = toAgentDto(agentRow as never, null);
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('latestVersion embeds the full version DTO', () => {
    const dto = toAgentDto(agentRow as never, agentVersionRow as never);
    expect(dto.latestVersion?.contentUri).toBe('form:1234567890');
    expect(dto.latestVersion?.definition).toEqual(agentVersionRow.definition);
  });
});
