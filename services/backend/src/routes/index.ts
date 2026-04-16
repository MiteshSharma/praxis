import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type { Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { registerOpenApi } from '../plugins/openapi';
import { JobsService } from '../services/jobs.service';
import { healthRoutes } from './health';
import { rpcRoutes } from './rpc';
import { sseRoutes } from './sse';

export interface RoutesDeps {
  db: Database;
  boss: PgBoss;
  log: Logger;
}

/**
 * Composes every HTTP route the control-plane serves. Mirrors the
 * `registerRoutes(app)` pattern from the reference backend.
 */
export async function registerRoutes(app: Hono, deps: RoutesDeps): Promise<void> {
  const jobsService = new JobsService(deps.db, deps.boss, deps.log);

  healthRoutes(app);
  sseRoutes(app);
  rpcRoutes(app, { jobsService });
  await registerOpenApi(app);
}
