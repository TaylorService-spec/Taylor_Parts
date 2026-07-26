// INV-CONVERGENCE-E Stage A FOUNDATION -- reader bundle for the diagnostics surface.
//
// FOUNDATION ONLY: this bundle deliberately CANNOT execute live Stage A parity yet.
// The ledger/reorder/PO live one-shot readers and a real build/commit identifier must
// be supplied by a separate, explicitly-reviewed Stage A "live-reader + reviewed route"
// step before Decision #44 pre-cutover parity evidence can exist. Until then:
//   - ledger/reorder/PO readers report `unavailable`, and
//   - adapterCommit is null,
// so a live run resolves BLOCKED_INCOMPLETE_INPUT -- honest and safe, never a false PASS.
//
// clock/runId live HERE (orchestrator wiring), never in the pure core. Performs no
// writes. Any caller may override readers (tests, or the future wiring step).
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { PARTS_CATALOG } from "../../data/partsCatalog";

export function defaultReaders(overrides = {}) {
  let seq = 0;
  return {
    canonicalPartsReader: fetchPartMasterList,
    staticCatalogProvider: async () => ({ ok: true, rows: PARTS_CATALOG }),
    // Deferred to the separate live-reader step (one-shot reads; no subscriptions):
    ledgerReader: async () => ({ ok: false, code: "unavailable" }),
    reorderReader: async () => ({ ok: false, code: "unavailable" }),
    purchaseOrderReader: async () => ({ ok: false, code: "unavailable" }),
    clock: () => new Date().toISOString(),
    runId: () => `run-${(seq += 1)}`,
    adapterCommit: null, // foundation: no real build identifier yet -> run BLOCKS
    ...overrides,
  };
}

/** True only when a reader bundle can actually execute live parity (all live readers
 * wired + a real commit id). The foundation default returns false. */
export function isLiveReaderBundleComplete(readers) {
  const r = readers || {};
  const commitOk = typeof r.adapterCommit === "string" && r.adapterCommit.length > 0 && r.adapterCommit !== "unknown";
  return commitOk && [r.ledgerReader, r.reorderReader, r.purchaseOrderReader].every((fn) => typeof fn === "function" && fn !== defaultReaders().ledgerReader);
}
