import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';
import { FleetsService } from '../services/fleets.service';

export const FLEET_ORCHESTRATE_QUEUE = 'fleet-orchestrate';

interface FleetOrchestratePayload {
  fleetId: string;
}

/**
 * Schedule a single orchestrator tick for a fleet.
 * Uses singletonKey so duplicate enqueues for the same fleet are deduplicated.
 * FleetsService never calls this — queue consumer owns re-scheduling.
 */
export async function scheduleFleetOrchestrator(boss: PgBoss, fleetId: string): Promise<void> {
  await boss.send(
    FLEET_ORCHESTRATE_QUEUE,
    { fleetId },
    { singletonKey: `fleet-${fleetId}`, retryLimit: 0, expireInSeconds: 60 },
  );
}

export async function registerFleetOrchestrateWorker(
  boss: PgBoss,
  db: Database,
  log: Logger,
): Promise<void> {
  await boss.createQueue(FLEET_ORCHESTRATE_QUEUE);
  const fleetsService = new FleetsService(db, boss, log);

  await boss.work<FleetOrchestratePayload>(
    FLEET_ORCHESTRATE_QUEUE,
    { batchSize: 2 },
    async (batch) => {
      for (const item of batch) {
        const { fleetId } = item.data;
        log.info({ fleetId }, 'fleet-orchestrate: tick');
        const result = await fleetsService.runOrchestratorTick(fleetId);

        // Queue consumer owns re-scheduling — service has no knowledge of pg-boss
        if (result === 'continue') {
          setTimeout(() => {
            scheduleFleetOrchestrator(boss, fleetId).catch((err) => {
              log.warn({ err, fleetId }, 'failed to re-schedule fleet orchestrator');
            });
          }, 30_000);
        }
      }
    },
  );
}
