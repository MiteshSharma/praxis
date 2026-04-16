import { describe, expect, it } from 'vitest';
import { res } from './res';

describe('res.json(body)', () => {
  it('defaults status to 200', () => {
    const response = res.json({ ok: true });
    expect(response.status).toBe(200);
  });

  it('sets Content-Type to application/json', () => {
    const response = res.json({ ok: true });
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('serialises the body as JSON', async () => {
    const body = { message: 'hello', count: 42 };
    const response = res.json(body);
    expect(await response.json()).toEqual(body);
  });
});

describe('res.json(statusCode, body)', () => {
  it('honours the provided status code', () => {
    const response = res.json(201, { id: 1 });
    expect(response.status).toBe(201);
  });

  it('sets Content-Type to application/json', () => {
    const response = res.json(201, { id: 1 });
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('serialises the body as JSON', async () => {
    const body = { id: 1, name: 'test' };
    const response = res.json(201, body);
    expect(await response.json()).toEqual(body);
  });
});
