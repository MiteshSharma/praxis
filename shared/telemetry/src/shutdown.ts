import { getTelemetrySdk } from './otel';

type Handler = () => Promise<void> | void;

const handlers: Handler[] = [];
let installed = false;
let shuttingDown = false;

export function onShutdown(fn: Handler): void {
  handlers.push(fn);
  if (!installed) {
    installed = true;
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const sig of signals) {
      process.on(sig, () => {
        void runShutdown(sig);
      });
    }
  }
}

async function runShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const grace = Number(process.env.SHUTDOWN_GRACE_MS ?? 15000);
  const timer = setTimeout(() => {
    process.exit(1);
  }, grace);
  timer.unref();

  try {
    for (const fn of handlers.reverse()) {
      try {
        await fn();
      } catch {
        // best-effort
      }
    }
    const sdk = getTelemetrySdk();
    if (sdk) {
      try {
        await sdk.shutdown();
      } catch {
        // ignore
      }
    }
  } finally {
    clearTimeout(timer);
    process.exit(signal === 'SIGINT' ? 130 : 0);
  }
}
