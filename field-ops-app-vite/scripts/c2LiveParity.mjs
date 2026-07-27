// INV-CONVERGENCE-E C2 -- fresh LIVE pre-deployment parity for the PartDetail cutover.
//
// Decision #46 requires live parity "immediately before the switch," and DECISIONS #49
// placed that requirement on the C2 HOSTING DEPLOYMENT gate (not the repository merge).
// This script is that check. It is run by the OPERATOR in an authenticated environment
// immediately before `firebase deploy --only hosting`, against a live read-only export
// of the canonical `parts` collection.
//
// DETERMINISTIC RUN BOUNDARY (Stage A §A.1): the operator captures ONE immutable
// canonical payload file first; this script is a pure function of that single frozen
// file plus the in-repo static compatibility catalog. It performs NO network I/O, holds
// NO credentials, and never writes to Firestore. Both the C1 list model and the C2
// detail model are built from the same frozen capture, so no temporal skew is possible.
//
// It exercises the REAL shipped C2 code path -- buildPartDetailView / selectPartLedger /
// buildPartsCatalogRows -- against LIVE canonical data, and reuses the app's own
// governed REST->view mapping (toPartListView), so this is not a parallel reimplementation.
//
// Usage:
//   node scripts/c2LiveParity.mjs <canonical-parts-rest.json> <out-dir> [capture-start] [capture-end]
//
// Exit 0 only on PASS. Any BLOCKED_* or FAIL_PARITY exits nonzero -> the runbook STOPs
// and the deployment does not proceed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { toPartListView } from "../src/domain/partMasterView.js";
import { buildPartsCatalogRows } from "../src/domain/partsCatalogView.js";
import { buildPartDetailView, selectPartLedger } from "../src/domain/partDetailView.js";
import { APPROVED_STATIC_ONLY_EXCLUSIONS, normalizeUnit } from "../src/domain/partsCompatibilityAdapter.js";

const [, , payloadPath, outDir, captureStart, captureEnd] = process.argv;
if (!payloadPath || !outDir) {
  console.error("usage: node scripts/c2LiveParity.mjs <canonical-parts-rest.json> <out-dir> [capture-start] [capture-end]");
  process.exit(2);
}

const fail = (status, reason, extra = {}) => {
  const result = { status, reason, ...extra };
  emit(result);
  console.error(`C2-LIVE-PARITY ${status}: ${reason}`);
  process.exit(1);
};

function emit(result) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "c2-live-parity.json"), JSON.stringify(result, null, 2) + "\n");
}

// ---- 1. Load the frozen capture -------------------------------------------
const raw = fs.readFileSync(payloadPath, "utf8");
const payloadSha256 = crypto.createHash("sha256").update(raw).digest("hex");
// Deterministic run id derived from the capture itself (no clock, no randomness --
// re-running on the same capture reproduces the same run id and the same result).
const runId = `c2-live-${payloadSha256.slice(0, 16)}`;

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  fail("BLOCKED_INCOMPLETE_INPUT", "canonical capture is not valid JSON", { runId, payloadSha256 });
}

// A denied/unavailable capture MUST become the matching BLOCKED_* -- never an empty
// canonical list, never "190 missing", never a parity failure (Stage A §A.2).
if (payload && payload.error) {
  const code = payload.error.status || payload.error.code;
  const denied = code === "PERMISSION_DENIED" || code === 403;
  fail(denied ? "BLOCKED_PERMISSION" : "BLOCKED_UNAVAILABLE",
    `canonical read returned an error (${code})`, { runId, payloadSha256 });
}

// ---- 2. Firestore REST -> the app's own governed view mapping ---------------
/** Convert one Firestore REST typed value to a plain JS value. */
function restValue(v) {
  if (v == null || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(restValue);
  if ("mapValue" in v) return restFields(v.mapValue.fields || {});
  return null;
}
function restFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = restValue(v);
  return out;
}

const documents = Array.isArray(payload?.documents) ? payload.documents
  : Array.isArray(payload) ? payload
  : null;
if (!documents) {
  fail("BLOCKED_INCOMPLETE_INPUT", "capture has no `documents` array (unexpected shape)", { runId, payloadSha256 });
}
if (payload && payload.nextPageToken) {
  // A truncated capture would understate canonical coverage and could look like a
  // parity failure. Incomplete input BLOCKS -- it is never compared.
  fail("BLOCKED_INCOMPLETE_INPUT", "capture is paginated (nextPageToken present) -- capture is incomplete", { runId, payloadSha256 });
}

