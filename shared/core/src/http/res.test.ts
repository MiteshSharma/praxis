import { describe, expect, it } from 'vitest';
import { res } from './res';

describe('res.json', () => {
  it('returns 200 with JSON body when called as res.json(body)', async () => {
    const response = res.json({ hello: 'world' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ hello: 'world' });
  });

  it('returns the given status with JSON body when called as res.json(statusCode, body)', async () => {
    const response = res.json(201, { created: true });
    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ created: true });
  });
});
