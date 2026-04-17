import { memoryBackendRegistry } from '@shared/core';
import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type { Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { registerMcpRoutes } from '../control-plane/mcp/submit-plan';
import { env } from '../lib/env';
import { registerOpenApi } from '../plugins/openapi';
import { AgentsService } from '../services/agents.service';
import { ConversationsService } from '../services/conversations.service';
import { JobsService } from '../services/jobs.service';
import { MemoriesService } from '../services/memories.service';
import { ChannelsService } from '../services/channels.service';
import { PlansService } from '../services/plans.service';
import { PluginsService } from '../services/plugins.service';
import { WorkflowsService } from '../services/workflows.service';
import { healthRoutes } from './health';
import { planReviewRoutes } from './plan-review';
import { rpcRoutes } from './rpc';
import { sseRoutes } from './sse';

export interface RoutesDeps {
  db: Database;
  boss: PgBoss;
  log: Logger;
}

/**
 * Composes every HTTP route the control-plane serves.
 */
export async function registerRoutes(app: Hono, deps: RoutesDeps): Promise<void> {
  const memoryBackend = memoryBackendRegistry.create(env.MEMORY_BACKEND, { db: deps.db });

  const jobsService = new JobsService(deps.db, deps.boss, deps.log);
  const plansService = new PlansService(deps.db, deps.boss, deps.log, env.REDIS_URL);
  const workflowsService = new WorkflowsService(deps.db);
  const agentsService = new AgentsService(deps.db);
  const conversationsService = new ConversationsService(deps.db, deps.boss, deps.log);
  const pluginsService = new PluginsService(deps.db);
  const memoriesService = new MemoriesService(deps.db, memoryBackend);
  const channelsService = new ChannelsService(deps.db);

  healthRoutes(app);
  sseRoutes(app);
  registerMcpRoutes(app, { db: deps.db, log: deps.log, mcpSecret: env.MCP_SHARED_SECRET, memoryBackend });
  if (env.MCP_SHARED_SECRET) {
    planReviewRoutes(app, { plansService, mcpSecret: env.MCP_SHARED_SECRET });
  }
  rpcRoutes(app, { jobsService, plansService, workflowsService, agentsService, conversationsService, pluginsService, memoriesService, channelsService });
  await registerOpenApi(app);
}
