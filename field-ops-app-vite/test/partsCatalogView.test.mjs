// INV-CONVERGENCE-E C1 -- deterministic OFFLINE tests for buildPartsCatalogRows,
// the governed PartsList catalog composition. Plain Node (house client-test
// convention). No Firebase, no credentials, no network, no production access:
// fixtures are the committed production zero-write read-back (190 canonical) and
// the static catalog (200). Offline parity here is NOT the live pre-cutover
// shadow-parity; it proves the pure composition + BLOCKED semantics.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPartsCatalogRows,
  nameBySkuFromRows,
  resolveCanonicalPartNames,
  canonicalNameBySku,
  partNamesBoundaryKey,
  selectCanonicalReadForKey,
  isCatalogBlocked,
  partCatalogRoute,
  CATALOG_STATES,
} from "../src/domain/partsCatalogView.js";
import { APPROVED_STATIC_ONLY_EXCLUSIONS } from "../src/domain/partsCompatibilityAdapter.js";

const rel = (p) => new URL(p, new URL("../", import.meta.url));
const CATALOG_SRC = fs.readFileSync(rel("src/data/partsCatalog.ts"), "utf8");
const PARTSLIST_SRC = fs.readFileSync(rel("src/modules/inventory/PartsList.jsx"), "utf8");
const POSTWRITE = JSON.parse(fs.readFileSync(
  rel("../docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/row-results.json"), "utf8"));

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partsCatalogView.test.mjs");

