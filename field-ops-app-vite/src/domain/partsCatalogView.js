// INV-CONVERGENCE-E C1 -- pure PartsList catalog composition.
//
// The governed identity/metadata source for the Inventory > Parts catalog: it
// composes the LIVE canonical `parts` read with the static compatibility catalog
// through the existing buildPartsWorkspace() adapter (the SAME composition the
// Stage A shadow-parity buildShadowModel() uses), and flattens the result into the
// row shape PartsList renders. It replaces static PARTS_CATALOG as PartsList's
// identity source WITHOUT introducing a parallel Parts source of truth: the static
// catalog remains the compatibility input, canonical `parts` remains authoritative.
//
// Pure: no Firebase, no network, no React, no clock/random, no input mutation.
// Fail-safe by construction -- a denied / unavailable / incomplete / not-fully-
// accounted canonical read yields a BLOCKED_* status with rows:[], NEVER an empty
// list presented as success and NEVER a silent static fallback (canonical is the
// governed source; a failure to read it is surfaced, per INV-CONVERGENCE-E).
//
// Governance: docs/architecture/inventory-parts-authority-contract.md; DECISIONS
// #43-#46; adapter provenance rules. Approved static-only exclusions are the
// INV-CONVERGENCE-B ten (partsCompatibilityAdapter.APPROVED_STATIC_ONLY_EXCLUSIONS).
import { buildPartsWorkspace } from "./partsCompatibilityAdapter.js";

/** Catalog composition states. READY only when every static sku is fully accounted
 * as CANONICAL_MATCH or an approved STATIC_ONLY_EXCLUDED; otherwise a BLOCKED_*. */
export const CATALOG_STATES = Object.freeze([
  "READY",
  "BLOCKED_PERMISSION",
  "BLOCKED_UNAVAILABLE",
  "BLOCKED_INCOMPLETE_INPUT",
]);

// Adapter issue codes that mean a static sku could not be validly represented
// (a dropped/duplicated/ambiguous Part) -- any of these must BLOCK, never render
// a partial catalog that silently omits a Part.
const BLOCKING_ISSUE_CODES = new Set([
  "STATIC_WITHOUT_CANONICAL_UNAPPROVED",
  "CANONICAL_WITHOUT_STATIC",
  "DUPLICATE_STATIC_SKU",
  "DUPLICATE_CANONICAL_PARTID",
  "MISSING_IDENTIFIER",
]);

/**
 * INV-CONVERGENCE-E C2 -- the SHARED governed composition guard.
 *
 * Extracted verbatim from buildPartsCatalogRows (C1) so that PartsList (C1) and
 * PartDetail (C2) enforce ONE fail-closed precedence ladder and ONE full-accounting
 * invariant, rather than two drifting copies. Behavior is unchanged for C1.
 *
 * @returns {{ status: string, ws: object|null, meta: object }}
 *   status "READY" with the composed adapter workspace, or a BLOCKED_* with ws:null.
 */
