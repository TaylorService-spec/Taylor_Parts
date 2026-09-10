// IN-MEMORY FAKE. Exercises every caller of `AssistantBusinessDataReader` with no GCP credential and
// no network -- exactly what the interface exists to make possible. Test-only; never imported by the
// composition root that serves real traffic.
import type {
  AccountPortfolioSummary,
  AssistantBusinessDataReader,
  AssistantBusinessScope,
  PerformanceGoalSummary,
  ReorderQueueItem,
  ServiceAttentionSummary,
  WorkOrderStatusCount,
} from "./assistantBusinessDataReader";

export interface InMemoryAssistantFixture {
  readonly serviceAttention?: ServiceAttentionSummary;
  readonly reorderQueue?: readonly ReorderQueueItem[];
  readonly workOrdersByStatus?: readonly WorkOrderStatusCount[];
  readonly goals?: readonly PerformanceGoalSummary[];
  readonly accountPortfolio?: AccountPortfolioSummary;
}

/**
 * Keyed by `${tenantId}:${principalUid}` so a test can prove two scopes never see each other's
 * fixture data -- the same isolation a real adapter must hold, without a database to hold it in.
 */
export class InMemoryAssistantBusinessDataReader implements AssistantBusinessDataReader {
  private readonly byScope = new Map<string, InMemoryAssistantFixture>();

  seed(scope: AssistantBusinessScope, fixture: InMemoryAssistantFixture): void {
    this.byScope.set(key(scope), fixture);
  }

  private fixtureFor(scope: AssistantBusinessScope): InMemoryAssistantFixture {
    return this.byScope.get(key(scope)) ?? {};
  }

  async getServiceAttentionSummary(scope: AssistantBusinessScope): Promise<ServiceAttentionSummary> {
    return this.fixtureFor(scope).serviceAttention ?? { pastDueCount: 0, schedulingConflictCount: 0 };
  }

  async getReorderQueuePreview(scope: AssistantBusinessScope, limit: number): Promise<readonly ReorderQueueItem[]> {
    return (this.fixtureFor(scope).reorderQueue ?? []).slice(0, limit);
  }

  async getWorkOrdersByStatus(scope: AssistantBusinessScope): Promise<readonly WorkOrderStatusCount[]> {
    return this.fixtureFor(scope).workOrdersByStatus ?? [];
  }

  async getMyPerformanceGoals(scope: AssistantBusinessScope): Promise<readonly PerformanceGoalSummary[]> {
    return this.fixtureFor(scope).goals ?? [];
  }

  async getAccountPortfolioSummary(scope: AssistantBusinessScope): Promise<AccountPortfolioSummary> {
    return this.fixtureFor(scope).accountPortfolio ?? { total: 0, byStatus: {} };
  }
}

function key(scope: AssistantBusinessScope): string {
  return `${scope.tenantId}:${scope.principalUid}`;
}
