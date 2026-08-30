// INV-CONVERGENCE-E C2 -- deterministic OFFLINE tests for buildPartDetailView +
// selectPartLedger, the governed PartDetail composition and ledger identity
// selection. Plain Node (house client-test convention). No Firebase, no
// credentials, no network, no production access: fixtures are the committed
// production zero-write read-back (190 canonical) and the static catalog (200).
// Offline parity here is NOT the live pre-cutover shadow-parity; it proves the pure
// composition, the paired ledger re-point, routing/back-compat, and BLOCKED
// semantics.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPartDetailView,
  selectPartLedger,
  isPartDetailBlocked,
  partDetailBlockedMessage,
  PART_DETAIL_STATES,
  RECENT_TRANSACTION_LIMIT,
} from "../src/domain/partDetailView.js";
import { buildPartsCatalogRows, partCatalogRoute } from "../src/domain/partsCatalogView.js";
import { APPROVED_STATIC_ONLY_EXCLUSIONS, normalizeUnit } from "../src/domain/partsCompatibilityAdapter.js";

const rel = (p) => new URL(p, new URL("../", import.meta.url));
const CATALOG_SRC = fs.readFileSync(rel("src/data/partsCatalog.ts"), "utf8");
const DETAIL_SRC = fs.readFileSync(rel("src/modules/inventory/PartDetail.jsx"), "utf8");
const POSTWRITE = JSON.parse(fs.readFileSync(
  rel("../docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/row-results.json"), "utf8"));

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partDetailView.test.mjs");

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
const view = (partId, canonicalRead = OK()) =>
  buildPartDetailView({ canonicalRead, staticCatalog: STATIC, partId });

const CANON_IDS = new Set(CANONICAL.map((c) => c.partId));
const A_CANONICAL_SKU = STATIC.find((s) => CANON_IDS.has(s.sku)).sku;
const AN_EXCLUDED_SKU = APPROVED_STATIC_ONLY_EXCLUSIONS[0];

check("fixture sanity: 200 static, 190 canonical, 10 approved exclusions", () => {
  assert.equal(STATIC.length, 200);
  assert.equal(CANONICAL.length, 190);
  assert.equal(APPROVED_STATIC_ONLY_EXCLUSIONS.length, 10);
});

// ---- BACKWARD COMPATIBILITY: every pre-C2 Part ID still resolves -------------
check("back-compat: all 200 pre-existing Part IDs still resolve to READY", () => {
  const missing = STATIC.filter((s) => view(s.sku).status !== "READY").map((s) => s.sku);
  assert.deepEqual(missing, [], `these Part IDs stopped resolving: ${missing.join(",")}`);
});
check("back-compat: the 10 approved static-only Parts still have working detail pages", () => {
  for (const sku of APPROVED_STATIC_ONLY_EXCLUSIONS) {
    const { status, part } = view(sku);
    assert.equal(status, "READY", `${sku} must still render`);
    assert.equal(part.identityState, "STATIC_ONLY_EXCLUDED");
    assert.equal(part.partId, sku, "static-only Part keeps its sku as its id");
  }
});
check("back-compat: resolved identity === route param === sku for all 200 (no id rewrite)", () => {
  for (const s of STATIC) {
    const { part } = view(s.sku);
    assert.equal(part.partId, s.sku);
    assert.equal(part.sku, s.sku);
  }
});

// ---- ROUTING: PartsList link -> PartDetail resolution continuity ------------
check("routing: every C1 PartsList route resolves in C2 PartDetail (search->route->detail)", () => {
  const { status, rows } = buildPartsCatalogRows({ canonicalRead: OK(), staticCatalog: STATIC });
  assert.equal(status, "READY");
  assert.equal(rows.length, 200);
  for (const row of rows) {
    const route = partCatalogRoute(row);
    const routeId = route.replace("/inventory/", "");
    assert.equal(routeId, row.sku, "route key must stay the sku");
    assert.equal(view(routeId).status, "READY", `route ${route} must resolve`);
  }
});
check("routing: unknown id under a verified catalog is NOT_FOUND (not BLOCKED)", () => {
  const { status, part } = view("TST-DOES-NOT-EXIST");
  assert.equal(status, "NOT_FOUND");
  assert.equal(part, null);
  assert.equal(isPartDetailBlocked(status), false);
});

