// FIRESTORE ADAPTER. TEMPORARY. The one file below the ADR-015 line for the assistant's business
// reads.
//
// ============================ WHAT MAY LIVE HERE, AND NOTHING ELSE MAY ============================
//
// This file may know Firestore implementation details -- collection names, document shapes, query
// construction. Nothing above it may. Every method here exists to satisfy one
// `AssistantBusinessDataReader` method and returns exactly that method's business-shaped answer,
// never a raw document or a query cursor.
//
// ============================ THE CLIENT IS INJECTED ============================
//
// `FirestoreQueryClient` is a narrow interface, not `firebase-admin`'s own `Firestore` type. Nothing
// in this file calls `initializeApp` or `getFirestore()` -- the composition root owns constructing
// the real client and deciding whether a credential is even configured. That is what lets a test
// exercise every line below with an in-memory fake and no GCP credential of any kind, and what keeps
// this file honest about being an adapter rather than a second identity-and-bootstrap layer.
//
// ============================ READ ONLY, DELIBERATELY UNDER-POWERED ============================
//
// No write method exists on `FirestoreQueryClient` because none is needed: this adapter issues reads
// only, and a query method that accepted an arbitrary collection name or an unbounded filter would
// leak the storage model straight back through the seam this file exists to hold. Every method below
// names its own collection and its own bounded query -- there is no generic
// `readCollection(name, filter)` escape hatch.
import type {
  AccountPortfolioSummary,
  AssistantBusinessDataReader,
  AssistantBusinessScope,
  PerformanceGoalSummary,
  ReorderQueueItem,
  ServiceAttentionSummary,
  WorkOrderStatusCount,
} from "./assistantBusinessDataReader";

/**
 * The minimal read surface this adapter needs from a Firestore-like store.
 *
 * Intentionally NOT `firebase-admin`'s `Firestore` type: depending on that type here would make this
 * file's own import list the thing that reintroduces the SDK dependency this interface exists to
 * confine. A real binding satisfies this shape with a thin wrapper over the SDK; a test satisfies it
 * with a plain object.
 */
export interface FirestoreQueryDoc {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface FirestoreQueryClient {
  /**
   * Documents in `collection`, scoped to `tenantId`, matching `where` (field/op/value triples,
   * ANDed), in `orderBy` order if given, capped at `limit` if given.
   *
   * The tenant scope is a REQUIRED parameter, not an optional filter a caller might omit -- see
   * `queryTenantScoped` below, which is the only way this file issues a read.
   */
  queryTenantScoped(args: {
    readonly collection: string;
    readonly tenantId: string;
    readonly where?: readonly (readonly [string, "==" | "in", unknown])[];
    readonly orderBy?: readonly (readonly [string, "asc" | "desc"])[];
    readonly limit?: number;
  }): Promise<readonly FirestoreQueryDoc[]>;
}

export class FirestoreAssistantAdapter implements AssistantBusinessDataReader {
  constructor(private readonly client: FirestoreQueryClient) {}

  async getServiceAttentionSummary(scope: AssistantBusinessScope): Promise<ServiceAttentionSummary> {
    const [pastDue, conflicts] = await Promise.all([
      this.client.queryTenantScoped({
        collection: "workOrders",
        tenantId: scope.tenantId,
        where: [["scheduling.attention", "==", "PAST_DUE"]],
      }),
      this.client.queryTenantScoped({
        collection: "workOrders",
        tenantId: scope.tenantId,
        where: [["scheduling.attention", "==", "SCHEDULING_CONFLICT"]],
      }),
    ]);
    return { pastDueCount: pastDue.length, schedulingConflictCount: conflicts.length };
  }

  async getReorderQueuePreview(scope: AssistantBusinessScope, limit: number): Promise<readonly ReorderQueueItem[]> {
    const docs = await this.client.queryTenantScoped({
      collection: "reorderRequests",
      tenantId: scope.tenantId,
      where: [["status", "==", "PENDING"]],
      orderBy: [["requestedAt", "asc"]],
      limit,
    });
    return docs.map((d) => ({
      id: d.id,
      partName: typeof d.data.partName === "string" ? d.data.partName : "Part name not resolved",
      requestedQty: typeof d.data.requestedQty === "number" ? d.data.requestedQty : null,
    }));
  }

  async getWorkOrdersByStatus(scope: AssistantBusinessScope): Promise<readonly WorkOrderStatusCount[]> {
    const docs = await this.client.queryTenantScoped({ collection: "workOrders", tenantId: scope.tenantId });
    const counts = new Map<string, number>();
    for (const d of docs) {
      const status = typeof d.data.status === "string" ? d.data.status : "UNKNOWN";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  }

  async getMyPerformanceGoals(scope: AssistantBusinessScope): Promise<readonly PerformanceGoalSummary[]> {
    const docs = await this.client.queryTenantScoped({
      collection: "performanceGoals",
      tenantId: scope.tenantId,
      where: [["targetScopeType", "==", "EMPLOYEE"], ["targetScopeId", "==", scope.principalUid]],
    });
    return docs.map((d) => ({
      goalKey: typeof d.data.goalKey === "string" ? d.data.goalKey : d.id,
      label: typeof d.data.label === "string" ? d.data.label : "Goal",
      target: typeof d.data.target === "number" ? d.data.target : null,
      actual: typeof d.data.actual === "number" ? d.data.actual : null,
    }));
  }

  async getAccountPortfolioSummary(scope: AssistantBusinessScope): Promise<AccountPortfolioSummary> {
    const docs = await this.client.queryTenantScoped({ collection: "accounts", tenantId: scope.tenantId });
    const byStatus: Record<string, number> = {};
    for (const d of docs) {
      const status = typeof d.data.status === "string" ? d.data.status : "unclassified";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    return { total: docs.length, byStatus };
  }
}

// ============================ CREDENTIAL: NOT YET AUTHORIZED ============================
//
// ASSISTANT BUSINESS DATA FIRESTORE CREDENTIAL: NOT YET AUTHORIZED / NOT YET BOUND.
//
// Nothing in this file, and nothing in the composition root, constructs a real `FirestoreQueryClient`
// today. This resolver is the single place that decision will be wired in, and until it is, it
// returns `null` -- which the composition root must treat as "the reader is unavailable" and refuse
// explicitly, never as a reason to fall back to a client-direct Firestore read or a Firebase callable.
//
// The eventual credential must be non-production only, scoped to `eos-platform-sandbox`, least
// privilege, read-only for exactly the collections above, held in Render secret management (never
// source), and replaceable without changing this file's public shape. Its FORM (service-account key,
// workload identity, or something else) is a separate infrastructure decision this function does not
// make or assume.
export interface AssistantFirestoreCredentialEnv {
  readonly [key: string]: string | undefined;
}

export function resolveAssistantFirestoreClient(
  _env: AssistantFirestoreCredentialEnv,
): FirestoreQueryClient | null {
  return null;
}
