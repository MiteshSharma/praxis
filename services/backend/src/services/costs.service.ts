import type { CostSummaryDto, DailyCostDto, RepoCostDto } from '@shared/contracts';
import type { Database } from '@shared/db';
import { CostsRepository } from '../repositories/costs.repository';

interface DateRange {
  from?: string;
  to?: string;
}

export class CostsService {
  private readonly repo: CostsRepository;

  constructor(db: Database) {
    this.repo = new CostsRepository(db);
  }

  summary(range?: DateRange): Promise<CostSummaryDto> {
    return this.repo.getSummary(range?.from, range?.to);
  }

  daily(range?: DateRange): Promise<DailyCostDto[]> {
    return this.repo.getDaily(range?.from, range?.to);
  }

  byRepo(range?: DateRange): Promise<RepoCostDto[]> {
    return this.repo.getByRepo(range?.from, range?.to);
  }
}
