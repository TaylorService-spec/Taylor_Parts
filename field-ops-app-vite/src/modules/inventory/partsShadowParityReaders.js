// INV-CONVERGENCE-E Stage A -- production reader bundle for the diagnostics surface.
// The only place that wires the live read-only services + clock/runId. Performs no
// writes. clock/runId live HERE (orchestrator wiring), never in the pure core. The
// ledger/reorder/PO live readers must be supplied by a later, separately-reviewed
// wiring step; until then they report unavailable and the run reports
// BLOCKED_INCOMPLETE_INPUT -- honest and safe.
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { PARTS_CATALOG } from "../../data/partsCatalog";

const ADAPTER_COMMIT = "unknown"; // injected by a later wiring/build step

export function defaultReaders(overrides = {}) {
  let seq = 0;
  return {
    canonicalPartsReader: fetchPartMasterList,
    staticCatalogProvider: async () => ({ ok: true, rows: PARTS_CATALOG }),
    ledgerReader: async () => ({ ok: false, code: "unavailable" }),
    reorderReader: async () => ({ ok: false, code: "unavailable" }),
    purchaseOrderReader: async () => ({ ok: false, code: "unavailable" }),
    clock: () => new Date().toISOString(),
    runId: () => `run-${(seq += 1)}`,
    adapterCommit: ADAPTER_COMMIT,
    ...overrides,
  };
}
