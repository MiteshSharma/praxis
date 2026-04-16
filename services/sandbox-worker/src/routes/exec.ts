import type { Hono } from 'hono';
import { ExecInputSchema } from '../dto/exec.dto';
import { validateBody } from '../middleware/validate';
import type { ExecService } from '../services/exec.service';

export function execRoutes(app: Hono, execService: ExecService): void {
  app.post('/exec', validateBody(ExecInputSchema), async (c) => {
    // Safe: validateBody already rejected invalid payloads
    const input = ExecInputSchema.parse(await c.req.json());
    const result = await execService.run(input);
    return c.json(result);
  });
}
