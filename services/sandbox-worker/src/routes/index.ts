import type { Hono } from 'hono';
import type { AgentService } from '../services/agent.service';
import type { ExecService } from '../services/exec.service';
import type { PublishService } from '../services/publish.service';
import { abortRoutes } from './abort';
import { execRoutes } from './exec';
import { healthRoutes } from './health';
import { promptRoutes } from './prompt';
import { publishRoutes } from './publish';

interface RouteDeps {
  agentService: AgentService;
  execService: ExecService;
  publishService: PublishService;
}

export function registerRoutes(app: Hono, deps: RouteDeps): void {
  healthRoutes(app);
  promptRoutes(app, deps.agentService);
  execRoutes(app, deps.execService);
  publishRoutes(app, deps.publishService);
  abortRoutes(app, deps.agentService);
}
