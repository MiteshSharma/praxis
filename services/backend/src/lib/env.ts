import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load .env.local from the repo root if present. Node 24's built-in loader.
for (const file of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      // ignore — already loaded or unsupported
    }
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MODE: z.enum(['control-plane', 'worker', 'all']).default('all'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3101),
  LOG_LEVEL: z.string().default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  /** Shared secret for signing MCP JWTs (HS256). At least 32 chars. */
  MCP_SHARED_SECRET: z.string().min(32).optional(),
  /** Where the sandbox-worker calls submit_plan. Optional in dev. */
  CONTROL_PLANE_MCP_URL: z.string().url().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid backend environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
