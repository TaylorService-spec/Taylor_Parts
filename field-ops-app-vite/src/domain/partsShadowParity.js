// INV-CONVERGENCE-E Stage A -- pure parity core. Deterministic; no Firebase,
// no network, no partMasterQueries import, no clock/random, no input mutation.
// Consumes ONE already-captured immutable bundle and returns { status, evidence }.
// Non-authoritative diagnostic; changes no product behavior.
//
// Builds TWO models from the SAME captured bundle and compares them explicitly:
//   A. CURRENT operational model -- reproduces the identity/values PartsList and
//      PartDetail derive today (static-catalog identity + snapshot-derived overlay);
//   B. SHADOW model -- the same fields sourced through buildPartsWorkspace()
//      (canonical identity).
// Overlays (reserved/released/consumed/availability, reorder + purchasing state) are
// DERIVED from the captured ledger/reorder/PO snapshots inside the run boundary --
// caller-supplied overlay objects are ignored, so evidence and comparison never
// describe different data. No new inventory mathematics: availability reuses the
// existing semantics (inventoryAnalyticsEngine.ts computeAvailableStockByPart:
// warehouseQty - (reserved - released); CONSUMED not re-subtracted).
//
// Counts and the static-catalog hash are DERIVED from the captured arrays and never
// trusted from caller-supplied metadata; a mismatch yields BLOCKED_INCOMPLETE_INPUT.
// A permission-denied/unavailable canonical read short-circuits to the matching
// BLOCKED_* before any comparison and is never turned into an empty canonical list.
import { buildPartsWorkspace, validateRowProvenance, normalizeUnit } from "./partsCompatibilityAdapter.js";

export const PARITY_STATES = Object.freeze([
  "PASS", "FAIL_PARITY", "BLOCKED_PERMISSION", "BLOCKED_UNAVAILABLE", "BLOCKED_INCOMPLETE_INPUT",
]);

/** Deterministic current-vs-shadow divergence kinds (sanitized {key,kind} summaries). */
export const DIVERGENCE_KINDS = Object.freeze([
  "CURRENT_SHADOW_ROW_MISSING",
  "CURRENT_SHADOW_FIELD_DIVERGENCE",
  "CURRENT_SHADOW_AVAILABILITY_DIVERGENCE",
  "CURRENT_SHADOW_WORKFLOW_DIVERGENCE",
]);

// ---- deterministic FNV-1a 32-bit hash (browser-safe; no node:crypto/network) ----
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ("00000000" + h.toString(16)).slice(-8);
}

export function deriveStaticCatalogHash(rows) {
  const norm = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      sku: r?.sku ?? null, name: r?.name ?? null, category: r?.category ?? null, unit: r?.unit ?? null,
      cost: r?.cost ?? null, price: r?.price ?? null, reorderThreshold: r?.reorderThreshold ?? null, warehouseQty: r?.warehouseQty ?? null,
    }))
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  return "fnv1a32:" + fnv1a32(JSON.stringify(norm));
}

export function deriveCounts(bundle) {
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    canonical: len(bundle?.canonicalRead?.rows), static: len(bundle?.staticCatalog?.rows),
    ledger: len(bundle?.ledgerSnapshot), reorder: len(bundle?.reorderSnapshot), po: len(bundle?.poSnapshot),
  };
}

// ---- overlay derivation (from captured snapshots; existing semantics preserved) ----

/** reserved/released/consumed by sku + availability = warehouseQty - (reserved - released). */
export function deriveLedgerOverlay(ledgerSnapshot, staticRows) {
  const warehouseQtyBySku = new Map((Array.isArray(staticRows) ? staticRows : []).map((r) => [r.sku, r.warehouseQty]));
  const byPart = new Map();
  for (const t of Array.isArray(ledgerSnapshot) ? ledgerSnapshot : []) {
    const e = byPart.get(t.partId) ?? { reserved: 0, released: 0, consumed: 0 };
    if (t.type === "RESERVED") e.reserved += t.quantity;
    else if (t.type === "RELEASED") e.released += t.quantity;
    else if (t.type === "CONSUMED") e.consumed += t.quantity;
    byPart.set(t.partId, e);
  }
  const overlayBySku = {};
  // include every static sku (baseline availability even with no movement)
  for (const [sku, warehouseQty] of warehouseQtyBySku) {
    const e = byPart.get(sku) ?? { reserved: 0, released: 0, consumed: 0 };
    overlayBySku[sku] = { reserved: e.reserved, released: e.released, consumed: e.consumed, availability: (warehouseQty ?? 0) - (e.reserved - e.released) };
  }
  return overlayBySku;
}