// ---- PARITY: composed metadata vs the pre-C2 static-derived page ------------
check("parity: name/category identical to the pre-C2 static page for all 200", () => {
  const diffs = [];
  for (const s of STATIC) {
    const { part } = view(s.sku);
    if (part.name !== s.name) diffs.push(`${s.sku} name ${s.name} -> ${part.name}`);
    if (part.category !== s.category) diffs.push(`${s.sku} category`);
  }
  assert.deepEqual(diffs, [], diffs.join("; "));
});
check("parity: commercial + baseline fields are the UNCHANGED static values (UD-3/UD-4 pending)", () => {
  for (const s of STATIC) {
    const { part } = view(s.sku);
    assert.equal(part.cost, s.cost);
    assert.equal(part.price, s.price);
    assert.equal(part.reorderThreshold, s.reorderThreshold);
    assert.equal(part.warehouseQty, s.warehouseQty);
    assert.equal(part.provenance.cost, "STATIC_FALLBACK");
    assert.equal(part.provenance.price, "STATIC_FALLBACK");
    assert.equal(part.provenance.reorderThreshold, "STATIC_FALLBACK");
    assert.equal(part.provenance.warehouseQty, "STATIC_FALLBACK");
  }
});
check("parity: unit is the canonical-preferred normalized code (documented display change)", () => {
  // DISCLOSED C2 BEHAVIOR CHANGE: the page showed the raw static token ("ea");
  // it now shows the governed stocking unit ("EACH"). Same underlying meaning --
  // normalizeUnit(static) === canonical for every matched Part (0 UNIT_DIVERGENCE).
  const p = view(A_CANONICAL_SKU).part;
  const s = STATIC.find((x) => x.sku === A_CANONICAL_SKU);
  assert.equal(p.unit, normalizeUnit(s.unit));
  assert.equal(p.provenance.unit, "CANONICAL");
  for (const st of STATIC) {
    assert.equal(view(st.sku).part.unit, normalizeUnit(st.unit), `${st.sku} unit must equal normalized static`);
  }
});
check("parity: canonical-matched Parts carry CANONICAL identity provenance", () => {
  const p = view(A_CANONICAL_SKU).part;
  assert.equal(p.identityState, "CANONICAL_MATCH");
  assert.equal(p.provenance.name, "CANONICAL");
  const e = view(AN_EXCLUDED_SKU).part;
  assert.equal(e.identityState, "STATIC_ONLY_EXCLUDED");
  assert.equal(e.provenance.name, "STATIC_FALLBACK");
});

