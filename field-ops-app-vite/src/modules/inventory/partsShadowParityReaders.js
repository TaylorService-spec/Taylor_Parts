// INV-CONVERGENCE-E Stage A completion -- production reader bundle for the diagnostics
// surface. Wires the EXISTING one-shot read-only paths (no new query surface, no
// subscriptions, one call each) and a deterministic build identifier:
//   - canonical : fetchPartMasterList()          (services/partMasterQueries)
//   - static    : PARTS_CATALOG                  (data/partsCatalog)
//   - ledger    : fetchInventoryTransactions()   (operationsQueries; inventory_transactions)
//   - reorder   : fetchReorderRequests()         (operationsQueries; reorder_requests)
//   - PO        : fetchReorderPurchaseOrders()   (operationsQueries; LIVE reorder_purchase_orders)
// Overlays are DERIVED from these snapshots inside the pure core; availability reuses
// the existing computeAvailableStockByPart semantics. Performs NO writes. clock/runId
// live here (never in the pure core). adapterCommit = the injected build id; when it is
// absent/"unknown" the pure core resolves BLOCKED_INCOMPLETE_INPUT (never a false PASS).
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { PARTS_CATALOG } from "../../data/partsCatalog";
import { fetchInventoryTransactions, fetchReorderRequests, fetchReorderPurchaseOrders } from "../../services/operationsQueries";
import { readOnce } from "../../domain/partsShadowParityReadOnce";
import { createRunIdProvider } from "../../domain/partsShadowParityRunId";

// Deterministic build/commit identifier injected at build time (vite `define`).
const ADAPTER_COMMIT = typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : null;

// One reader bundle is created per component mount (via useRef) and reused across runs,
// so this run-ID provider's sequence persists -> every execution gets a distinct opaque
// run id (opaque prefix + incrementing sequence; no user identity).
export function defaultReaders(overrides = {}) {
  return {
    canonicalPartsReader: fetchPartMasterList, // already returns { ok, parts } | { ok:false, code }
    staticCatalogProvider: async () => ({ ok: true, rows: PARTS_CATALOG }),
    ledgerReader: () => readOnce(fetchInventoryTransactions),
    reorderReader: () => readOnce(fetchReorderRequests),
    purchaseOrderReader: () => readOnce(fetchReorderPurchaseOrders),
    clock: () => new Date().toISOString(),
    runId: createRunIdProvider(),
    adapterCommit: ADAPTER_COMMIT,
    ...overrides,
  };
}

/** True only when the bundle can execute live parity: a real build identifier is
 * present (all three live readers are wired above). A missing/"unknown" id -> false,
 * and the pure core then resolves BLOCKED_INCOMPLETE_INPUT. */
export function isLiveReaderBundleComplete(readers) {
  const r = readers || {};
  return typeof r.adapterCommit === "string" && r.adapterCommit.length > 0 && r.adapterCommit !== "unknown";
}
