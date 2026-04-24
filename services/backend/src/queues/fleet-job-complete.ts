import type { Database } from '@shared/db';
import type { Logger } from '@shared/telemetry';
import type PgBoss from 'pg-boss';
import { FleetsService } from '../services/fleets.service';

export const FLEET_JOB_COMPLETE_QUEUE = 'fleet-job-complete';

interface FleetJobCompletePayload {
  fleetJobId: string;
  jobId: string;
}

export function registerFleetJobCompleteWorker(boss: PgBoss, db: Database, log: Logger): void {
  const fleetsService = new FleetsService(db, boss, log);

  boss.work<FleetJobCompletePayload>(FLEET_JOB_COMPLETE_QUEUE, { batchSize: 5 }, async (batch) => {
    for (const item of batch) {
      const { fleetJobId, jobId } = item.data;
      log.info({ fleetJobId, jobId }, 'fleet-job-complete: processing');
      await fleetsService.onJobComplete(fleetJobId, jobId);
    }
  });
}
