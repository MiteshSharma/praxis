import { describe, it, expect } from 'vitest';
import { toWorkflowDto, toWorkflowVersionDto } from './workflows.repository';

// ── Pure DTO converter tests ───────────────────────────────────────────────────

const workflowVersionRow = {
  id: 'wfver-1',
  workflowId: 'wf-1',
  version: 1,
  source: 'form',
  contentUri: 'form:1234567890',
  definition: { steps: [{ kind: 'plan', name: 'Plan step' }] },
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const workflowRow = {
  id: 'wf-1',
  name: 'My Workflow',
  description: 'Does coding tasks',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
};

describe('toWorkflowVersionDto', () => {
  it('maps all fields correctly', () => {
    const dto = toWorkflowVersionDto(workflowVersionRow as never);
    expect(dto.id).toBe('wfver-1');
    expect(dto.workflowId).toBe('wf-1');
    expect(dto.version).toBe(1);
    expect(dto.source).toBe('form');
    expect(dto.contentUri).toBe('form:1234567890');
    expect(dto.definition).toEqual({ steps: [{ kind: 'plan', name: 'Plan step' }] });
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('converts createdAt to ISO string', () => {
    const dto = toWorkflowVersionDto(workflowVersionRow as never);
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('toWorkflowDto', () => {
  it('maps all fields correctly with a latestVersion', () => {
    const dto = toWorkflowDto(workflowRow as never, workflowVersionRow as never);
    expect(dto.id).toBe('wf-1');
    expect(dto.name).toBe('My Workflow');
    expect(dto.description).toBe('Does coding tasks');
    expect(dto.latestVersion).not.toBeNull();
    expect(dto.latestVersion!.id).toBe('wfver-1');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('sets latestVersion to null when no version provided', () => {
    const dto = toWorkflowDto(workflowRow as never, null);
    expect(dto.latestVersion).toBeNull();
  });

  it('converts dates to ISO strings', () => {
    const dto = toWorkflowDto(workflowRow as never, null);
    expect(dto.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('latestVersion embeds the full version DTO', () => {
    const dto = toWorkflowDto(workflowRow as never, workflowVersionRow as never);
    expect(dto.latestVersion?.contentUri).toBe('form:1234567890');
    expect(dto.latestVersion?.definition).toEqual(workflowVersionRow.definition);
  });
});
