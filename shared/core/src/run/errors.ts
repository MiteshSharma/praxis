/**
 * Provider error classification for the step-runner retry loop.
 *
 * Implements a 5-layer classification pipeline inspired by the Hermes agent
 * error_classifier.py. The key insight is that the retry loop should check
 * action flags (retryable, shouldCompress) rather than reason strings — this
 * keeps the retry loop stable when new reason codes are added.
 */

export type ErrorReason =
  | 'auth'
  | 'billing'
  | 'rate_limit'
  | 'context_overflow'
  | 'overloaded'
  | 'server_error'
  | 'timeout'
  | 'model_not_found'
  | 'format_error'
  | 'unknown';

export interface ClassifiedError {
  reason: ErrorReason;
  /** Whether the same request should be retried (possibly after a delay). */
  retryable: boolean;
  /** Whether context compression should be triggered before retrying. */
  shouldCompress: boolean;
  message: string;
  statusCode?: number;
}

// ── Pattern sets ────────────────────────────────────────────────────────────

const BILLING_PATTERNS = [
  'insufficient credits',
  'insufficient_credits',
  'credit balance',
  'billing',
  'payment required',
  'quota exceeded',
  'billing_not_active',
  'insufficient_quota',
  'out of credits',
];

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'ratelimit',
  'too many requests',
  'resource_exhausted',
  'throttled',
  'requests per',
  'tokens per',
];

// Transient signals that turn a 402 billing hit into a retryable rate-limit event
const USAGE_LIMIT_PATTERNS = ['usage limit', 'daily limit', 'monthly limit'];
const USAGE_LIMIT_TRANSIENT_SIGNALS = ['try again', 'resets at', 'retry', 'window', 'resets in'];

const CONTEXT_OVERFLOW_PATTERNS = [
  'context_length_exceeded',
  'maximum context length',
  'context window',
  'too many tokens',
  'prompt is too long',
  'input is too long',
  'reduce the length',
];

const MODEL_NOT_FOUND_PATTERNS = [
  'model not found',
  'model_not_found',
  'does not exist',
  'no such model',
  'invalid model',
];

const AUTH_PATTERNS = [
  'invalid api key',
  'invalid_api_key',
  'authentication',
  'unauthorized',
  'api key',
  'permission denied',
  'access denied',
];

