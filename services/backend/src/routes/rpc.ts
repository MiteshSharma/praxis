import { ORPCError, implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { contract } from '@shared/contracts';
import type { Hono } from 'hono';
import type { AgentsService } from '../services/agents.service';
import type { ConversationsService } from '../services/conversations.service';
import type { JobsService } from '../services/jobs.service';
import { MemoriesService } from '../services/memories.service';
import type { PlansService } from '../services/plans.service';
import type { ChannelsService } from '../services/channels.service';
import type { PluginsService } from '../services/plugins.service';
import type { WorkflowsService } from '../services/workflows.service';

interface RpcDeps {
  jobsService: JobsService;
  plansService: PlansService;
  workflowsService: WorkflowsService;
  agentsService: AgentsService;
  conversationsService: ConversationsService;
  pluginsService: PluginsService;
  memoriesService: MemoriesService;
  channelsService: ChannelsService;
}

/**
 * Implements the oRPC contract and mounts it at `/rpc/*`. Handlers are
 * intentionally thin — they parse input, delegate to a service, and return.
 */
export function rpcRoutes(app: Hono, deps: RpcDeps): void {
  const os = implement(contract);

  const health = os.health.handler(() => ({ ok: true, service: 'backend' }));

  const jobsCreate = os.jobs.create.handler(({ input }) => deps.jobsService.create(input));
  const jobsGet = os.jobs.get.handler(({ input }) => deps.jobsService.getById(input.jobId));
  const jobsList = os.jobs.list.handler(({ input }) => deps.jobsService.list(input?.limit ?? 50));
  const jobsListArtifacts = os.jobs.listArtifacts.handler(({ input }) =>
    deps.jobsService.listArtifacts(input.jobId),
  );
  const jobsListSteps = os.jobs.listSteps.handler(({ input }) =>
    deps.jobsService.listSteps(input.jobId),
  );
  const jobsRestart = os.jobs.restart.handler(({ input }) =>
    deps.jobsService.restart(input.jobId),
  );
  const jobsDelete = os.jobs.delete.handler(async ({ input }) => {
    await deps.jobsService.delete(input.jobId);
    return { ok: true };
  });
  const jobsResumeFromPlan = os.jobs.resumeFromPlan.handler(({ input }) =>
    deps.jobsService.resumeFromPlan(input.jobId),
  );

  const jobsGetLatestPlan = os.jobs.getLatestPlan.handler(({ input }) =>
    deps.plansService.getLatestPlan(input.jobId),
  );
  const jobsListPlans = os.jobs.listPlans.handler(({ input }) =>
    deps.plansService.listPlans(input.jobId),
  );
  const jobsApprovePlan = os.jobs.approvePlan.handler(async ({ input }) => {
    await deps.plansService.approvePlan(input.jobId);
    return { ok: true };
  });
  const jobsRevisePlan = os.jobs.revisePlan.handler(async ({ input }) => {
    await deps.plansService.revisePlan(input.jobId, input.answers, input.additionalFeedback);
    return { ok: true };
  });
  const jobsRejectPlan = os.jobs.rejectPlan.handler(async ({ input }) => {
    await deps.plansService.rejectPlan(input.jobId, input.reason);
    return { ok: true };
  });

  const workflowsList = os.workflows.list.handler(({ input }) =>
    deps.workflowsService.list(input?.limit ?? 50),
  );
  const workflowsGet = os.workflows.get.handler(({ input }) =>
    deps.workflowsService.getById(input.id),
  );
  const workflowsCreate = os.workflows.create.handler(({ input }) =>
    deps.workflowsService.create(input),
  );
  const workflowsUpdate = os.workflows.update.handler(({ input }) =>
    deps.workflowsService.update(input),
  );

  const agentsList = os.agents.list.handler(({ input }) =>
    deps.agentsService.list(input?.limit ?? 50, input?.kind),
  );
  const agentsGet = os.agents.get.handler(({ input }) =>
    deps.agentsService.getById(input.id),
  );
  const agentsCreate = os.agents.create.handler(({ input }) =>
    deps.agentsService.create(input),
  );
  const agentsDelete = os.agents.delete.handler(async ({ input }) => {
    await deps.agentsService.delete(input.id);
    return { ok: true };
  });
  const agentsListSkills = os.agents.listSkills.handler(({ input }) =>
    deps.agentsService.listSkills(input.agentId),
  );
  const agentsAttachSkill = os.agents.attachSkill.handler(async ({ input }) => {
    await deps.agentsService.attachSkill(input.agentId, input.skillId, input.position);
    return { ok: true };
  });
  const agentsDetachSkill = os.agents.detachSkill.handler(async ({ input }) => {
    await deps.agentsService.detachSkill(input.agentId, input.skillId);
    return { ok: true };
  });

  const conversationsList = os.conversations.list.handler(({ input }) =>
    deps.conversationsService.list(input?.limit ?? 50),
  );
  const conversationsGet = os.conversations.get.handler(({ input }) =>
    deps.conversationsService.getById(input.id),
  );
  const conversationsCreate = os.conversations.create.handler(({ input }) =>
    deps.conversationsService.create(input),
  );
  const conversationsUpdate = os.conversations.update.handler(({ input }) => {
    const { id, ...patch } = input;
    return deps.conversationsService.update(id, patch);
  });
  const conversationsDelete = os.conversations.delete.handler(async ({ input }) => {
    await deps.conversationsService.delete(input.id);
    return { ok: true };
  });
  const conversationsSendMessage = os.conversations.sendMessage.handler(({ input }) =>
    deps.conversationsService.sendMessage(input),
  );
  const conversationsListMessages = os.conversations.listMessages.handler(({ input }) =>
    deps.conversationsService.listMessages(input.conversationId, input.limit ?? 20, input.before),
  );

  const pluginsList = os.plugins.list.handler(({ input }) =>
    deps.pluginsService.list(input.conversationId),
  );
  const pluginsCreate = os.plugins.create.handler(({ input }) =>
    deps.pluginsService.create(input),
  );
  const pluginsToggle = os.plugins.toggle.handler(({ input }) =>
    deps.pluginsService.toggle(input.id, input.enabled),
  );
  const pluginsDelete = os.plugins.delete.handler(async ({ input }) => {
    await deps.pluginsService.delete(input.id);
    return { ok: true };
  });

  const channelsList = os.channels.list.handler(({ input }) =>
    deps.channelsService.list(input.conversationId),
  );
  const channelsCreate = os.channels.create.handler(({ input }) =>
    deps.channelsService.create(input),
  );
  const channelsToggle = os.channels.toggle.handler(({ input }) =>
    deps.channelsService.toggle(input.id, input.enabled),
  );
  const channelsDelete = os.channels.delete.handler(async ({ input }) => {
    await deps.channelsService.delete(input.id);
    return { ok: true };
  });

  const memoriesListRepos = os.memories.listRepos.handler(() =>
    deps.memoriesService.listRepos(),
  );
  const memoriesGet = os.memories.get.handler(({ input }) =>
    deps.memoriesService.get(input.repoKey),
  );
  const memoriesUpdate = os.memories.update.handler(async ({ input }) => {
    try {
      return await deps.memoriesService.update(input.repoKey, input.content);
    } catch (err) {
      if (MemoriesService.isValidationError(err)) {
        throw new ORPCError('BAD_REQUEST', { message: err.message });
      }
      throw err;
    }
  });
  const memoriesDelete = os.memories.delete.handler(async ({ input }) => {
    await deps.memoriesService.delete(input.repoKey);
    return { ok: true };
  });

  const router = {
    health,
    jobs: {
      create: jobsCreate,
      get: jobsGet,
      list: jobsList,
      listArtifacts: jobsListArtifacts,
      listSteps: jobsListSteps,
      restart: jobsRestart,
      delete: jobsDelete,
      resumeFromPlan: jobsResumeFromPlan,
      getLatestPlan: jobsGetLatestPlan,
      listPlans: jobsListPlans,
      approvePlan: jobsApprovePlan,
      revisePlan: jobsRevisePlan,
      rejectPlan: jobsRejectPlan,
    },
    workflows: {
      list: workflowsList,
      get: workflowsGet,
      create: workflowsCreate,
      update: workflowsUpdate,
    },
    agents: {
      list: agentsList,
      get: agentsGet,
      create: agentsCreate,
      delete: agentsDelete,
      listSkills: agentsListSkills,
      attachSkill: agentsAttachSkill,
      detachSkill: agentsDetachSkill,
    },
    conversations: {
      list: conversationsList,
      get: conversationsGet,
      create: conversationsCreate,
      update: conversationsUpdate,
      delete: conversationsDelete,
      sendMessage: conversationsSendMessage,
      listMessages: conversationsListMessages,
    },
    memories: {
      listRepos: memoriesListRepos,
      get: memoriesGet,
      update: memoriesUpdate,
      delete: memoriesDelete,
    },
    plugins: {
      list: pluginsList,
      create: pluginsCreate,
      toggle: pluginsToggle,
      delete: pluginsDelete,
    },
    channels: {
      list: channelsList,
      create: channelsCreate,
      toggle: channelsToggle,
      delete: channelsDelete,
    },
  };

  const handler = new RPCHandler(router);
  app.use('/rpc/*', async (c, next) => {
    const { matched, response } = await handler.handle(c.req.raw, { prefix: '/rpc' });
    if (matched) return response;
    return next();
  });
}
