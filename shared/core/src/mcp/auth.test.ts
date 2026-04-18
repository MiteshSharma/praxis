import { describe, it, expect } from 'vitest';
import { mintMcpToken, verifyMcpToken } from './auth';

const SECRET = 'test-secret-that-is-at-least-32-chars-long';

describe('mintMcpToken', () => {
  it('produces a non-empty JWT string', async () => {
    const token = await mintMcpToken('job-abc', SECRET);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('embeds jobId in the payload', async () => {
    const token = await mintMcpToken('job-xyz', SECRET);
    const { jobId } = await verifyMcpToken(token, SECRET);
    expect(jobId).toBe('job-xyz');
  });

  it('tokens for different jobIds are different', async () => {
    const a = await mintMcpToken('job-A', SECRET);
    const b = await mintMcpToken('job-B', SECRET);
    expect(a).not.toBe(b);
  });
});

describe('verifyMcpToken', () => {
  it('returns jobId for a valid token', async () => {
    const token = await mintMcpToken('job-verify-test', SECRET);
    const result = await verifyMcpToken(token, SECRET);
    expect(result.jobId).toBe('job-verify-test');
  });

  it('throws on tampered signature', async () => {
    const token = await mintMcpToken('job-1', SECRET);
    const parts = token.split('.');
    // Corrupt the signature
    parts[2] = parts[2]!.slice(0, -4) + 'XXXX';
    const tampered = parts.join('.');
    await expect(verifyMcpToken(tampered, SECRET)).rejects.toThrow();
  });

  it('throws when verified with wrong secret', async () => {
    const token = await mintMcpToken('job-1', SECRET);
    await expect(verifyMcpToken(token, 'wrong-secret-that-is-at-least-32-chars')).rejects.toThrow();
  });

  it('throws for an expired token', async () => {
    // Create a JWT that expired in the past — we use the jose library's exp in the past
    // We can do this by minting a real token and then verifying with a fake-clock offset.
    // Instead, use an obviously malformed token with exp in the past via manual construction.
    // The simplest approach: generate a valid token and wait is too slow, so just verify
    // the rejection message covers the expiry path by modifying payload.
    const { SignJWT } = await import('jose');
    const expiredToken = await new SignJWT({ jobId: 'job-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1s') // already expired
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyMcpToken(expiredToken, SECRET)).rejects.toThrow();
  });

  it('throws when jobId is missing from payload', async () => {
    const { SignJWT } = await import('jose');
    const noJobIdToken = await new SignJWT({ someOtherField: 'value' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyMcpToken(noJobIdToken, SECRET)).rejects.toThrow('missing jobId');
  });

  it('throws when jobId is not a string', async () => {
    const { SignJWT } = await import('jose');
    const numericJobIdToken = await new SignJWT({ jobId: 42 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyMcpToken(numericJobIdToken, SECRET)).rejects.toThrow('missing jobId');
  });
});
