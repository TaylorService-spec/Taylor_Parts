// INV-CONVERGENCE-E Stage A -- pure parity core. Deterministic; no Firebase,
// no network, no partMasterQueries import, no clock/random, no input mutation.
// Consumes ONE already-captured immutable bundle and returns { status, evidence }.
// Non-authoritative diagnostic; changes no product behavior.
//
// Counts and the static-catalog hash are DERIVED from the captured arrays and
// never trusted from caller-supplied metadata: any supplied sourceCounts /
// contentHash that disagrees with the captured content yields
// BLOCKED_INCOMPLETE_INPUT (never PASS / FAIL_PARITY). A permission-denied or
// unavailable canonical read short-circuits to the matching BLOCKED_* before any
// comparison -- it is never converted into an empty canonical list.
//
// Governance: docs/implementation-plans/inv-convergence-e-stage-a-handoff.md;
// docs/implementation-plans/inv-convergence-e-shadow-read-and-convergence.md.
import { buildPartsWorkspace, validateRowProvenance } from "./partsCompatibilityAdapter.js";

export const PARITY_STATES = Object.freeze([
  "PASS",
  "FAIL_PARITY",
  "BLOCKED_PERMISSION",
  "BLOCKED_UNAVAILABLE",
  "BLOCKED_INCOMPLETE_INPUT",
]);

// Deterministic FNV-1a 32-bit hash (browser-safe; no node:crypto, no network).
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

/** Derive the static-catalog content hash from a deterministic serialization of
 * the EXACT captured static rows (sorted by sku; fixed key order). */
export function deriveStaticCatalogHash(rows) {
  const norm = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      sku: r?.sku ?? null, name: r?.name ?? null, category: r?.category ?? null, unit: r?.unit ?? null,
      cost: r?.cost ?? null, price: r?.price ?? null, reorderThreshold: r?.reorderThreshold ?? null, warehouseQty: r?.warehouseQty ?? null,
    }))
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  return "fnv1a32:" + fnv1a32(JSON.stringify(norm));
}

/** Derive source counts from the captured arrays (never from supplied metadata). */
export function deriveCounts(bundle) {
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    canonical: len(bundle?.canonicalRead?.rows),
    static: len(bundle?.staticCatalog?.rows),
    ledger: len(bundle?.ledgerSnapshot),
    reorder: len(bundle?.reorderSnapshot),
    po: len(bundle?.poSnapshot),
  };
}

const countsEqual = (a, b) =>
  !!a && !!b && ["canonical", "static", "ledger", "reorder", "po"].every((k) => a[k] === b[k]);

function baseEvidence(bundle, extra) {
  return {
    runId: bundle?.runId ?? null,
    adapterCommit: bundle?.adapterCommit ?? null,
    capturedAtStart: bundle?.capturedAtStart ?? null,
    capturedAtEnd: bundle?.capturedAtEnd ?? null,
    ...extra,
  };
}

function blocked(bundle, status, reason) {
  return { status, evidence: baseEvidence(bundle, { status, reason, sourceCounts: null, staticCatalogHash: null }) };
}

/**
 * Run parity for one immutable captured bundle. Returns { status, evidence }.
 * Both the current model and the shadow model are derived ONLY from `bundle`.
 */
export function runShadowParity(bundle) {
  // 1. Canonical read status precedence -- short-circuit BEFORE any comparison.
  const cstatus = bundle?.canonicalRead?.status;
  if (cstatus === "PERMISSION_DENIED") return blocked(bundle, "BLOCKED_PERMISSION", "canonical read permission denied");
  if (cstatus === "UNAVAILABLE") return blocked(bundle, "BLOCKED_UNAVAILABLE", "canonical read unavailable");
  if (cstatus !== "OK") return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", "canonical read status missing or unknown");

  // 2. Required inputs must be present as arrays (never null/undefined).
  const required = {
    "canonicalRead.rows": bundle?.canonicalRead?.rows,
    "staticCatalog.rows": bundle?.staticCatalog?.rows,
    ledgerSnapshot: bundle?.ledgerSnapshot,
    reorderSnapshot: bundle?.reorderSnapshot,
    poSnapshot: bundle?.poSnapshot,
  };
  for (const [name, val] of Object.entries(required)) {
    if (!Array.isArray(val)) return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", `missing required input: ${name}`);
  }

  // 3. Derive counts + hash from captured content; verify any supplied metadata.
  const counts = deriveCounts(bundle);
  const staticCatalogHash = deriveStaticCatalogHash(bundle.staticCatalog.rows);
  if (bundle.sourceCounts && !countsEqual(bundle.sourceCounts, counts)) {
    return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", "supplied sourceCounts disagree with captured content");
  }
  if (bundle.staticCatalog.contentHash && bundle.staticCatalog.contentHash !== staticCatalogHash) {
    return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", "supplied contentHash disagrees with captured static rows");
  }

  // 4. Build the shadow model from the frozen bundle and evaluate parity.
  const ws = buildPartsWorkspace({
    canonicalParts: bundle.canonicalRead.rows,
    staticCatalogParts: bundle.staticCatalog.rows,
    overlayBySku: bundle.overlayBySku ?? {},
    workflowBySku: bundle.workflowBySku ?? {},
  });

  const has = (code) => ws.issues.filter((i) => i.code === code).length;
  const nameDivergenceCount = has("NAME_DIVERGENCE");
  const normalizedUnitDivergenceCount = has("UNIT_DIVERGENCE");
  const unexpectedUnmatchedCount = has("STATIC_WITHOUT_CANONICAL_UNAPPROVED") + has("CANONICAL_WITHOUT_STATIC");
  let provenanceIssueCount = has("DUPLICATE_CANONICAL_PARTID") + has("DUPLICATE_STATIC_SKU") + has("MISSING_IDENTIFIER");
  for (const row of ws.rows) provenanceIssueCount += validateRowProvenance(row).length;

  const accountedFor = ws.totals.canonicalMatch + ws.totals.staticOnlyExcluded;
  const fullyAccounted = accountedFor === counts.static;

  const divergent =
    nameDivergenceCount > 0 ||
    normalizedUnitDivergenceCount > 0 ||
    unexpectedUnmatchedCount > 0 ||
    provenanceIssueCount > 0 ||
    !fullyAccounted;

  const status = divergent ? "FAIL_PARITY" : "PASS";

  // Sanitized divergence summaries: { key, kind } only -- never record values.
  const divergences = ws.issues
    .filter((i) => i.code !== "UNKNOWN_PROVENANCE")
    .map((i) => ({ key: i.key ?? null, kind: i.code }));

  return {
    status,
    evidence: baseEvidence(bundle, {
      status,
      reason: divergent ? "parity divergence" : null,
      staticCatalogHash,
      sourceCounts: counts,
      canonicalMatchCount: ws.totals.canonicalMatch,
      staticOnlyExcludedCount: ws.totals.staticOnlyExcluded,
      unexpectedUnmatchedCount,
      nameDivergenceCount,
      normalizedUnitDivergenceCount,
      provenanceIssueCount,
      fullyAccounted,
      divergences,
    }),
  };
}