export function composeGovernedPartsWorkspace(input = {}) {
  const canonicalRead = input.canonicalRead || {};
  const staticCatalog = input.staticCatalog;
  const block = (status, reason) => ({ status, ws: null, meta: { reason } });

  // 1. Canonical read status precedence -- short-circuit BEFORE any composition
  //    (identical precedence to partsShadowParity.runShadowParity).
  const cstatus = canonicalRead.status;
  if (cstatus === "PERMISSION_DENIED") return block("BLOCKED_PERMISSION", "canonical read permission denied");
  if (cstatus === "UNAVAILABLE") return block("BLOCKED_UNAVAILABLE", "canonical read unavailable");
  if (cstatus !== "OK") return block("BLOCKED_INCOMPLETE_INPUT", "canonical read status missing or unknown");

  // 1b. Invalid canonical documents must NEVER be silently dropped. fetchPartMasterList splits its read
  //     into { parts, invalid }; a malformed doc omitted from `rows` could be masked by an approved
  //     STATIC_ONLY_EXCLUDED sku and wrongly read READY. Any present-and-non-empty (or malformed) invalid
  //     collection therefore BLOCKS here, before composition. Sanitized: only a count is surfaced, never
  //     the raw invalid documents. Backward-compatible: a caller that does not supply `invalid` is
  //     unchanged (a not-yet-updated consumer keeps its prior behavior; adopting `invalid` is a separate
  //     step for those consumers).
  if (canonicalRead.invalid !== undefined) {
    if (!Array.isArray(canonicalRead.invalid)) return block("BLOCKED_INCOMPLETE_INPUT", "canonical invalid metadata is malformed");
    if (canonicalRead.invalid.length > 0) {
      return { status: "BLOCKED_INCOMPLETE_INPUT", ws: null, meta: { reason: "canonical read returned invalid documents", invalidCount: canonicalRead.invalid.length } };
    }
  }

  // 2. Required inputs present as arrays.
  if (!Array.isArray(canonicalRead.rows)) return block("BLOCKED_INCOMPLETE_INPUT", "canonical rows missing");
  if (!Array.isArray(staticCatalog) || staticCatalog.length === 0) {
    return block("BLOCKED_INCOMPLETE_INPUT", "static catalog missing or empty");
  }

  // 3. Compose via the governed adapter (no overlay/workflow -- consumers overlay
  //    ledger health separately; this composition is identity/metadata only).
  const ws = buildPartsWorkspace({
    canonicalParts: canonicalRead.rows,
    staticCatalogParts: staticCatalog,
  });

  // 4. Full-accounting invariant: every static sku must be a CANONICAL_MATCH or an
  //    approved STATIC_ONLY_EXCLUDED, and there must be no blocking structural issue.
  //    Anything else means a Part would be silently dropped/duplicated -> BLOCK.
  const fullyAccounted =
    ws.totals.canonicalMatch + ws.totals.staticOnlyExcluded === ws.totals.staticCount;
  const blockingIssues = ws.issues.filter((i) => BLOCKING_ISSUE_CODES.has(i.code));
  if (!fullyAccounted || blockingIssues.length > 0) {
    return {
      status: "BLOCKED_INCOMPLETE_INPUT",
      ws: null,
      meta: {
        reason: "canonical composition did not fully account for the static catalog",
        staticCount: ws.totals.staticCount,
        canonicalMatch: ws.totals.canonicalMatch,
        staticOnlyExcluded: ws.totals.staticOnlyExcluded,
        blockingIssueCount: blockingIssues.length,
      },
    };
  }

  return {
    status: "READY",
    ws,
    meta: {
      staticCount: ws.totals.staticCount,
      canonicalCount: ws.totals.canonicalCount,
      canonicalMatch: ws.totals.canonicalMatch,
      staticOnlyExcluded: ws.totals.staticOnlyExcluded,
      // descriptive (non-blocking) divergences -- surfaced for evidence; Stage A
      // proved these are 0 in production. Canonical is authoritative on a divergence.
      nameDivergenceCount: ws.issues.filter((i) => i.code === "NAME_DIVERGENCE").length,
      unitDivergenceCount: ws.issues.filter((i) => i.code === "UNIT_DIVERGENCE").length,
      fullyAccounted,
    },
  };
}

/**
 * Build the PartsList catalog rows from a live canonical read + the static catalog.
 *
 * @param {object} input
 * @param {{ status: string, rows?: Array }} input.canonicalRead
 *   status: "OK" | "PERMISSION_DENIED" | "UNAVAILABLE" | (anything else -> incomplete).
 *   rows: canonical part view models ({ partId, name, category, stockingUnit, ... }).
 * @param {Array} input.staticCatalog  the static compatibility catalog (PARTS_CATALOG).
 * @returns {{ status: string, rows: Array<{sku,name,category,warehouseQty,identityState}>, meta: object }}
 *   status === "READY" iff every static sku is accounted for (CANONICAL_MATCH or
 *   approved STATIC_ONLY_EXCLUDED) with no blocking structural issue; else BLOCKED_*.
 */
export function buildPartsCatalogRows(input = {}) {
  // Single shared fail-closed guard + full-accounting invariant (C2 extraction).
  const composed = composeGovernedPartsWorkspace(input);
  if (composed.status !== "READY") {
    return { status: composed.status, rows: [], meta: composed.meta };
  }
  const ws = composed.ws;

  // Flatten to the PartsList row shape. Identity/name/category are canonical-
  // preferred (adapter), warehouseQty is the static baseline (STATIC_FALLBACK,
  // unchanged value). key === sku === partId, so routes/overlays/search are
  // preserved. Adapter already sorted rows by key.
  const val = (f, k) => (f[k] ? f[k].value : null);
  const rows = ws.rows.map((r) => ({
    sku: r.key,
    name: val(r.fields, "name"),
    category: val(r.fields, "category"),
    warehouseQty: val(r.fields, "warehouseQty"),
    identityState: r.identityState,
  }));

  return { status: "READY", rows, meta: composed.meta };
}