// ---- BLOCKED STATES: fail closed, no silent fallback, no partial success ----
check("BLOCKED_PERMISSION on a denied canonical read (never a static fallback page)", () => {
  const { status, part } = view(A_CANONICAL_SKU, { status: "PERMISSION_DENIED" });
  assert.equal(status, "BLOCKED_PERMISSION");
  assert.equal(part, null);
  assert.equal(isPartDetailBlocked(status), true);
});
check("BLOCKED_UNAVAILABLE on an unavailable canonical read", () => {
  const { status, part } = view(A_CANONICAL_SKU, { status: "UNAVAILABLE" });
  assert.equal(status, "BLOCKED_UNAVAILABLE");
  assert.equal(part, null);
});
check("BLOCKED_INCOMPLETE_INPUT on missing/unknown/LOADING canonical status", () => {
  for (const cr of [{ status: "LOADING" }, { status: undefined }, {}, { status: "WAT" }]) {
    const { status, part } = view(A_CANONICAL_SKU, cr);
    assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
    assert.equal(part, null);
  }
});
check("BLOCKED_INCOMPLETE_INPUT when canonical rows are missing/malformed", () => {
  assert.equal(view(A_CANONICAL_SKU, { status: "OK" }).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(view(A_CANONICAL_SKU, { status: "OK", rows: "nope" }).status, "BLOCKED_INCOMPLETE_INPUT");
});
// ---- fail-closed on INVALID canonical documents (C2 passes fetchPartMasterList's `invalid` through) ----
check("BLOCKED when the canonical read reports non-empty invalid documents (never a partial detail page)", () => {
  const { status, part } = view(A_CANONICAL_SKU, { ...OK(), invalid: [{ id: "x", invalid: true }] });
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(part, null);
  assert.equal(isPartDetailBlocked(status), true);
});
check("a malformed canonical doc overlapping an approved STATIC_ONLY_EXCLUDED sku STILL blocks the detail page", () => {
  const { status, part } = view(AN_EXCLUDED_SKU, { ...OK(), invalid: [{ partId: AN_EXCLUDED_SKU, invalid: true }] });
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(part, null);
});
check("malformed invalid metadata (not an array) blocks; empty/absent invalid stays READY (back-compat)", () => {
  assert.equal(view(A_CANONICAL_SKU, { ...OK(), invalid: "nope" }).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(view(A_CANONICAL_SKU, { ...OK(), invalid: [] }).status, "READY");
  assert.equal(view(A_CANONICAL_SKU, OK()).status, "READY");
});
check("invalid blocking on the detail view surfaces no raw canonical document data", () => {
  const res = view(A_CANONICAL_SKU, { ...OK(), invalid: [{ partId: AN_EXCLUDED_SKU, secretField: "raw-value", invalid: true }] });
  const blob = JSON.stringify(res);
  assert.equal(blob.includes("secretField"), false);
  assert.equal(blob.includes("raw-value"), false);
});
check("NOT_FOUND (never a stale static page) when the canonical read omits this very Part", () => {
  // UPDATED 2026-08-17 (Owner-ratified authority direction). Canonical is authoritative, so a Part
  // absent from the canonical read is genuinely not a governed Part -- NOT_FOUND is the honest
  // answer, and it no longer takes the whole catalog down with it.
  //
  // The invariant that actually mattered is unchanged and still asserted: `part` is null, so the
  // static compatibility record is NEVER served as a stale fallback detail page. Only the status
  // LABEL moved, from a whole-composition block to a precise per-Part answer.
  const short = { status: "OK", rows: CANONICAL.filter((c) => c.partId !== A_CANONICAL_SKU) };
  const { status, part } = view(A_CANONICAL_SKU, short);
  assert.equal(status, "NOT_FOUND");
  assert.equal(part, null, "the static record must never be served as the Part");
});
check("BLOCKED on a malformed/absent route part id (not 'Unknown part')", () => {
  for (const bad of [undefined, null, "", 42, {}]) {
    const { status, part } = buildPartDetailView({ canonicalRead: OK(), staticCatalog: STATIC, partId: bad });
    assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
    assert.equal(part, null);
  }
});
check("BLOCKED on a missing/empty static compatibility catalog", () => {
  assert.equal(buildPartDetailView({ canonicalRead: OK(), staticCatalog: [], partId: A_CANONICAL_SKU }).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(buildPartDetailView({ canonicalRead: OK(), partId: A_CANONICAL_SKU }).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("BLOCKED on a duplicate canonical partId (ambiguous identity never renders)", () => {
  const dup = { status: "OK", rows: [...CANONICAL, CANONICAL[0]] };
  assert.equal(view(A_CANONICAL_SKU, dup).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("every BLOCKED_* state has explicit non-empty user copy", () => {
  for (const st of ["BLOCKED_PERMISSION", "BLOCKED_UNAVAILABLE", "BLOCKED_INCOMPLETE_INPUT"]) {
    const msg = partDetailBlockedMessage(st);
    assert.equal(typeof msg, "string");
    assert.ok(msg.length > 20, `${st} needs real copy`);
  }
});
check("PART_DETAIL_STATES enumerates exactly the produced statuses", () => {
  const produced = new Set([
    view(A_CANONICAL_SKU).status,
    view("NOPE").status,
    view(A_CANONICAL_SKU, { status: "PERMISSION_DENIED" }).status,
    view(A_CANONICAL_SKU, { status: "UNAVAILABLE" }).status,
    view(A_CANONICAL_SKU, { status: "LOADING" }).status,
  ]);
  assert.deepEqual([...produced].sort(), [...PART_DETAIL_STATES].sort());
});

// ---- PAIRED LEDGER RE-POINT -------------------------------------------------
const TX = [
  { id: "t1", partId: A_CANONICAL_SKU, timestamp: 100, type: "USAGE", quantity: 1 },
  { id: "t2", partId: A_CANONICAL_SKU, timestamp: 300, type: "RECEIPT", quantity: 5 },
  { id: "t3", partId: "TST-9999", timestamp: 200, type: "USAGE", quantity: 2 },
];
const HEALTH = [
  { partId: A_CANONICAL_SKU, stock: { availableStock: 7 } },
  { partId: "TST-9999", stock: { availableStock: 1 } },
];

check("ledger: selects only this part's transactions, newest first (pre-C2 behavior)", () => {
  const { transactions, health } = selectPartLedger({
    transactions: TX, healthEntries: HEALTH, resolvedPartId: A_CANONICAL_SKU,
  });
  assert.deepEqual(transactions.map((t) => t.id), ["t2", "t1"]);
  assert.equal(health.stock.availableStock, 7);
});
check("ledger: identical to the pre-C2 raw-param filter for every one of the 200", () => {
  for (const s of STATIC) {
    const tx = [{ id: "x", partId: s.sku, timestamp: 1 }, { id: "y", partId: "OTHER", timestamp: 2 }];
    const pre = tx.filter((t) => t.partId === s.sku).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
    const post = selectPartLedger({ transactions: tx, healthEntries: [], resolvedPartId: view(s.sku).part.partId });
    assert.deepEqual(post.transactions, pre, `${s.sku} ledger slice must be unchanged`);
  }
});
check("ledger: caps at 20 rows, unchanged", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, partId: A_CANONICAL_SKU, timestamp: i }));
  const { transactions } = selectPartLedger({ transactions: many, healthEntries: [], resolvedPartId: A_CANONICAL_SKU });
  assert.equal(transactions.length, RECENT_TRANSACTION_LIMIT);
  assert.equal(transactions[0].timestamp, 49, "newest first");
});
check("ledger: fail-closed -- no resolved identity yields an EMPTY slice, never unfiltered", () => {
  for (const id of [null, undefined, ""]) {
    const { transactions, health } = selectPartLedger({ transactions: TX, healthEntries: HEALTH, resolvedPartId: id });
    assert.deepEqual(transactions, []);
    assert.equal(health, null);
  }
});
check("ledger: a BLOCKED detail yields no resolved id, hence no ledger (paired fail-closed)", () => {
  const d = view(A_CANONICAL_SKU, { status: "PERMISSION_DENIED" });
  const resolved = d.part ? d.part.partId : null;
  const { transactions, health } = selectPartLedger({ transactions: TX, healthEntries: HEALTH, resolvedPartId: resolved });
  assert.deepEqual(transactions, []);
  assert.equal(health, null);
});
check("ledger: health lookup keys on the resolved id, no cross-part bleed", () => {
  const { health } = selectPartLedger({ transactions: [], healthEntries: HEALTH, resolvedPartId: "TST-9999" });
  assert.equal(health.stock.availableStock, 1);
});
check("ledger: tolerates malformed transaction/health entries without throwing", () => {
  const messy = [null, { partId: A_CANONICAL_SKU, timestamp: 5 }, undefined];
  const { transactions } = selectPartLedger({ transactions: messy, healthEntries: [null], resolvedPartId: A_CANONICAL_SKU });
  assert.equal(transactions.length, 1);
});

// ---- WIRING GUARDS (source assertions on PartDetail.jsx) --------------------
check("wiring: PartDetail no longer imports the static getCatalogItem metadata source", () => {
  // no import of it, and no call site (prose mentions in comments are fine)
  assert.ok(!/^import[^;]*getCatalogItem/m.test(DETAIL_SRC), "getCatalogItem import must be gone");
  assert.ok(!/getCatalogItem\s*\(/.test(DETAIL_SRC), "getCatalogItem must have no call site in C2");
});
check("wiring: PartDetail composes via the governed view + uses the existing canonical read", () => {
  assert.ok(/buildPartDetailView/.test(DETAIL_SRC));
  assert.ok(/selectPartLedger/.test(DETAIL_SRC));
  assert.ok(/fetchPartMasterList/.test(DETAIL_SRC), "must reuse PR 1.9's read -- no new query surface");
});
check("wiring: the raw-param ledger filter is gone (re-pointed to resolved identity)", () => {
  assert.ok(!/t\.partId === partId/.test(DETAIL_SRC), "ledger filter must key on resolvedPartId");
  assert.ok(!/entry\.partId === partId/.test(DETAIL_SRC), "health lookup must key on resolvedPartId");
  assert.ok(/resolvedPartId/.test(DETAIL_SRC));
});
check("wiring: write surface preserved (reorder/PO/receive/cancel/void/actions intact)", () => {
  for (const sym of [
    "requestReorderForRecommendation", "recordInventoryAction", "recordPurchaseOrder",
    "voidPurchaseOrder", "InventoryActionsPanel", "RequestReorderControl",
  ]) {
    assert.ok(DETAIL_SRC.includes(sym), `${sym} must remain on the page`);
  }
});
check("wiring: blocked render path exists and precedes the not-found path", () => {
  assert.ok(/isPartDetailBlocked\(detail\.status\)/.test(DETAIL_SRC));
  // WHAT THIS PINS IS THE ORDER, not the wording. It was written against the literal
  // 'Unknown part "{partId}"', which the Parts North Star migration replaced with a sentence that
  // says which of the two problems this is -- the catalogue WAS readable, and holds no such id.
  // Pinning the copy would have made an improvement to that sentence look like a regression, so
  // the anchor is now the not-found branch itself. The rule is unchanged and still falsifiable:
  // a BLOCKED read must never fall through to "no such part".
  const notFoundBranch = DETAIL_SRC.indexOf("if (!part) {");
  assert.ok(notFoundBranch > 0, "the not-found branch must still exist for genuinely unknown ids");
  assert.ok(/No part is recorded under/.test(DETAIL_SRC),
    "and it must still say so in words a reader can act on");
  assert.ok(DETAIL_SRC.indexOf("isPartDetailBlocked(detail.status)") < notFoundBranch,
    "a BLOCKED read must never fall through to not-found");
});

// ---- PURITY -----------------------------------------------------------------
check("purity: same inputs -> deep-equal output; inputs not mutated", () => {
  const canonical = OK();
  const staticCopy = JSON.parse(JSON.stringify(STATIC));
  const a = buildPartDetailView({ canonicalRead: canonical, staticCatalog: STATIC, partId: A_CANONICAL_SKU });
  const b = buildPartDetailView({ canonicalRead: canonical, staticCatalog: STATIC, partId: A_CANONICAL_SKU });
  assert.deepEqual(a, b);
  assert.deepEqual(STATIC, staticCopy, "static catalog must not be mutated");
});
check("purity: selectPartLedger does not mutate the caller's transaction array", () => {
  const src = [...TX];
  const order = src.map((t) => t.id);
  selectPartLedger({ transactions: src, healthEntries: HEALTH, resolvedPartId: A_CANONICAL_SKU });
  assert.deepEqual(src.map((t) => t.id), order, "input array order must be preserved");
});

console.log(`\n${passed} passed, 0 failed`);
