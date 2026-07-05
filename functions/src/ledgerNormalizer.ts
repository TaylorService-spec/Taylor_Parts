// Epic 3 Fix 3.1 -- normalization boundary between Firestore's ledger
// representation and the analytics engine's pure, plain-number
// representation.
//
// Imports Epic 2D's real ledger type directly (now merged to `main`
// via #16) -- previously this file redeclared a local, minimal stub
// because Epic 2D hadn't merged yet when this branch was cut.
import type { InventoryTransaction } from "./types/inventoryTransaction";
import type { LedgerTransaction } from "./inventoryAnalyticsService";

// Converts one raw Firestore ledger doc into the analytics engine's
// plain-number representation. This is the ONLY place a Firestore
// Timestamp is converted to epoch ms for analytics purposes --
// centralizing it here is what actually prevents future timestamp
// drift (a second, ad-hoc `.toMillis()` call somewhere else in the
// codebase, possibly handling the missing-timestamp case differently).
export function normalizeLedgerTransaction(doc: InventoryTransaction): LedgerTransaction {
  return {
    id: doc.id,
    workOrderId: doc.workOrderId,
    partId: doc.partId,
    type: doc.type,
    quantity: doc.quantity,
    timestamp: doc.timestamp?.toMillis?.() ?? 0,
  };
}

export function normalizeLedgerTransactions(docs: InventoryTransaction[]): LedgerTransaction[] {
  return docs.map(normalizeLedgerTransaction);
}
