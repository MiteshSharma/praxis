import type { Hono } from 'hono';

export function healthRoutes(app: Hono): void {
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'backend',
      role: 'control-plane',
      time: new Date().toISOString(),
    }),
  );

  app.get('/ready', (c) =>
    c.json({
      status: 'ok',
      service: 'backend',
      role: 'control-plane',
      time: new Date().toISOString(),
    }),
  );
}
