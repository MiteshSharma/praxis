import { env } from './env';
import { createLogger, initTelemetry, onShutdown } from '@shared/telemetry';

initTelemetry(`backend:${env.MODE}`);
const log = createLogger(`backend:${env.MODE}`);

type Handle = { stop: () => Promise<void> };

async function main(): Promise<void> {
  const handles: Handle[] = [];

  if (env.MODE === 'control-plane' || env.MODE === 'all') {
    const { startControlPlane } = await import('./control-plane/start');
    handles.push(await startControlPlane());
    log.info({ port: env.PORT }, 'control-plane role started');
  }

  if (env.MODE === 'worker' || env.MODE === 'all') {
    const { startWorker } = await import('./worker/start');
    handles.push(await startWorker());
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
