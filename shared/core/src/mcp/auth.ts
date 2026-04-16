import { SignJWT, jwtVerify } from 'jose';

/**
 * Short-lived HS256 JWTs used for sandbox-worker → control-plane MCP calls.
 *
 * The secret lives only in the backend service env. The sandbox-worker treats
 * the token as opaque — it receives it in the /prompt body and forwards it
 * unchanged as `Authorization: Bearer <token>` on every MCP tool call.
 *
 * TTL is 30 minutes, which comfortably covers long plan sessions.
 */

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function mintMcpToken(jobId: string, secret: string): Promise<string> {
  return new SignJWT({ jobId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(getSecret(secret));
}

export async function verifyMcpToken(
  token: string,
  secret: string,
): Promise<{ jobId: string }> {
  const { payload } = await jwtVerify(token, getSecret(secret));
  if (typeof payload.jobId !== 'string') {
    throw new Error('invalid token: missing jobId');
  }
  return { jobId: payload.jobId };
}