const docs = documents.map((d) => ({
  id: typeof d.name === "string" ? d.name.split("/").pop() : d.id,
  data: d.fields ? restFields(d.fields) : (d.data || {}),
}));

const listView = toPartListView(docs);

// A malformed canonical RECORD is incomplete input, not a parity result.
//
// toPartListView() diverts any structurally invalid document into `invalid` and returns
// only the well-formed ones in `parts`. Without this gate, a capture holding all 190
// expected valid records PLUS a corrupt canonical document would still compose
// 190 + 10 = 200 with zero divergences and report PASS -- silently deploying while a
// real canonical record was unreadable. Incomplete input must BLOCK, never compare.
//
// Sanitization: only the COUNT is recorded. No document id, field, or body from the
// malformed record enters the evidence (its contents are unvalidated and may be
// arbitrary). The operator can inspect the offending records in their own local
// capture, which is never committed.
const canonicalInvalidCount = Array.isArray(listView.invalid) ? listView.invalid.length : 0;
if (canonicalInvalidCount > 0) {
  fail("BLOCKED_INCOMPLETE_INPUT",
    `canonical capture contains ${canonicalInvalidCount} malformed Part record(s) -- incomplete input is never compared`,
    { runId, payloadSha256, staticCatalogSha256: null, counts: { canonicalDocuments: docs.length, canonicalValid: listView.parts.length, canonicalInvalid: canonicalInvalidCount } });
}

const canonicalRead = { status: "OK", rows: listView.parts };