// Transport-level error class names that indicate a timeout / network blip
const TRANSPORT_ERROR_NAMES = new Set([
  'ReadTimeoutError',
  'ConnectTimeoutError',
  'TimeoutError',
  'FetchError',
  'AbortError',
  'NetworkError',
  'APIConnectionError',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function lower(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

/** Walk the error cause chain looking for an HTTP status code (up to 5 levels). */
function extractStatusCode(err: unknown): number | undefined {
  let current: unknown = err;
  let depth = 0;
  while (current && typeof current === 'object' && depth < 5) {
    const obj = current as Record<string, unknown>;
    const code = obj.status ?? obj.statusCode ?? obj.status_code;
    if (typeof code === 'number') return code;
    current = obj.cause;
    depth++;
  }
  return undefined;
}

/** Extract an error code string from the response body (e.g. Anthropic/OpenAI error.code). */
function extractErrorCode(err: unknown): string {
  const obj = err as Record<string, unknown> | null;
  if (!obj) return '';
  // Anthropic: { error: { type: string } }
  const errorBody = obj.error as Record<string, unknown> | null;
  if (errorBody) {
    const type = `${lower(errorBody.type)} ${lower(errorBody.code)}`;
    return type;
  }
  return `${lower(obj.code)} ${lower(obj.type)}`;
}

/** Disambiguate HTTP 402: billing exhaustion vs transient usage quota. */
function classify402(message: string): ClassifiedError {
  const isUsageLimit = matchesAny(message, USAGE_LIMIT_PATTERNS);
  const isTransient = matchesAny(message, USAGE_LIMIT_TRANSIENT_SIGNALS);
  if (isUsageLimit && isTransient) {
    // "Daily limit reached, resets in 5 minutes" → treat as rate_limit (retryable)
    return { reason: 'rate_limit', retryable: true, shouldCompress: false, message };
  }
  return { reason: 'billing', retryable: false, shouldCompress: false, message };
}

/** Classify a 400 response — could be context overflow, model not found, billing, or generic. */
function classify400(message: string, approxTokens?: number): ClassifiedError {
  if (matchesAny(message, CONTEXT_OVERFLOW_PATTERNS)) {
    return { reason: 'context_overflow', retryable: true, shouldCompress: true, message };
  }
  if (matchesAny(message, MODEL_NOT_FOUND_PATTERNS)) {
    return { reason: 'model_not_found', retryable: false, shouldCompress: false, message };
  }
  if (matchesAny(message, RATE_LIMIT_PATTERNS)) {
    return { reason: 'rate_limit', retryable: true, shouldCompress: false, message };
  }
  if (matchesAny(message, BILLING_PATTERNS)) {
    return { reason: 'billing', retryable: false, shouldCompress: false, message };
  }
  // Large session with generic 400 → likely context overflow
  if (approxTokens && approxTokens > 100_000) {
    return { reason: 'context_overflow', retryable: true, shouldCompress: true, message };
  }
  return {
    reason: 'format_error',
    retryable: false,
    shouldCompress: false,
    message,
    statusCode: 400,
  };
}

// ── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a provider API error into a structured `ClassifiedError`.
 *
 * Five-layer pipeline (priority order):
 *   1. Provider-specific patterns (thinking block signature errors, long-context tier)
 *   2. HTTP status code
 *   3. Error code from response body
 *   4. Message pattern matching
 *   5. Transport error heuristics
 *
 * @param err    The thrown error (any shape — we walk it defensively).
 * @param approxTokens  Approximate token count for the session (used for overflow heuristics).
 */
export function classifyProviderError(err: unknown, approxTokens?: number): ClassifiedError {
  const errObj = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  const message = lower(errObj.message ?? String(err));
  const statusCode = extractStatusCode(err);
  const errorCode = extractErrorCode(err);

  // ── Layer 1: Provider-specific patterns ──────────────────────────────────

  // Anthropic thinking block signature invalid (400 + "signature" + "thinking")
  if (statusCode === 400 && message.includes('signature') && message.includes('thinking')) {
    return { reason: 'format_error', retryable: true, shouldCompress: false, message, statusCode };
  }

  // Anthropic long-context tier gate (429 + "extra usage" + "long context")
  if (statusCode === 429 && message.includes('extra usage') && message.includes('long context')) {
    return { reason: 'rate_limit', retryable: true, shouldCompress: true, message, statusCode };
  }

  // ── Layer 2: HTTP status code ────────────────────────────────────────────

  if (statusCode !== undefined) {
    if (statusCode === 401) {
      return { reason: 'auth', retryable: false, shouldCompress: false, message, statusCode };
    }
    if (statusCode === 402) {
      return { ...classify402(message), statusCode };
    }
    if (statusCode === 404) {
      if (matchesAny(message, MODEL_NOT_FOUND_PATTERNS)) {
        return {
          reason: 'model_not_found',
          retryable: false,
          shouldCompress: false,
          message,
          statusCode,
        };
      }
      return { reason: 'unknown', retryable: false, shouldCompress: false, message, statusCode };
    }
    if (statusCode === 413) {
      return {
        reason: 'context_overflow',
        retryable: true,
        shouldCompress: true,
        message,
        statusCode,
      };
    }
    if (statusCode === 429) {
      return { reason: 'rate_limit', retryable: true, shouldCompress: false, message, statusCode };
    }
    if (statusCode === 400) {
      return { ...classify400(message, approxTokens), statusCode };
    }
    if (statusCode === 500 || statusCode === 502) {
      return {
        reason: 'server_error',
        retryable: true,
        shouldCompress: false,
        message,
        statusCode,
      };
    }
    if (statusCode === 503 || statusCode === 529) {
      return { reason: 'overloaded', retryable: true, shouldCompress: false, message, statusCode };
    }
    if (statusCode >= 400 && statusCode < 500) {
      return {
        reason: 'format_error',
        retryable: false,
        shouldCompress: false,
        message,
        statusCode,
      };
    }
  }

  // ── Layer 3: Error code from response body ───────────────────────────────

  if (errorCode) {
    if (errorCode.includes('resource_exhausted') || errorCode.includes('throttled')) {
      return { reason: 'rate_limit', retryable: true, shouldCompress: false, message };
    }
    if (errorCode.includes('insufficient_quota') || errorCode.includes('billing_not_active')) {
      return { reason: 'billing', retryable: false, shouldCompress: false, message };
    }
    if (errorCode.includes('context_length_exceeded')) {
      return { reason: 'context_overflow', retryable: true, shouldCompress: true, message };
    }
  }

  // ── Layer 4: Message pattern matching ────────────────────────────────────

  if (matchesAny(message, BILLING_PATTERNS)) {
    return { reason: 'billing', retryable: false, shouldCompress: false, message };
  }
  if (matchesAny(message, RATE_LIMIT_PATTERNS)) {
    return { reason: 'rate_limit', retryable: true, shouldCompress: false, message };
  }
  if (matchesAny(message, CONTEXT_OVERFLOW_PATTERNS)) {
    return { reason: 'context_overflow', retryable: true, shouldCompress: true, message };
  }
  if (matchesAny(message, AUTH_PATTERNS)) {
    return { reason: 'auth', retryable: false, shouldCompress: false, message };
  }

  // ── Layer 5: Transport error heuristics ──────────────────────────────────

  const errName = typeof errObj.name === 'string' ? errObj.name : (err?.constructor?.name ?? '');
  if (
    TRANSPORT_ERROR_NAMES.has(errName) ||
    message.includes('network') ||
    message.includes('socket')
  ) {
    // Server disconnect with large session → likely context overflow
    if (approxTokens && approxTokens > 80_000) {
      return { reason: 'context_overflow', retryable: true, shouldCompress: true, message };
    }
    return { reason: 'timeout', retryable: true, shouldCompress: false, message };
  }

  // Fallback: unknown but retryable with backoff
  return { reason: 'unknown', retryable: true, shouldCompress: false, message };
}

// ── Jittered backoff ─────────────────────────────────────────────────────────

/**
 * Exponential backoff with ±50% jitter to prevent thundering herd.
 *
 * Delay schedule (base=5, max=120):
 *   attempt 1: 5–7.5s   attempt 2: 10–15s
 *   attempt 3: 20–30s   attempt 4+: 40–60s  (capped at max)
 *
 * For rate_limit errors use base=30, max=300.
 */
export function jitteredBackoff(attempt: number, base = 5, max = 120): number {
  const delay = Math.min(base * 2 ** (attempt - 1), max);
  const jitter = Math.random() * 0.5 * delay;
  return delay + jitter;
}
