import { describe, it, expect } from 'vitest';
import { mintCallbackToken, verifyCallbackToken } from './auth';

const SECRET = 'test-secret-that-is-at-least-32-chars-long';

describe('mintCallbackToken', () => {
  it('produces a valid JWT string', async () => {
    const token = await mintCallbackToken('job-abc', SECRET, 24);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('embeds jobId in payload', async () => {
    const token = await mintCallbackToken('job-xyz', SECRET, 1);
    const { jobId } = await verifyCallbackToken(token, SECRET);
    expect(jobId).toBe('job-xyz');
  });

  it('sets TTL based on holdHours', async () => {
    // Token minted with holdHours=1 should be verifiable immediately
    const token = await mintCallbackToken('job-1', SECRET, 1);
    await expect(verifyCallbackToken(token, SECRET)).resolves.toBeDefined();
  });

  it('tokens for different jobIds are different', async () => {
    const a = await mintCallbackToken('job-A', SECRET, 24);
    const b = await mintCallbackToken('job-B', SECRET, 24);
    expect(a).not.toBe(b);
  });
});

describe('verifyCallbackToken', () => {
  it('returns jobId for a valid token', async () => {
    const token = await mintCallbackToken('job-verify', SECRET, 24);
    const result = await verifyCallbackToken(token, SECRET);
    expect(result.jobId).toBe('job-verify');
  });

  it('throws on tampered signature', async () => {
    const token = await mintCallbackToken('job-1', SECRET, 24);
    const parts = token.split('.');
    parts[2] = parts[2]!.slice(0, -4) + 'XXXX';
    await expect(verifyCallbackToken(parts.join('.'), SECRET)).rejects.toThrow();
  });

  it('throws when verified with wrong secret', async () => {
    const token = await mintCallbackToken('job-1', SECRET, 24);
    await expect(
      verifyCallbackToken(token, 'wrong-secret-that-is-at-least-32-chars'),
    ).rejects.toThrow();
  });

  it('throws for an expired token', async () => {
    const { SignJWT } = await import('jose');
    const expired = await new SignJWT({ jobId: 'job-1', purpose: 'plan-review-callback' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyCallbackToken(expired, SECRET)).rejects.toThrow();
  });

  it('throws when purpose claim is missing', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ jobId: 'job-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyCallbackToken(token, SECRET)).rejects.toThrow('wrong purpose');
  });

  it('throws when purpose is a different value', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ jobId: 'job-1', purpose: 'mcp-auth' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyCallbackToken(token, SECRET)).rejects.toThrow('wrong purpose');
  });

  it('throws when jobId is missing', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ purpose: 'plan-review-callback' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyCallbackToken(token, SECRET)).rejects.toThrow('missing jobId');
  });

  it('throws when jobId is not a string', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ jobId: 42, purpose: 'plan-review-callback' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyCallbackToken(token, SECRET)).rejects.toThrow('missing jobId');
  });
});