// ---- fixtures (offline) ----------------------------------------------------
const catRe = /\{\s*sku:\s*"([^"]+)",\s*name:\s*"((?:[^"\\]|\\.)*)",\s*category:\s*"([^"]+)",\s*unit:\s*"([^"]+)",\s*cost:\s*([\d.]+),\s*price:\s*([\d.]+),\s*reorderThreshold:\s*(\d+),\s*warehouseQty:\s*(\d+)\s*\}/g;
const STATIC = [];
for (let m; (m = catRe.exec(CATALOG_SRC)); ) {
  STATIC.push({ sku: m[1], name: m[2].replace(/\\"/g, '"'), category: m[3], unit: m[4],
    cost: Number(m[5]), price: Number(m[6]), reorderThreshold: Number(m[7]), warehouseQty: Number(m[8]) });
}
const reSummary = /^(TST-\d{4})\s+"(.*)"\s+unit=(\S+)\s+status=(\S+)$/;
const CANONICAL = POSTWRITE.map((r) => {
  const mm = reSummary.exec(r.currentSummary || "");
  return { partId: r.proposedPartId, name: mm ? mm[2] : null, stockingUnit: mm ? mm[3] : null, status: mm ? mm[4] : null };
});
const OK = () => ({ status: "OK", rows: CANONICAL });

// sanity on fixtures themselves
check("fixture sanity: 200 static, 190 canonical", () => {
  assert.equal(STATIC.length, 200);
  assert.equal(CANONICAL.length, 190);
});

// ---- READY: full visibility, identity states -------------------------------
check("READY: all 200 records visible (190 CANONICAL_MATCH + 10 STATIC_ONLY_EXCLUDED)", () => {
  const { status, rows, meta } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  assert.equal(status, "READY");
  assert.equal(rows.length, 200);
  assert.equal(rows.filter((r) => r.identityState === "CANONICAL_MATCH").length, 190);
  assert.equal(rows.filter((r) => r.identityState === "STATIC_ONLY_EXCLUDED").length, 10);
  assert.equal(meta.fullyAccounted, true);
});
check("READY: the ten static-only exclusions are exactly the approved set", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const excluded = rows.filter((r) => r.identityState === "STATIC_ONLY_EXCLUDED").map((r) => r.sku).sort();
  assert.deepEqual(excluded, [...APPROVED_STATIC_ONLY_EXCLUSIONS].sort());
});

// ---- stable IDs / routes / no duplicates / no drops ------------------------
check("stable IDs: every sku is a non-empty string equal to a static sku", () => {
  const staticSkus = new Set(STATIC.map((s) => s.sku));
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  for (const r of rows) {
    assert.ok(typeof r.sku === "string" && r.sku.length > 0);
    assert.ok(staticSkus.has(r.sku), `sku ${r.sku} must exist in the static catalog`);
  }
});
check("no duplicates: sku set size equals row count", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  assert.equal(new Set(rows.map((r) => r.sku)).size, rows.length);
});
check("no dropped Parts: every static sku is present exactly once", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const rowSkus = new Set(rows.map((r) => r.sku));
  for (const s of STATIC) assert.ok(rowSkus.has(s.sku), `static sku ${s.sku} must be visible`);
  assert.equal(rowSkus.size, STATIC.length);
});
check("route contract: partCatalogRoute keys on sku, NOT the display name", () => {
  // name deliberately unrelated to sku -> route must still be the sku.
  assert.equal(partCatalogRoute({ sku: "TST-1001", name: "Totally Different Name" }), "/inventory/TST-1001");
  assert.equal(partCatalogRoute({ sku: "TST-1193", name: "x" }), "/inventory/TST-1193");
});
check("route contract: position-independent (same sku at different indices -> same route)", () => {
  const a = [{ sku: "TST-1001", name: "A" }, { sku: "TST-1002", name: "B" }];
  const b = [{ sku: "TST-1002", name: "B" }, { sku: "TST-1001", name: "A" }];
  assert.equal(partCatalogRoute(a[0]), partCatalogRoute(b[1])); // TST-1001 in both -> identical route regardless of index
  assert.notEqual(partCatalogRoute(a[0]), partCatalogRoute(a[1]));
});
check("route contract: every composed row routes to /inventory/<its own sku> (detail-link continuity)", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const bySku = new Map(STATIC.map((s) => [s.sku, s]));
  for (const r of rows) {
    assert.equal(partCatalogRoute(r), `/inventory/${r.sku}`);
    assert.ok(bySku.has(r.sku), `route target ${r.sku} must resolve to a real static/PartDetail row`);
  }
});
check("PartsList catalog link is wired to partCatalogRoute(composed row), not name/index", () => {
  // Extracted-contract + structural proof that the RENDERED catalog link uses the
  // composed row's sku. The catalog table maps the composed `pagedParts` rows, keys
  // each row by its sku, and builds the Link via partCatalogRoute(part).
  assert.ok(/import\s*\{[^}]*\bpartCatalogRoute\b[^}]*\}\s*from\s*"\.\.\/\.\.\/domain\/partsCatalogView"/.test(PARTSLIST_SRC),
    "PartsList must import partCatalogRoute from the governed catalog view");
  assert.ok(/pagedParts\.map\(\(part\)\s*=>/.test(PARTSLIST_SRC),
    "the catalog table must map the composed pagedParts rows");
  assert.ok(/<tr key=\{part\.sku\}>/.test(PARTSLIST_SRC),
    "each catalog row must be keyed by the composed row's sku");
  assert.ok(/<Link to=\{partCatalogRoute\(part\)\}>\{part\.name\}<\/Link>/.test(PARTSLIST_SRC),
    "the catalog Link must route via partCatalogRoute(part) (sku), rendering part.name as label");
  // negative guards: the catalog link must NOT route by display name or an index
  assert.ok(!/to=\{`\/inventory\/\$\{part\.name\}`\}/.test(PARTSLIST_SRC), "catalog link must not route by part.name");
  assert.ok(!/\.map\(\(part,\s*\w+\)\s*=>[^]*?to=\{`\/inventory\/\$\{\w+\}`\}/.test(PARTSLIST_SRC), "catalog link must not route by array index");
});
check("partCatalogRoute is defensive on a missing sku (no 'undefined' in the path)", () => {
  assert.equal(partCatalogRoute({ name: "no sku" }), "/inventory/");
  assert.equal(partCatalogRoute(null), "/inventory/");
});

// ---- identity/metadata values ----------------------------------------------
check("CANONICAL_MATCH row carries canonical-preferred name/category + static warehouseQty baseline", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const s = STATIC.find((x) => x.sku === "TST-1001"); // a canonical match
  const row = rows.find((r) => r.sku === "TST-1001");
  assert.equal(row.identityState, "CANONICAL_MATCH");
  assert.equal(row.name, s.name);            // 0 name divergence in fixtures -> equals static
  assert.equal(row.category, s.category);
  assert.equal(row.warehouseQty, s.warehouseQty); // static baseline, unchanged value
});
check("STATIC_ONLY_EXCLUDED row sources name/category/warehouseQty from static", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const sku = APPROVED_STATIC_ONLY_EXCLUSIONS[0];
  const s = STATIC.find((x) => x.sku === sku);
  const row = rows.find((r) => r.sku === sku);
  assert.equal(row.identityState, "STATIC_ONLY_EXCLUDED");
  assert.equal(row.name, s.name);
  assert.equal(row.category, s.category);
  assert.equal(row.warehouseQty, s.warehouseQty);
});
check("categories derivable and non-empty (drives the category filter)", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const cats = new Set(rows.map((r) => r.category));
  assert.ok(cats.size > 0);
  for (const c of cats) assert.ok(typeof c === "string" && c.length > 0);
});
check("nameBySkuFromRows covers all 200 when READY", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const map = nameBySkuFromRows(rows);
  assert.equal(map.size, 200);
  assert.equal(map.get("TST-1001"), STATIC.find((s) => s.sku === "TST-1001").name);
});