/** Deterministic reorder/PO workflow state by sku (sorted unique statuses + count). */
export function deriveWorkflowBySku(reorderSnapshot, poSnapshot) {
  const collect = (rows) => {
    const m = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      const g = m.get(r.partId) ?? { statuses: new Set(), count: 0 };
      if (r.status != null) g.statuses.add(String(r.status));
      g.count += 1;
      m.set(r.partId, g);
    }
    return m;
  };
  const ro = collect(reorderSnapshot); const po = collect(poSnapshot);
  const workflowBySku = {};
  for (const sku of new Set([...ro.keys(), ...po.keys()])) {
    const r = ro.get(sku); const p = po.get(sku);
    workflowBySku[sku] = {
      reorderState: r ? { statuses: [...r.statuses].sort(), count: r.count } : null,
      purchasingState: p ? { statuses: [...p.statuses].sort(), count: p.count } : null,
    };
  }
  return workflowBySku;
}

// ---- model builders (both from the same captured bundle + derived overlays) ----

function comparableFromStatic(sku, staticRow, overlay, workflow) {
  const w = workflow[sku] ?? {};
  return {
    key: sku, partId: sku, name: staticRow.name, category: staticRow.category,
    normalizedUnit: normalizeUnit(staticRow.unit), cost: staticRow.cost, price: staticRow.price,
    reorderThreshold: staticRow.reorderThreshold, warehouseQty: staticRow.warehouseQty,
    reserved: overlay?.reserved ?? null, released: overlay?.released ?? null, consumed: overlay?.consumed ?? null,
    availability: overlay?.availability ?? null,
    reorderState: w.reorderState ?? null, purchasingState: w.purchasingState ?? null,
  };
}

/** CURRENT operational model: static-catalog identity, snapshot-derived overlay. */
export function buildCurrentModel(bundle, overlayBySku, workflowBySku) {
  const rows = {};
  for (const s of bundle.staticCatalog.rows) rows[s.sku] = comparableFromStatic(s.sku, s, overlayBySku[s.sku], workflowBySku);
  return rows;
}

/** SHADOW model: same fields sourced through the compatibility adapter (canonical identity). */
export function buildShadowModel(bundle, overlayBySku, workflowBySku) {
  const ws = buildPartsWorkspace({
    canonicalParts: bundle.canonicalRead.rows, staticCatalogParts: bundle.staticCatalog.rows,
    overlayBySku, workflowBySku,
  });
  const rows = {};
  for (const r of ws.rows) {
    const f = r.fields;
    const val = (k) => (f[k] ? f[k].value : null);
    rows[r.key] = {
      key: r.key, partId: val("partId"), name: val("name"), category: val("category"),
      normalizedUnit: val("stockingUnit"), cost: val("cost"), price: val("price"),
      reorderThreshold: val("reorderThreshold"), warehouseQty: val("warehouseQty"),
      reserved: val("reserved"), released: val("released"), consumed: val("consumed"),
      availability: val("availability"), reorderState: val("reorderState"), purchasingState: val("purchasingState"),
    };
  }
  return { rows, ws };
}

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const DESCRIPTIVE = ["partId", "name", "category", "normalizedUnit", "cost", "price", "reorderThreshold", "warehouseQty", "reserved", "released", "consumed"];

/** Compare the CURRENT and SHADOW models explicitly; returns sanitized {key,kind} list. */
export function compareModels(currentRows, shadowRows) {
  const divergences = [];
  const keys = new Set([...Object.keys(currentRows), ...Object.keys(shadowRows)]);
  for (const key of [...keys].sort()) {
    const a = currentRows[key]; const b = shadowRows[key];
    if (!a || !b) { divergences.push({ key, kind: "CURRENT_SHADOW_ROW_MISSING" }); continue; }
    if (DESCRIPTIVE.some((fld) => !eq(a[fld], b[fld]))) divergences.push({ key, kind: "CURRENT_SHADOW_FIELD_DIVERGENCE" });
    if (!eq(a.availability, b.availability)) divergences.push({ key, kind: "CURRENT_SHADOW_AVAILABILITY_DIVERGENCE" });
    if (!eq(a.reorderState, b.reorderState) || !eq(a.purchasingState, b.purchasingState)) divergences.push({ key, kind: "CURRENT_SHADOW_WORKFLOW_DIVERGENCE" });
  }
  return divergences;
}

// ---- run ----

function baseEvidence(bundle, extra) {
  return {
    runId: bundle?.runId ?? null, adapterCommit: bundle?.adapterCommit ?? null,
    capturedAtStart: bundle?.capturedAtStart ?? null, capturedAtEnd: bundle?.capturedAtEnd ?? null, ...extra,
  };
}
function blocked(bundle, status, reason) {
  return { status, evidence: baseEvidence(bundle, { status, reason, sourceCounts: null, staticCatalogHash: null }) };
}
const countsEqual = (a, b) => !!a && !!b && ["canonical", "static", "ledger", "reorder", "po"].every((k) => a[k] === b[k]);
const isNonEmptyStr = (v) => typeof v === "string" && v.length > 0 && v !== "unknown";