// ---- 3. Static compatibility catalog (in-repo, the composition INPUT) -------
const catalogSrc = fs.readFileSync(new URL("../src/data/partsCatalog.ts", import.meta.url), "utf8");
const catRe = /\{\s*sku:\s*"([^"]+)",\s*name:\s*"((?:[^"\\]|\\.)*)",\s*category:\s*"([^"]+)",\s*unit:\s*"([^"]+)",\s*cost:\s*([\d.]+),\s*price:\s*([\d.]+),\s*reorderThreshold:\s*(\d+),\s*warehouseQty:\s*(\d+)\s*\}/g;
const STATIC = [];
for (let m; (m = catRe.exec(catalogSrc)); ) {
  STATIC.push({
    sku: m[1], name: m[2].replace(/\\"/g, '"'), category: m[3], unit: m[4],
    cost: Number(m[5]), price: Number(m[6]), reorderThreshold: Number(m[7]), warehouseQty: Number(m[8]),
  });
}
const staticCatalogSha256 = crypto.createHash("sha256").update(catalogSrc).digest("hex");
if (STATIC.length === 0) {
  fail("BLOCKED_INCOMPLETE_INPUT", "static compatibility catalog failed to parse", { runId, payloadSha256 });
}

// ---- 4. C1 list composition (must still be READY -- C2 rides on it) ---------
const list = buildPartsCatalogRows({ canonicalRead, staticCatalog: STATIC });
if (list.status !== "READY") {
  fail(list.status, `C1 list composition is not READY against the live capture (${list.meta?.reason ?? "no reason"})`, {
    runId, payloadSha256, staticCatalogSha256, listMeta: list.meta,
  });
}

// ---- 5. C2 detail composition for EVERY static sku --------------------------
const divergences = [];
let readyCount = 0;
for (const s of STATIC) {
  const d = buildPartDetailView({ canonicalRead, staticCatalog: STATIC, partId: s.sku });
  if (d.status !== "READY") {
    divergences.push({ sku: s.sku, kind: "NOT_READY", detail: d.status });
    continue;
  }
  readyCount += 1;
  const p = d.part;
  // identity must be preserved exactly -- no rewrite, no remap
  if (p.partId !== s.sku || p.sku !== s.sku) divergences.push({ sku: s.sku, kind: "IDENTITY_REWRITE", detail: `${p.partId}/${p.sku}` });
  // commercial + baseline remain the unchanged STATIC_FALLBACK values (UD-3/UD-4 pending)
  if (p.cost !== s.cost) divergences.push({ sku: s.sku, kind: "COST_CHANGED", detail: `${s.cost}->${p.cost}` });
  if (p.price !== s.price) divergences.push({ sku: s.sku, kind: "PRICE_CHANGED", detail: `${s.price}->${p.price}` });
  if (p.reorderThreshold !== s.reorderThreshold) divergences.push({ sku: s.sku, kind: "REORDER_THRESHOLD_CHANGED" });
  if (p.warehouseQty !== s.warehouseQty) divergences.push({ sku: s.sku, kind: "WAREHOUSE_QTY_CHANGED" });
  // ratified D-C2-1: the rendered unit is the canonical normalized stocking code
  if (p.unit !== normalizeUnit(s.unit)) divergences.push({ sku: s.sku, kind: "UNIT_DIVERGENCE", detail: `${p.unit} != ${normalizeUnit(s.unit)}` });
  // the route the C1 list emits must resolve to this very detail record
  const listRow = list.rows.find((r) => r.sku === s.sku);
  if (!listRow) divergences.push({ sku: s.sku, kind: "MISSING_FROM_LIST" });
  // paired ledger re-point: the resolved identity must select this part's slice
  const probe = [{ id: "probe", partId: s.sku, timestamp: 1 }, { id: "other", partId: "__NOT_THIS_PART__", timestamp: 2 }];
  const sel = selectPartLedger({ transactions: probe, healthEntries: [], resolvedPartId: p.partId });
  if (sel.transactions.length !== 1 || sel.transactions[0].id !== "probe") {
    divergences.push({ sku: s.sku, kind: "LEDGER_KEY_MISMATCH" });
  }
}

// ---- 6. Fail-closed behavior must hold against the live capture -------------
const blockedProbes = [
  ["PERMISSION_DENIED", "BLOCKED_PERMISSION"],
  ["UNAVAILABLE", "BLOCKED_UNAVAILABLE"],
  ["LOADING", "BLOCKED_INCOMPLETE_INPUT"],
];
for (const [status, expected] of blockedProbes) {
  const d = buildPartDetailView({ canonicalRead: { status }, staticCatalog: STATIC, partId: STATIC[0].sku });
  if (d.status !== expected || d.part !== null) {
    divergences.push({ sku: STATIC[0].sku, kind: "FAIL_CLOSED_BROKEN", detail: `${status} -> ${d.status}` });
  }
}

// ---- 7. Result --------------------------------------------------------------
const excluded = list.rows.filter((r) => r.identityState === "STATIC_ONLY_EXCLUDED").map((r) => r.sku).sort();
const approved = [...APPROVED_STATIC_ONLY_EXCLUSIONS].sort();
const exclusionsMatch = excluded.length === approved.length && excluded.every((v, i) => v === approved[i]);
if (!exclusionsMatch) {
  divergences.push({ sku: "-", kind: "EXCLUSION_SET_DRIFT", detail: `${excluded.length} excluded, expected the approved ${approved.length}` });
}

const result = {
  gate: "INV-CONVERGENCE-E C2 Hosting deployment -- fresh live pre-deploy parity",
  status: divergences.length === 0 && readyCount === STATIC.length ? "PASS" : "FAIL_PARITY",
  runId,
  capture: {
    payloadSha256,
    captureStart: captureStart ?? null,
    captureEnd: captureEnd ?? null,
    staticCatalogSha256,
  },
  counts: {
    canonicalDocuments: docs.length,
    canonicalValid: listView.parts.length,
    canonicalInvalid: canonicalInvalidCount, // always 0 here -- a nonzero count BLOCKED above
    staticCatalog: STATIC.length,
    listRows: list.rows.length,
    canonicalMatch: list.meta.canonicalMatch,
    staticOnlyExcluded: list.meta.staticOnlyExcluded,
    detailReady: readyCount,
  },
  listMeta: list.meta,
  exclusionSetMatchesApproved: exclusionsMatch,
  divergences,
};

emit(result);
console.log(`C2-LIVE-PARITY ${result.status}`);
console.log(`  runId=${runId} payloadSha256=${payloadSha256.slice(0, 16)}…`);
console.log(`  canonical=${result.counts.canonicalValid} static=${result.counts.staticCatalog} detailReady=${readyCount}`);
console.log(`  canonicalMatch=${list.meta.canonicalMatch} staticOnlyExcluded=${list.meta.staticOnlyExcluded}`);
console.log(`  nameDivergence=${list.meta.nameDivergenceCount} unitDivergence=${list.meta.unitDivergenceCount}`);
if (divergences.length) {
  console.error(`  ${divergences.length} divergence(s):`);
  for (const d of divergences.slice(0, 20)) console.error(`    ${d.sku} ${d.kind} ${d.detail ?? ""}`);
  process.exit(1);
}
if (readyCount !== STATIC.length) {
  console.error(`  detailReady ${readyCount} != static ${STATIC.length}`);
  process.exit(1);
}
console.log("  C2-LIVE-PARITY-PASS");