// ---- BLOCKED states: never an empty list presented as success --------------
check("BLOCKED_PERMISSION on permission-denied canonical read (rows empty, not READY)", () => {
  const { status, rows } = buildPartsCatalogRows({ canonicalRead: { status: "PERMISSION_DENIED" }, staticCatalog: STATIC });
  assert.equal(status, "BLOCKED_PERMISSION");
  assert.equal(rows.length, 0);
  assert.ok(isCatalogBlocked(status));
});
check("BLOCKED_UNAVAILABLE on unavailable canonical read", () => {
  const { status, rows } = buildPartsCatalogRows({ canonicalRead: { status: "UNAVAILABLE" }, staticCatalog: STATIC });
  assert.equal(status, "BLOCKED_UNAVAILABLE");
  assert.equal(rows.length, 0);
});
check("BLOCKED_INCOMPLETE_INPUT on missing/unknown canonical status", () => {
  for (const cr of [{}, { status: "WHATEVER" }, { status: "OK" }]) {
    // note: {status:"OK"} without rows array is incomplete
    const res = buildPartsCatalogRows({ canonicalRead: cr, staticCatalog: STATIC });
    assert.equal(res.status, "BLOCKED_INCOMPLETE_INPUT");
    assert.equal(res.rows.length, 0);
  }
});
check("a Part missing from the canonical read is EXCLUDED and surfaced -- never promoted, never an outage", () => {
  // UPDATED 2026-08-17 (Owner-ratified authority direction). Dropping a canonical part leaves its
  // static sku as STATIC_WITHOUT_CANONICAL_UNAPPROVED. That is still never promoted into a row --
  // the fail-closed direction that matters is untouched -- but it no longer blocks the ENTIRE
  // catalog, because one legacy mismatch must not suppress every other valid governed Part.
  const dropped = CANONICAL.filter((c) => c.partId !== "TST-1001");
  const res = buildPartsCatalogRows({ canonicalRead: { status: "OK", rows: dropped }, staticCatalog: STATIC });
  assert.equal(res.status, "READY");
  // The dropped id is NOT served from the static mirror...
  assert.equal(res.rows.some((r) => r.key === "TST-1001"), false, "static-only data must not be promoted");
  // ...the mismatch is surfaced as evidence...
  assert.equal(res.meta.staticWithoutCanonicalCount >= 1, true);
  // ...and every remaining canonical Part still renders.
  assert.equal(res.rows.length > 0, true, "one mismatch must not empty the catalog");
});
// ---- fail-closed on INVALID canonical documents (fetchPartMasterList's `invalid`) -------------------
check("BLOCKED when the canonical read reports non-empty invalid documents (never silently dropped)", () => {
  const res = buildPartsCatalogRows({ canonicalRead: { ...OK(), invalid: [{ id: "x", invalid: true }] }, staticCatalog: STATIC });
  assert.equal(res.status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(res.rows.length, 0);
  assert.equal(res.meta.invalidCount, 1);
});
check("a malformed canonical doc overlapping an approved STATIC_ONLY_EXCLUDED sku STILL blocks (exclusion cannot mask it)", () => {
  const res = buildPartsCatalogRows({ canonicalRead: { ...OK(), invalid: [{ partId: "TST-1047", invalid: true }] }, staticCatalog: STATIC });
  assert.equal(res.status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(res.rows.length, 0);
});
check("malformed invalid metadata (not an array) blocks", () => {
  assert.equal(buildPartsCatalogRows({ canonicalRead: { ...OK(), invalid: "nope" }, staticCatalog: STATIC }).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("empty invalid array is backward-compatible (still READY); absent invalid unchanged", () => {
  assert.equal(buildPartsCatalogRows({ canonicalRead: { ...OK(), invalid: [] }, staticCatalog: STATIC }).status, "READY");
  assert.equal(buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC }).status, "READY");
});
check("invalid blocking surfaces only a sanitized count, never raw canonical document data", () => {
  const res = buildPartsCatalogRows({ canonicalRead: { ...OK(), invalid: [{ partId: "TST-1047", secretField: "raw-value", invalid: true }] }, staticCatalog: STATIC });
  const blob = JSON.stringify(res);
  assert.equal(blob.includes("secretField"), false);
  assert.equal(blob.includes("raw-value"), false);
});
check("BLOCKED_INCOMPLETE_INPUT on empty/missing static catalog", () => {
  assert.equal(buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: [] }).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(buildPartsCatalogRows({ canonicalRead: OK() }).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("nameBySkuFromRows empty under BLOCKED", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: { status: "PERMISSION_DENIED" }, staticCatalog: STATIC });
  assert.equal(nameBySkuFromRows(rows).size, 0);
});

// ---- purity ----------------------------------------------------------------
check("purity: same inputs -> deep-equal output; inputs not mutated", () => {
  const staticCopy = JSON.parse(JSON.stringify(STATIC));
  const canonCopy = JSON.parse(JSON.stringify(CANONICAL));
  const a = buildPartsCatalogRows({ canonicalRead: { status: "OK", rows: CANONICAL }, staticCatalog: STATIC });
  const b = buildPartsCatalogRows({ canonicalRead: { status: "OK", rows: CANONICAL }, staticCatalog: STATIC });
  assert.deepEqual(a, b);
  assert.deepEqual(STATIC, staticCopy);     // inputs unchanged
  assert.deepEqual(CANONICAL, canonCopy);
});
check("CATALOG_STATES enumerates exactly the produced statuses", () => {
  assert.deepEqual([...CATALOG_STATES].sort(), ["BLOCKED_INCOMPLETE_INPUT", "BLOCKED_PERMISSION", "BLOCKED_UNAVAILABLE", "READY"].sort());
});

// ---- OD-3: resolveCanonicalPartNames (PartsManagerHome / PartsAssociateHome name resolution) --------
check("resolveCanonicalPartNames READY: namesReady, 190 canonical names, a known partId maps to its canonical name", () => {
  const r = resolveCanonicalPartNames({ canonicalRead: OK(), staticCatalog: STATIC });
  assert.equal(r.namesReady, true);
  assert.equal(r.status, "READY");
  assert.equal(r.nameBySku.size, 190);
  const first = CANONICAL[0];
  assert.equal(r.nameBySku.get(first.partId), first.name);
});
check("resolveCanonicalPartNames (decision #2): STATIC_ONLY_EXCLUDED sku is NOT in the map -> caller degrades to partId; static name never surfaced", () => {
  const r = resolveCanonicalPartNames({ canonicalRead: OK(), staticCatalog: STATIC });
  for (const sku of APPROVED_STATIC_ONLY_EXCLUSIONS) {
    assert.equal(r.nameBySku.has(sku), false);
    // the static catalog DOES carry a name for these skus; prove we did not leak it
    const staticName = STATIC.find((s) => s.sku === sku)?.name;
    assert.ok(staticName);
    assert.notEqual(r.nameBySku.get(sku), staticName);
  }
});
check("resolveCanonicalPartNames: a partId absent from canonical entirely is not in the map", () => {
  const r = resolveCanonicalPartNames({ canonicalRead: OK(), staticCatalog: STATIC });
  assert.equal(r.nameBySku.has("TST-0000-NONEXISTENT"), false);
});
check("resolveCanonicalPartNames fails closed on PERMISSION_DENIED / UNAVAILABLE / incomplete -> namesReady false, empty map", () => {
  for (const canonicalRead of [{ status: "PERMISSION_DENIED" }, { status: "UNAVAILABLE" }, { status: "WHAT" }, {}]) {
    const r = resolveCanonicalPartNames({ canonicalRead, staticCatalog: STATIC });
    assert.equal(r.namesReady, false);
    assert.equal(r.nameBySku.size, 0);
  }
});
check("resolveCanonicalPartNames fails closed on invalid / malformed-invalid canonical documents -> empty map, no leak", () => {
  const nonEmpty = resolveCanonicalPartNames({ canonicalRead: { ...OK(), invalid: [{ partId: "TST-1001", secretField: "raw-value" }] }, staticCatalog: STATIC });
  assert.equal(nonEmpty.namesReady, false);
  assert.equal(nonEmpty.nameBySku.size, 0);
  const malformed = resolveCanonicalPartNames({ canonicalRead: { ...OK(), invalid: "nope" }, staticCatalog: STATIC });
  assert.equal(malformed.namesReady, false);
  assert.equal(malformed.nameBySku.size, 0);
  // nothing in either result carries the raw invalid content
  const dump = JSON.stringify([...nonEmpty.nameBySku.entries()]) + JSON.stringify([...malformed.nameBySku.entries()]);
  assert.equal(dump.includes("raw-value"), false);
  assert.equal(dump.includes("secretField"), false);
});
check("resolveCanonicalPartNames: every map value is a canonical name string (no null/object leakage)", () => {
  const r = resolveCanonicalPartNames({ canonicalRead: OK(), staticCatalog: STATIC });
  for (const v of r.nameBySku.values()) assert.equal(typeof v, "string");
});

// ---- OD-3 (Codex P2): render-time boundary-key selection (synchronous, effect-independent) --------
check("partNamesBoundaryKey is distinct per (uid, accessVersion) and stable for the same inputs", () => {
  assert.equal(partNamesBoundaryKey("u1", 1), partNamesBoundaryKey("u1", 1));
  assert.notEqual(partNamesBoundaryKey("u1", 1), partNamesBoundaryKey("u1", 2)); // access change
  assert.notEqual(partNamesBoundaryKey("u1", 1), partNamesBoundaryKey("u2", 1)); // user change
  assert.notEqual(partNamesBoundaryKey("u1", undefined), partNamesBoundaryKey("u1", 0)); // absent vs 0
});
check("selectCanonicalReadForKey: stored data used ONLY on exact key match", () => {
  const okRead = { status: "OK", rows: CANONICAL, invalid: [] };
  const stored = { key: partNamesBoundaryKey("u1", 1), read: okRead };
  // exact match -> the stored read is returned verbatim
  assert.equal(selectCanonicalReadForKey(stored, partNamesBoundaryKey("u1", 1)), okRead);
});
check("selectCanonicalReadForKey: ANY key mismatch -> LOADING synchronously (prior-boundary data never reused)", () => {
  const okRead = { status: "OK", rows: CANONICAL, invalid: [] };
  const stored = { key: partNamesBoundaryKey("u1", 1), read: okRead };
  for (const mismatch of [partNamesBoundaryKey("u1", 2), partNamesBoundaryKey("u2", 1), partNamesBoundaryKey(undefined, undefined)]) {
    const sel = selectCanonicalReadForKey(stored, mismatch);
    assert.equal(sel.status, "LOADING");
    assert.notEqual(sel, okRead);
  }
});
check("render-time guard end to end: mismatched-key OK data resolves to an EMPTY name map (no stale names), independent of any effect", () => {
  const stored = { key: partNamesBoundaryKey("u1", 1), read: { status: "OK", rows: CANONICAL, invalid: [] } };
  // A render under a NEW access boundary selects LOADING, so names are empty on that same render.
  const canonicalRead = selectCanonicalReadForKey(stored, partNamesBoundaryKey("u1", 2));
  const r = resolveCanonicalPartNames({ canonicalRead, staticCatalog: STATIC });
  assert.equal(r.namesReady, false);
  assert.equal(r.nameBySku.size, 0);
  // whereas the matching key still resolves the full canonical map
  const matched = resolveCanonicalPartNames({ canonicalRead: selectCanonicalReadForKey(stored, partNamesBoundaryKey("u1", 1)), staticCatalog: STATIC });
  assert.equal(matched.namesReady, true);
  assert.equal(matched.nameBySku.size, 190);
});

// ---- OD-3 (shared InventoryHealthPanel gate): canonicalNameBySku + null-sentinel key select --------
check("canonicalNameBySku: names ONLY from CANONICAL_MATCH composed rows; excluded skus omitted (caller degrades to partId)", () => {
  const { rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  const map = canonicalNameBySku(rows);
  assert.equal(map.size, 190);
  // a CANONICAL_MATCH sku resolves to its canonical name
  assert.equal(map.get(CANONICAL[0].partId), CANONICAL[0].name);
  // every approved STATIC_ONLY_EXCLUDED sku is ABSENT (so the caller shows the raw partId, never static)
  for (const sku of APPROVED_STATIC_ONLY_EXCLUSIONS) assert.equal(map.has(sku), false);
});
check("canonicalNameBySku: empty/non-array rows -> empty map", () => {
  assert.equal(canonicalNameBySku([]).size, 0);
  assert.equal(canonicalNameBySku(undefined).size, 0);
});
check("selectCanonicalReadForKey null-sentinel: mismatch -> null (LOADING contract for compose-based consumers); match -> stored read", () => {
  const okRead = { status: "OK", rows: CANONICAL, invalid: [] };
  const stored = { key: partNamesBoundaryKey("u1", 1), read: okRead };
  assert.equal(selectCanonicalReadForKey(stored, partNamesBoundaryKey("u1", 2), null), null);
  assert.equal(selectCanonicalReadForKey(stored, partNamesBoundaryKey("u1", 1), null), okRead);
  // default sentinel still {status:LOADING} on mismatch (backward-compatible)
  assert.equal(selectCanonicalReadForKey(stored, partNamesBoundaryKey("u1", 2)).status, "LOADING");
});

console.log(`\n${passed} passed, 0 failed`);