export function runShadowParity(bundle) {
  // 1. Canonical read status precedence -- short-circuit BEFORE any comparison.
  const cstatus = bundle?.canonicalRead?.status;
  if (cstatus === "PERMISSION_DENIED") return blocked(bundle, "BLOCKED_PERMISSION", "canonical read permission denied");
  if (cstatus === "UNAVAILABLE") return blocked(bundle, "BLOCKED_UNAVAILABLE", "canonical read unavailable");
  if (cstatus !== "OK") return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", "canonical read status missing or unknown");

  // 2. Required inputs present as arrays; adapter/app commit required.
  const required = {
    "canonicalRead.rows": bundle?.canonicalRead?.rows, "staticCatalog.rows": bundle?.staticCatalog?.rows,
    ledgerSnapshot: bundle?.ledgerSnapshot, reorderSnapshot: bundle?.reorderSnapshot, poSnapshot: bundle?.poSnapshot,
  };
  for (const [name, val] of Object.entries(required)) {
    if (!Array.isArray(val)) return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", `missing required input: ${name}`);
  }
  if (!isNonEmptyStr(bundle.adapterCommit)) return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", "missing adapterCommit / build identifier");

  // 3. Derive counts + hash; verify any supplied metadata.
  const counts = deriveCounts(bundle);
  const staticCatalogHash = deriveStaticCatalogHash(bundle.staticCatalog.rows);
  if (bundle.sourceCounts && !countsEqual(bundle.sourceCounts, counts)) {
    return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", "supplied sourceCounts disagree with captured content");
  }
  if (bundle.staticCatalog.contentHash && bundle.staticCatalog.contentHash !== staticCatalogHash) {
    return blocked(bundle, "BLOCKED_INCOMPLETE_INPUT", "supplied contentHash disagrees with captured static rows");
  }

  // 4. Derive overlays from the captured snapshots (caller overlay objects ignored).
  const overlayBySku = deriveLedgerOverlay(bundle.ledgerSnapshot, bundle.staticCatalog.rows);
  const workflowBySku = deriveWorkflowBySku(bundle.reorderSnapshot, bundle.poSnapshot);

  // 5. Build BOTH models from the same derived structures and compare explicitly.
  const currentRows = buildCurrentModel(bundle, overlayBySku, workflowBySku);
  const { rows: shadowRows, ws } = buildShadowModel(bundle, overlayBySku, workflowBySku);
  const modelDivergences = compareModels(currentRows, shadowRows);

  // 6. Adapter self-validation issues = additional evidence (not the comparison).
  const has = (code) => ws.issues.filter((i) => i.code === code).length;
  const nameDivergenceCount = has("NAME_DIVERGENCE");
  const normalizedUnitDivergenceCount = has("UNIT_DIVERGENCE");
  const unexpectedUnmatchedCount = has("STATIC_WITHOUT_CANONICAL_UNAPPROVED") + has("CANONICAL_WITHOUT_STATIC");
  let structuralIssueCount = has("DUPLICATE_CANONICAL_PARTID") + has("DUPLICATE_STATIC_SKU") + has("MISSING_IDENTIFIER");
  for (const row of ws.rows) structuralIssueCount += validateRowProvenance(row).length;

  const kind = (k) => modelDivergences.filter((d) => d.kind === k).length;
  const fullyAccounted = ws.totals.canonicalMatch + ws.totals.staticOnlyExcluded === counts.static;

  const divergent =
    modelDivergences.length > 0 || unexpectedUnmatchedCount > 0 || structuralIssueCount > 0 || !fullyAccounted;
  const status = divergent ? "FAIL_PARITY" : "PASS";

  return {
    status,
    evidence: baseEvidence(bundle, {
      status, reason: divergent ? "current-vs-shadow parity divergence" : null,
      staticCatalogHash, sourceCounts: counts,
      canonicalMatchCount: ws.totals.canonicalMatch, staticOnlyExcludedCount: ws.totals.staticOnlyExcluded,
      // model-to-model comparison (primary)
      rowMissingCount: kind("CURRENT_SHADOW_ROW_MISSING"),
      fieldDivergenceCount: kind("CURRENT_SHADOW_FIELD_DIVERGENCE"),
      availabilityDivergenceCount: kind("CURRENT_SHADOW_AVAILABILITY_DIVERGENCE"),
      workflowDivergenceCount: kind("CURRENT_SHADOW_WORKFLOW_DIVERGENCE"),
      // adapter self-validation (additional evidence)
      unexpectedUnmatchedCount, nameDivergenceCount, normalizedUnitDivergenceCount, structuralIssueCount,
      fullyAccounted,
      divergences: modelDivergences.map((d) => ({ key: d.key, kind: d.kind })), // sanitized {key,kind}
    }),
  };
}
