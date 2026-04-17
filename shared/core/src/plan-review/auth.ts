import { SignJWT, jwtVerify } from 'jose';

/**
 * Short-lived HS256 JWTs used for external plan-review callbacks.
 *
 * External systems (webhooks, Slack, etc.) receive a signed token in the
 * plan-review notification payload. They forward it back via
 * POST /plan-review/respond to approve/revise/reject without needing
 * a user session.
 *
 * TTL matches the conversation's planHoldHours so tokens expire when the
 * hold does.
 */

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function mintCallbackToken(
  jobId: string,
  secret: string,
  holdHours: number,
): Promise<string> {
  return new SignJWT({ jobId, purpose: 'plan-review-callback' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${holdHours}h`)
    .sign(getSecret(secret));
}

export async function verifyCallbackToken(
  token: string,
  secret: string,
): Promise<{ jobId: string }> {
  const { payload } = await jwtVerify(token, getSecret(secret));
  if (typeof payload.jobId !== 'string') throw new Error('invalid token: missing jobId');
  if (payload.purpose !== 'plan-review-callback') throw new Error('invalid token: wrong purpose');
  return { jobId: payload.jobId };
}