/** The Parts Catalog detail route for a composed row. The route key is the row's
 * `sku` (== canonical partId), NEVER the display name or the array position -- this
 * is what preserves detail-link continuity into the unchanged PartDetail. PartsList's
 * catalog table renders its Link via this helper so the routing contract is explicit
 * and testable. */
export function partCatalogRoute(row) {
  return `/inventory/${row && row.sku != null ? row.sku : ""}`;
}

/** Map partId -> display name from composed rows (for reorder-queue name resolution).
 * Covers all accounted skus when READY; empty under BLOCKED. */
export function nameBySkuFromRows(rows) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.sku === "string") map.set(r.sku, r.name);
  }
  return map;
}

/**
 * OD-3 -- governed canonical NAME resolution for the reorder-request/purchasing
 * surfaces (PartsManagerHome, PartsAssociateHome) that resolve a partId -> display
 * name but render NO catalog list. Reuses the exact shared governed path
 * (fetchPartMasterList -> composeGovernedPartsWorkspace via buildPartsCatalogRows ->
 * nameBySkuFromRows), so it fails closed on any denied/unavailable/incomplete/invalid
 * canonical read (namesReady:false, empty map) and never leaks raw invalid documents.
 *
 * Decision #2 (Owner, 2026-07-30): names come ONLY from CANONICAL_MATCH rows. A sku
 * with no canonical row -- an approved STATIC_ONLY_EXCLUDED part or any partId absent
 * from canonical -- is deliberately EXCLUDED from the map so the caller degrades it to
 * the raw partId; the static-catalog name (carried on STATIC_ONLY_EXCLUDED rows as a
 * STATIC_FALLBACK value) is never presented as canonical.
 *
 * @param {object} input  { canonicalRead: {status, rows?, invalid?}, staticCatalog }
 * @returns {{ namesReady: boolean, status: string, nameBySku: Map<string,string> }}
 */
/**
 * OD-3 (Codex P1/P2) -- the access boundary a canonical name read belongs to. A read is
 * only valid for the exact (uid, accessVersion) it was issued under; when either changes,
 * the boundary key changes and prior data must not be reused. Pure + deterministic.
 */
export function partNamesBoundaryKey(uid, accessVersion) {
  return `${uid ?? ""}::${accessVersion ?? ""}`;
}

/**
 * OD-3 (Codex P2) -- synchronous, render-time selection of a keyed read. Returns the
 * stored read ONLY when it was produced under the current render's boundary key; on any
 * mismatch it returns a LOADING read so the caller derives an empty name map on that SAME
 * render (prior-boundary names never appear for even one paint, without waiting for an
 * effect to reset state). Pure -- no effects, no timing dependence.
 */
export function selectCanonicalReadForKey(stored, currentKey, notReady = { status: "LOADING" }) {
  return stored && stored.key === currentKey ? stored.read : notReady;
}

export function resolveCanonicalPartNames(input = {}) {
  const { status, rows } = buildPartsCatalogRows(input);
  if (status !== "READY") {
    return { namesReady: false, status, nameBySku: new Map() };
  }
  return { namesReady: true, status, nameBySku: canonicalNameBySku(rows) };
}

/**
 * OD-3 -- partId -> canonical display name map derived from ALREADY-composed catalog rows
 * (buildPartsCatalogRows / buildWarehouseCatalog output). For consumers that already hold a
 * governed canonical composition (PartsList, WarehouseManagerHome) so they resolve names
 * WITHOUT a second read or a second compose. Decision #2: names come ONLY from
 * CANONICAL_MATCH rows -- a STATIC_ONLY_EXCLUDED or absent sku is omitted so the caller
 * degrades it to the raw partId; the static-fallback name carried on excluded rows is never
 * presented as canonical. Empty when rows are empty (LOADING/BLOCKED).
 */
export function canonicalNameBySku(catalogRows) {
  const rows = (Array.isArray(catalogRows) ? catalogRows : []).filter((r) => r && r.identityState === "CANONICAL_MATCH");
  return nameBySkuFromRows(rows);
}

/** True when the status is any BLOCKED_* state. */
export function isCatalogBlocked(status) {
  return status === "BLOCKED_PERMISSION" || status === "BLOCKED_UNAVAILABLE" || status === "BLOCKED_INCOMPLETE_INPUT";
}
