// STORAGE-NEUTRAL BUSINESS DATA READER. The one seam the assistant's dashboard tools may depend on.
//
// ============================ ADR-015: ABOVE THE LINE ============================
//
// This file, and every assistant file that imports it, must not import `firebase-admin`, must not
// import a Firestore SDK type, must not name a Firestore collection, and must not construct a
// document path. It does not know that the current backing store is Firestore. The methods below
// name EOS business concepts -- a service-attention summary, a reorder queue preview -- never a
// collection or a query shape, so a later Postgres implementation satisfies the same interface
// without this file, or any tool built against it, changing at all.
//
// ============================ WHY NOT ONE GENERIC READ ============================
//
// `getCollection(name)` or `readDocument(path)` would let the storage model leak straight through
// this seam into the gateway and the tools -- the exact failure ADR-015 exists to prevent. Every
// method here is scoped to exactly what one dashboard tool needs, expressed as a business answer.
//
// ============================ SCOPE IS RESOLVED BEFORE THIS IS CALLED ============================
//
// `AssistantBusinessScope` carries ALREADY-VERIFIED tenant and principal identity. The reader never
// decides who is asking or what tenant they belong to -- that is resolved upstream (Firebase token
// verification, then `resolvePrincipalContext` against the Postgres policy store) and handed down as
// a value. A reader implementation must treat the scope as trusted input, not as something to
// re-derive, and must never accept a wider selector (a raw tenant string with no verification, an
// unbounded filter) than the methods below declare.
//
// ============================ READ ONLY ============================
//
// This interface has no write, update or delete method, and none should be added here. A tool that
// needs to change something must go through an existing governed EOS command, not through a mutation
// added to this reader.

/** The already-authorized caller this read runs as. Never constructed from client input. */
export interface AssistantBusinessScope {
  readonly tenantId: string;
  /** The EOS principal id (not the Firebase uid) -- see `PrincipalContext.uid`. */
  readonly principalUid: string;
}

export interface ServiceAttentionSummary {
  readonly pastDueCount: number;
  readonly schedulingConflictCount: number;
}

export interface ReorderQueueItem {
  readonly id: string;
  readonly partName: string;
  readonly requestedQty: number | null;
}

export interface WorkOrderStatusCount {
  readonly status: string;
  readonly count: number;
}

export interface PerformanceGoalSummary {
  readonly goalKey: string;
  readonly label: string;
  readonly target: number | null;
  readonly actual: number | null;
}

export interface AccountPortfolioSummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
}

/**
 * Every business read a DASHBOARD assistant tool may use.
 *
 * Narrow on purpose: this is exactly what the dashboard tools implemented today need, not a
 * speculative catalogue of everything a future tool might want. Add a method when a tool needs it,
 * named for what it answers.
 */
export interface AssistantBusinessDataReader {
  getServiceAttentionSummary(scope: AssistantBusinessScope): Promise<ServiceAttentionSummary>;
  getReorderQueuePreview(scope: AssistantBusinessScope, limit: number): Promise<readonly ReorderQueueItem[]>;
  getWorkOrdersByStatus(scope: AssistantBusinessScope): Promise<readonly WorkOrderStatusCount[]>;
  getMyPerformanceGoals(scope: AssistantBusinessScope): Promise<readonly PerformanceGoalSummary[]>;
  getAccountPortfolioSummary(scope: AssistantBusinessScope): Promise<AccountPortfolioSummary>;
}
