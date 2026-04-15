import { os } from '@orpc/server';
import { z } from 'zod';

export const router = {
  health: os
    .output(z.object({ ok: z.boolean(), service: z.string() }))
    .handler(async () => ({ ok: true, service: 'backend' })),
};

export type Router = typeof router;
