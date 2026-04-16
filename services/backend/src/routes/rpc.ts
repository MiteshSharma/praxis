import { implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { contract } from '@shared/contracts';
import type { Hono } from 'hono';
import type { JobsService } from '../services/jobs.service';

interface RpcDeps {
  jobsService: JobsService;
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

  const router = {
    health,
    jobs: {
      create: jobsCreate,
      get: jobsGet,
      list: jobsList,
      listArtifacts: jobsListArtifacts,
    },
  };

  const handler = new RPCHandler(router);
  app.use('/rpc/*', async (c, next) => {
    const { matched, response } = await handler.handle(c.req.raw, { prefix: '/rpc' });
    if (matched) return response;
    return next();
  });
}
