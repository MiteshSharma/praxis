import { Redis } from 'ioredis';

/**
 * Minimal Redis-stream-backed job chunk channel.
 *
 * Every job has a stream at `stream:job:{jobId}`. Producers XADD events,
 * consumers XREAD BLOCK with `lastId` to resume after a disconnect. TTL is
 * refreshed to 24 hours on every write so abandoned streams expire.
 */
const STREAM_TTL_SECONDS = 60 * 60 * 24;

export interface JobChunk {
  id: string;
  data: unknown;
}

let redisClient: Redis | undefined;

function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    redisClient = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = undefined;
  }
}

function streamKey(jobId: string): string {
  return `stream:job:${jobId}`;
}

export async function publishJobChunk(jobId: string, data: unknown): Promise<string> {
  const key = streamKey(jobId);
  const redis = getRedis();
  const id = await redis.xadd(key, '*', 'data', JSON.stringify(data));
  await redis.expire(key, STREAM_TTL_SECONDS);
  return id ?? '0';
}

/**
 * Tail a job's stream, yielding chunks as they arrive. Resumes from
 * `lastId` (exclusive). Terminates when `signal` aborts.
 */
export async function* subscribeJobStream(
  jobId: string,
  opts: { lastId?: string; signal?: AbortSignal } = {},
): AsyncGenerator<JobChunk, void, void> {
  const key = streamKey(jobId);
  const redis = getRedis().duplicate();
  let lastId = opts.lastId ?? '0';

  try {
    while (!opts.signal?.aborted) {
      const result = (await redis.xread('BLOCK', 5000, 'STREAMS', key, lastId)) as
        | [string, [string, string[]][]][]
        | null;

      if (!result) continue;

      for (const [, entries] of result) {
        for (const [id, fields] of entries) {
          lastId = id;
          // fields alternates [key, value, key, value]
          const idx = fields.indexOf('data');
          if (idx === -1 || idx + 1 >= fields.length) continue;
          const rawValue = fields[idx + 1];
          if (typeof rawValue !== 'string') continue;
          let data: unknown;
          try {
            data = JSON.parse(rawValue);
          } catch {
            data = rawValue;
          }
          yield { id, data };
        }
      }
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }
}
