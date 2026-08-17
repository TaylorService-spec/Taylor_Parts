// Epic 2D Inventory Trigger System (see docs/architecture/ADR-003).
import type { Timestamp } from "firebase-admin/firestore";

// The legacy Work-Order reservation vocabulary PLUS the governed operational movement types that
// Receiving, Transfer and Cycle Count reconciliation write to this SAME append-only ledger. They were
// always being written; this type simply did not name them, so every consumer that switched on it
// silently treated real stock movement as nothing at all.
export type InventoryTransactionType =
  | "RESERVED" | "RELEASED" | "CONSUMED"
  | "RECEIVED" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTED";

// Append-only ledger entry -- never updated or deleted once written
// (see inventoryService.ts: every write here is tx.set() on a brand
// new doc ref, never tx.update()/tx.delete() against an existing one).
export interface InventoryTransaction {
  id: string;
  workOrderId: string;
  partId: string; // sku
  type: InventoryTransactionType;
  quantity: number;
  timestamp: Timestamp;
}

// One doc per Work Order -- idempotency + failure/retry bookkeeping,
// deliberately kept OUT of the WorkOrder document itself (fieldops_wos)
// so this internal processing metadata never touches that schema's
// public contract. Admin-SDK-only, same as the ledger.
export interface InventorySyncStatus {
  workOrderId: string;
  // Which states have already had their inventory side effect applied
  // -- checked before running a trigger again, so a retried/duplicate
  // transitionWorkOrder call (or an explicit future retry) never
  // double-reserves/double-consumes.
  processedStates: Partial<Record<string, true>>;
  // Present only for a state whose trigger failed and hasn't been
  // retried successfully yet. Per this epic's failure model: the
  // WorkOrder's own state is already committed and stays committed
  // regardless -- this is purely "something needs manual/future
  // attention," not a rollback signal.
  failures: Partial<Record<string, { error: string; at: Timestamp; retryNeeded: true }>>;
  // Present only while a trigger for that state is actively running.
  // Claimed transactionally by claimStateForProcessing() before the
  // trigger runs, and cleared afterward (by markStateProcessed() on
  // success or by clearClaim() on failure) -- see triggerInventoryEffects()
  // in inventoryService.ts. This is what makes the processed-state guard
  // atomic: a second concurrent call for the same (workOrderId, state)
  // fails to claim (its transaction observes the claim already set) and
  // never re-runs the trigger.
  claims?: Partial<Record<string, true>>;
  finalized?: true;
}
