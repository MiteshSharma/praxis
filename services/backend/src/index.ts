import { createLogger, initTelemetry, onShutdown } from '@shared/telemetry';
import { env } from './lib/env';

initTelemetry(`backend:${env.MODE}`);
const log = createLogger(`backend:${env.MODE}`);

type Handle = { stop: () => Promise<void> };

async function main(): Promise<void> {
  const handles: Handle[] = [];

  if (env.MODE === 'control-plane' || env.MODE === 'all') {
    const { buildControlPlane } = await import('./control-plane');
    handles.push(await buildControlPlane());
    log.info({ port: env.PORT }, 'control-plane role started');
  }

  if (env.MODE === 'worker' || env.MODE === 'all') {
    const { buildWorker } = await import('./worker');
    handles.push(await buildWorker());
    log.info({ healthPort: env.WORKER_HEALTH_PORT }, 'worker role started');
  }

  onShutdown(async () => {
    await Promise.all(handles.map((h) => h.stop()));
    log.info('backend shutdown complete');
  });
}

main().catch((err) => {
  log.fatal({ err }, 'backend failed to start');
  process.exit(1);
});
