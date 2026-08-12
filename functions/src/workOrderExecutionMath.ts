// Pure (firebase-free) helpers for the updateWorkOrderExecutionData callable, factored out so they are
// unit-testable in isolation without firebase-admin -- same "pure core + I/O callable" split the finance
// callables use. Only node:crypto and type-only imports here, nothing that touches Firestore.
import { createHash } from "node:crypto";
import type { InventorySnapshotItem } from "./types/workOrder";

export interface QtyUsedDelta {
  sku: string;
  delta: number; // positive to increment, negative to decrement
}

// Deterministic Audit Event id = the idempotency marker. Same (actor, workOrder, key) -> same id, so the
// callable's transactional existence check collapses a retry carrying the same key into a no-op replay.
// Mirrors finance/invoiceCallables.ts `auditId`.
export function executionDataAuditId(actorUid: string, workOrderId: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(`${actorUid}|${workOrderId}|${idempotencyKey}`).digest("hex").slice(0, 40);
  return `updateWorkOrderExecutionData_${digest}`;
}

// Pure qtyUsed merge: replace only each matching sku's qtyUsed with an additive, floored-at-0 delta, returning
// a NEW array (never mutating the input). `unknownSku` is surfaced (not thrown) so the callable owns the
// HttpsError mapping. This is the "applied exactly once" unit -- the transactional replay guard in the
// callable is what ensures it is invoked once per idempotency key.
export function mergeQtyUsed(
  snapshot: InventorySnapshotItem[],
  updates: QtyUsedDelta[],
): { ok: true; snapshot: InventorySnapshotItem[] } | { ok: false; unknownSku: string } {
  const next = [...snapshot];
  for (const { sku, delta } of updates) {
    const index = next.findIndex((item) => item.sku === sku);
    if (index === -1) return { ok: false, unknownSku: sku };
    const current = next[index].qtyUsed ?? 0;
    next[index] = { ...next[index], qtyUsed: Math.max(0, current + delta) };
  }
  return { ok: true, snapshot: next };
}
