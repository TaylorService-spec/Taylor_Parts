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

// Pure qtyUsed merge: replace only each matching sku's qtyUsed with an additive delta, clamped to
// [0, qtyPlanned] (when qtyPlanned is known -- an item with no qtyPlanned is only floored at 0, same as
// before), returning a NEW array (never mutating the input). `unknownSku` is surfaced (not thrown) so the
// callable owns the HttpsError mapping. This is the "applied exactly once" unit -- the transactional replay
// guard in the callable is what ensures it is invoked once per idempotency key.
//
// This is the AUTHORITATIVE server write path: a non-finite delta (NaN/Infinity, which would otherwise
// poison the additive sum) or a delta that would push qtyUsed above the item's own qtyPlanned is rejected
// up front by assertValidInput / the transaction that calls this -- this function's own clamp is the
// second, independent line of defense so qtyUsed can never persist outside [0, qtyPlanned] regardless of
// what slips past validation.
export function mergeQtyUsed(
  snapshot: InventorySnapshotItem[],
  updates: QtyUsedDelta[],
): { ok: true; snapshot: InventorySnapshotItem[] } | { ok: false; unknownSku: string } {
  const next = [...snapshot];
  for (const { sku, delta } of updates) {
    const index = next.findIndex((item) => item.sku === sku);
    if (index === -1) return { ok: false, unknownSku: sku };
    const item = next[index];
    const current = item.qtyUsed ?? 0;
    const sum = current + delta;
    const safeSum = Number.isFinite(sum) ? sum : current;
    const upperBound = typeof item.qtyPlanned === "number" && Number.isFinite(item.qtyPlanned)
      ? item.qtyPlanned
      : Number.POSITIVE_INFINITY;
    const clamped = Math.min(Math.max(0, safeSum), upperBound);
    next[index] = { ...item, qtyUsed: clamped };
  }
  return { ok: true, snapshot: next };
}
