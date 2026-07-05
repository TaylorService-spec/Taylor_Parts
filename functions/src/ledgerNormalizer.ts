// Epic 3 Fix 3.1 -- normalization boundary between Firestore's ledger
// representation and the analytics engine's pure, plain-number
// representation.
//
// FirestoreLedgerDoc is a LOCAL, minimal redeclaration -- NOT an import
// of Epic 2D's real ledger type (functions/src/types/inventoryTransaction.ts's
// InventoryTransaction). That type lives on the still-unmerged
// epic2d-inventory-trigger-system branch; this epic3 branch was cut
// from `main` before Epic 2D merged, so the real type doesn't exist
// here yet, and rebasing this already-pushed branch onto epic2d's would
// require a force-push rewriting shared history -- not done for a type
// import. TODO once both epics land on `main`: delete this local
// declaration and import the real InventoryTransaction type directly
// instead.
//
// Deliberately NOT named `InventoryTransaction` or
// `FirestoreLedgerTransaction` -- both names risk colliding with real
// or previously-considered types (see inventoryAnalyticsService.ts's
// header comment on why its own transaction type is `LedgerTransaction`,
// not `InventoryTransaction`). `FirestoreLedgerDoc` is unambiguous.
import type { Timestamp } from "firebase-admin/firestore";
import type { LedgerTransaction } from "./inventoryAnalyticsService";

export interface FirestoreLedgerDoc {
  id: string;
  workOrderId: string;
  partId: string;
  type: "RESERVED" | "RELEASED" | "CONSUMED";
  quantity: number;
  timestamp: Timestamp;
}

// Converts one raw Firestore ledger doc into the analytics engine's
// plain-number representation. This is the ONLY place a Firestore
// Timestamp is converted to epoch ms for analytics purposes --
// centralizing it here is what actually prevents future timestamp
// drift (a second, ad-hoc `.toMillis()` call somewhere else in the
// codebase, possibly handling the missing-timestamp case differently).
export function normalizeLedgerTransaction(doc: FirestoreLedgerDoc): LedgerTransaction {
  return {
    id: doc.id,
    workOrderId: doc.workOrderId,
    partId: doc.partId,
    type: doc.type,
    quantity: doc.quantity,
    timestamp: doc.timestamp?.toMillis?.() ?? 0,
  };
}

export function normalizeLedgerTransactions(docs: FirestoreLedgerDoc[]): LedgerTransaction[] {
  return docs.map(normalizeLedgerTransaction);
}
