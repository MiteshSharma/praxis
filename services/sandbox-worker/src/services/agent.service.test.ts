import { describe, it, expect, beforeEach } from 'vitest';
import { AgentService } from './agent.service';

describe('AgentService session management', () => {
  let svc: AgentService;

  beforeEach(() => {
    svc = new AgentService();
  });

  it('starts with no active sessions', () => {
    expect(svc.getActiveSessions().size).toBe(0);
  });

  it('createSession returns an AbortController and registers it', () => {
    const ctrl = svc.createSession('sess-1');
    expect(ctrl).toBeInstanceOf(AbortController);
    expect(svc.getActiveSessions().has('sess-1')).toBe(true);
  });

  it('deleteSession removes the session', () => {
    svc.createSession('sess-1');
    svc.deleteSession('sess-1');
    expect(svc.getActiveSessions().has('sess-1')).toBe(false);
  });

  it('sessions are isolated between AgentService instances', () => {
    const svc2 = new AgentService();
    svc.createSession('sess-A');
    svc2.createSession('sess-B');

    expect(svc.getActiveSessions().has('sess-A')).toBe(true);
    expect(svc.getActiveSessions().has('sess-B')).toBe(false);
    expect(svc2.getActiveSessions().has('sess-A')).toBe(false);
    expect(svc2.getActiveSessions().has('sess-B')).toBe(true);
  });

  it('overwriting a sessionId replaces the controller', () => {
    const first = svc.createSession('sess-1');
    const second = svc.createSession('sess-1');
    expect(second).not.toBe(first);
    expect(svc.getActiveSessions().get('sess-1')).toBe(second);
  });
});
