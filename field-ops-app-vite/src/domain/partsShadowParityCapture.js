// INV-CONVERGENCE-E Stage A -- dependency-injected capture orchestrator. Assembles
// ONE immutable bundle from injected readers and hands it to the pure core. Performs
// NO writes. The only layer that touches live reads in production; kept offline-
// testable by injecting all readers (tests pass fakes; no Firebase/network).
//
// Reader outcome contract: each reader resolves { ok:true, rows } or
// { ok:false, code:"permission-denied"|"unavailable"|... }. A failed canonical read
// becomes canonicalRead.status (PERMISSION_DENIED / UNAVAILABLE) with rows:null --
// NEVER an empty array. A blocked canonical read short-circuits capture BEFORE the
// comparison (the other readers are not called). Each reader is invoked at most once
// per run; reads are one-shot (no subscriptions remain active during comparison).
import { runShadowParity } from "./partsShadowParity.js";

// canonical reader may resolve { ok, parts | rows, code } (fetchPartMasterList uses `parts`).
function toCanonicalRead(result) {
  if (result && result.ok) {
    const rows = Array.isArray(result.parts) ? result.parts : Array.isArray(result.rows) ? result.rows : [];
    return { status: "OK", rows };
  }
  const status = result && result.code === "permission-denied" ? "PERMISSION_DENIED" : "UNAVAILABLE";
  return { status, rows: null }; // never [] on failure
}

// non-canonical readers: { ok:true, rows } -> rows; failure/missing -> null (=> incomplete).
function toRows(result) {
  if (result && result.ok && Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result)) return result; // tolerate a bare array provider
  return null;
}

/**
 * Capture one bundle from injected readers and run parity.
 * readers: {
 *   canonicalPartsReader, staticCatalogProvider, ledgerReader, reorderReader,
 *   purchaseOrderReader, clock, runId, adapterCommit?, overlayBySku?, workflowBySku?
 * }
 * Returns the pure core's { status, evidence }.
 */
export async function captureShadowParity(readers) {
  const r = readers || {};
  const clock = typeof r.clock === "function" ? r.clock : () => null;
  const runIdFn = typeof r.runId === "function" ? r.runId : () => null;

  const capturedAtStart = clock();
  const runId = runIdFn();
  const adapterCommit = r.adapterCommit ?? null;

  // Canonical FIRST -- on a blocked read, short-circuit: do not call other readers.
  const canonicalRead = toCanonicalRead(await r.canonicalPartsReader());
  if (canonicalRead.status !== "OK") {
    const capturedAtEnd = clock();
    return runShadowParity({
      runId, adapterCommit, capturedAtStart, capturedAtEnd,
      canonicalRead, staticCatalog: { rows: null }, ledgerSnapshot: null, reorderSnapshot: null, poSnapshot: null,
    });
  }

  // Required non-canonical inputs -- each reader invoked exactly once.
  const staticRows = toRows(await r.staticCatalogProvider());
  const ledgerSnapshot = toRows(await r.ledgerReader());
  const reorderSnapshot = toRows(await r.reorderReader());
  const poSnapshot = toRows(await r.purchaseOrderReader());
  const capturedAtEnd = clock();

  // Overlays are DERIVED from the captured snapshots inside runShadowParity -- the
  // orchestrator supplies only the snapshots, never a separate overlay authority.
  return runShadowParity({
    runId, adapterCommit, capturedAtStart, capturedAtEnd,
    canonicalRead,
    staticCatalog: { rows: staticRows },
    ledgerSnapshot,
    reorderSnapshot,
    poSnapshot,
  });
}
