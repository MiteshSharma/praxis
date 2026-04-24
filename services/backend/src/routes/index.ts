import { memoryBackendRegistry, secretBackendRegistry } from '@shared/core';
import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type { Hono } from 'hono';
import type PgBoss from 'pg-boss';
import { registerSlackChannel } from '../channels/slack.channel';
import { registerMcpRoutes } from '../control-plane/mcp/submit-plan';
import { env } from '../lib/env';
import { registerOpenApi } from '../plugins/openapi';
import { registerSlackProcess } from '../queues/slack-process';
import { JobsRepository } from '../repositories/jobs.repository';
import { MemoriesRepository } from '../repositories/memories.repository';
import { PlatformConfigsRepository } from '../repositories/platform-configs.repository';
import { ProviderConfigsRepository } from '../repositories/provider-configs.repository';
import { SettingsRepository } from '../repositories/settings.repository';
import { AgentsService } from '../services/agents.service';
import { ChannelsService } from '../services/channels.service';
import { CostsService } from '../services/costs.service';
import { FleetsService } from '../services/fleets.service';
import { JobsService } from '../services/jobs.service';
import { MemoriesService } from '../services/memories.service';
import { PlansService } from '../services/plans.service';
import { PlatformConfigsService } from '../services/platform-configs.service';
import { PluginsService } from '../services/plugins.service';
import { ProviderConfigsService } from '../services/provider-configs.service';
import { SessionsService } from '../services/sessions.service';
import { SettingsService } from '../services/settings.service';
import { WorkflowsService } from '../services/workflows.service';
import { auditRoutes } from './audit';
import { healthRoutes } from './health';
import { planReviewRoutes } from './plan-review';
import { publicMcpRoutes } from './public-mcp';
import { rpcRoutes } from './rpc';
import { slackRoutes } from './slack';
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

  const memoriesRepo = new MemoriesRepository(deps.db);

  const jobsService = new JobsService(deps.db, deps.boss, deps.log);
  const plansService = new PlansService(deps.db, deps.boss, deps.log, env.REDIS_URL);
  const workflowsService = new WorkflowsService(deps.db);
  const agentsService = new AgentsService(deps.db);
  const sessionsService = new SessionsService(deps.db, deps.boss, deps.log);
  const pluginsService = new PluginsService(deps.db);
  const memoriesService = new MemoriesService(memoriesRepo, memoryBackend);
  const channelsService = new ChannelsService(deps.db);
  const costsService = new CostsService(deps.db);
  const secretBackend = secretBackendRegistry.create(env.SECRET_BACKEND, { db: deps.db });
  const providerConfigsService = new ProviderConfigsService(
    new ProviderConfigsRepository(deps.db),
    secretBackend,
  );
  const platformConfigsService = new PlatformConfigsService(
    new PlatformConfigsRepository(deps.db),
    secretBackend,
  );
  const settingsRepo = new SettingsRepository(deps.db);
  const settingsService = new SettingsService(settingsRepo);
  const fleetsService = new FleetsService(deps.db, deps.boss, deps.log);
  const jobsRepo = new JobsRepository(deps.db);

  // Register Slack channel into the PraxisChannel registry (for dispatchToConversation)
  registerSlackChannel(deps.db, secretBackend);

  healthRoutes(app);
  sseRoutes(app);
  auditRoutes(app, deps.db);
  publicMcpRoutes(app, {
    jobsService,
    plansService,
    workflowsService,
    agentsService,
    sessionsService,
    memoriesService,
  });
  registerMcpRoutes(app, {
    db: deps.db,
    log: deps.log,
    mcpSecret: env.MCP_SHARED_SECRET,
    memoryBackend,
  });
  if (env.MCP_SHARED_SECRET) {
    planReviewRoutes(app, { plansService, mcpSecret: env.MCP_SHARED_SECRET });
  }
  slackRoutes(app, { boss: deps.boss, platformConfigsService, log: deps.log });
  rpcRoutes(app, {
    jobsService,
    plansService,
    workflowsService,
    agentsService,
    sessionsService,
    pluginsService,
    memoriesService,
    channelsService,
    costsService,
    providerConfigsService,
    platformConfigsService,
    settingsService,
    fleetsService,
  });

  // Start Slack async event processor
  await registerSlackProcess(deps.boss, {
    db: deps.db,
    jobsService,
    plansService,
    sessionsService,
    platformConfigsService,
    settingsRepo,
    jobsRepo,
    log: deps.log,
  });

  await registerOpenApi(app);
}
