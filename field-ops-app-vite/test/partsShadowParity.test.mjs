// INV-CONVERGENCE-E Stage A -- pure parity core tests. Plain Node; deterministic;
// offline (fixtures: committed production read-back + static catalog). No Firebase,
// no credentials, no network. Covers the current-vs-shadow comparison, snapshot-
// derived overlays, every result state, counts/hash, purity and sanitization.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  runShadowParity, deriveCounts, deriveStaticCatalogHash, deriveLedgerOverlay,
  deriveWorkflowBySku, buildCurrentModel, buildShadowModel, compareModels, PARITY_STATES,
} from "../src/domain/partsShadowParity.js";

const rel = (p) => new URL(p, new URL("../", import.meta.url));
const CORE_SRC = fs.readFileSync(rel("src/domain/partsShadowParity.js"), "utf8");
const POSTWRITE = JSON.parse(fs.readFileSync(
  rel("../docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/row-results.json"), "utf8"));
const CATALOG_SRC = fs.readFileSync(rel("src/data/partsCatalog.ts"), "utf8");

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partsShadowParity.test.mjs");

// ---- fixtures --------------------------------------------------------------
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
const fullBundle = (over = {}) => ({
  runId: "run-1", adapterCommit: "abc123", capturedAtStart: "t0", capturedAtEnd: "t1",
  canonicalRead: { status: "OK", rows: CANONICAL },
  staticCatalog: { rows: STATIC }, ledgerSnapshot: [], reorderSnapshot: [], poSnapshot: [], ...over,
});

// ---- current-vs-shadow: two independent models, PASS requires equality --------
check("PASS: current & shadow models built from same bundle agree (190/10, 0 divergences)", () => {
  const { status, evidence } = runShadowParity(fullBundle());
  assert.equal(status, "PASS");
  assert.equal(evidence.canonicalMatchCount, 190);
  assert.equal(evidence.staticOnlyExcludedCount, 10);
  assert.equal(evidence.rowMissingCount, 0);
  assert.equal(evidence.fieldDivergenceCount, 0);
  assert.equal(evidence.availabilityDivergenceCount, 0);
  assert.equal(evidence.workflowDivergenceCount, 0);
  assert.deepEqual(evidence.divergences, []);
});
check("current and shadow are independently built from the SAME bundle", () => {
  const b = fullBundle();
  const overlay = deriveLedgerOverlay(b.ledgerSnapshot, b.staticCatalog.rows);
  const workflow = deriveWorkflowBySku(b.reorderSnapshot, b.poSnapshot);
  const current = buildCurrentModel(b, overlay, workflow);
  const { rows: shadow } = buildShadowModel(b, overlay, workflow);
  assert.equal(Object.keys(current).length, 200);
  assert.equal(Object.keys(shadow).length, 200);
  assert.equal(compareModels(current, shadow).length, 0); // agree on production data
});
check("a deliberate current-vs-shadow FIELD difference -> FAIL_PARITY (name)", () => {
  const c = CANONICAL.map((r) => (r.partId === "TST-1001" ? { ...r, name: "DIFFERENT" } : r));
  const { status, evidence } = runShadowParity(fullBundle({ canonicalRead: { status: "OK", rows: c } }));
  assert.equal(status, "FAIL_PARITY");
  assert.ok(evidence.fieldDivergenceCount >= 1);
  assert.ok(evidence.divergences.some((d) => d.key === "TST-1001" && d.kind === "CURRENT_SHADOW_FIELD_DIVERGENCE"));
});
check("compareModels: availability divergence -> CURRENT_SHADOW_AVAILABILITY_DIVERGENCE", () => {
  const cur = { "TST-1": { key: "TST-1", availability: 5 } };
  const sha = { "TST-1": { key: "TST-1", availability: 4 } };
  assert.deepEqual(compareModels(cur, sha), [{ key: "TST-1", kind: "CURRENT_SHADOW_AVAILABILITY_DIVERGENCE" }]);
});
check("compareModels: reorder divergence -> CURRENT_SHADOW_WORKFLOW_DIVERGENCE", () => {
  const cur = { k: { key: "k", reorderState: { statuses: ["ORDERED"], count: 1 } } };
  const sha = { k: { key: "k", reorderState: { statuses: ["PENDING_REVIEW"], count: 1 } } };
  assert.deepEqual(compareModels(cur, sha), [{ key: "k", kind: "CURRENT_SHADOW_WORKFLOW_DIVERGENCE" }]);
});
check("compareModels: purchasing divergence -> CURRENT_SHADOW_WORKFLOW_DIVERGENCE", () => {
  const cur = { k: { key: "k", purchasingState: { statuses: ["ORDERED"], count: 1 } } };
  const sha = { k: { key: "k", purchasingState: null } };
  assert.deepEqual(compareModels(cur, sha), [{ key: "k", kind: "CURRENT_SHADOW_WORKFLOW_DIVERGENCE" }]);
});
check("compareModels: row missing -> CURRENT_SHADOW_ROW_MISSING", () => {
  assert.deepEqual(compareModels({ a: { key: "a" } }, {}), [{ key: "a", kind: "CURRENT_SHADOW_ROW_MISSING" }]);
});

// ---- overlays derived from captured snapshots (not caller-supplied) ---------
check("overlays are derived from captured ledger/reorder/PO rows", () => {
  const ledger = [
    { partId: "TST-1001", type: "RESERVED", quantity: 3 },
    { partId: "TST-1001", type: "RELEASED", quantity: 1 },
    { partId: "TST-1001", type: "CONSUMED", quantity: 2 },
  ];
  const overlay = deriveLedgerOverlay(ledger, STATIC);
  const wh = STATIC.find((s) => s.sku === "TST-1001").warehouseQty;
  assert.deepEqual(overlay["TST-1001"], { reserved: 3, released: 1, consumed: 2, availability: wh - (3 - 1) });
  const wf = deriveWorkflowBySku([{ partId: "TST-1001", status: "ORDERED" }], [{ partId: "TST-1001", status: "SENT" }]);
  assert.deepEqual(wf["TST-1001"], { reorderState: { statuses: ["ORDERED"], count: 1 }, purchasingState: { statuses: ["SENT"], count: 1 } });
});
check("injected overlay/workflow objects CANNOT bypass the captured bundle", () => {
  const bogus = { TST_BOGUS: { availability: -1 } };
  const withBogus = runShadowParity(fullBundle({ overlayBySku: bogus, workflowBySku: bogus }));
  const without = runShadowParity(fullBundle());
  assert.equal(JSON.stringify(withBogus), JSON.stringify(without)); // ignored -> identical
  assert.equal(withBogus.status, "PASS");
});

// ---- BLOCKED ---------------------------------------------------------------
check("BLOCKED_PERMISSION: canonical absent (not empty); no parity computed", () => {
  const { status, evidence } = runShadowParity(fullBundle({ canonicalRead: { status: "PERMISSION_DENIED", rows: null } }));
  assert.equal(status, "BLOCKED_PERMISSION");
  assert.equal(evidence.canonicalMatchCount, undefined);
  assert.equal(evidence.sourceCounts, null);
});
check("BLOCKED_UNAVAILABLE short-circuits before comparison", () => {
  assert.equal(runShadowParity(fullBundle({ canonicalRead: { status: "UNAVAILABLE", rows: null } })).status, "BLOCKED_UNAVAILABLE");
});
check("BLOCKED_INCOMPLETE_INPUT when a required input is missing (static rows null)", () => {
  assert.equal(runShadowParity(fullBundle({ staticCatalog: { rows: null } })).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("BLOCKED_INCOMPLETE_INPUT when a required snapshot is missing (ledger null)", () => {
  assert.equal(runShadowParity(fullBundle({ ledgerSnapshot: null })).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("BLOCKED_INCOMPLETE_INPUT when adapterCommit is missing or 'unknown'", () => {
  assert.equal(runShadowParity(fullBundle({ adapterCommit: null })).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(runShadowParity(fullBundle({ adapterCommit: "unknown" })).status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(runShadowParity(fullBundle({ adapterCommit: "" })).status, "BLOCKED_INCOMPLETE_INPUT");
});

// ---- counts / hash derivation + mismatch -----------------------------------
check("counts and hash are derived from captured arrays; hash order-independent", () => {
  assert.deepEqual(deriveCounts(fullBundle()), { canonical: 190, static: 200, ledger: 0, reorder: 0, po: 0 });
  const h = deriveStaticCatalogHash(STATIC);
  assert.match(h, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(deriveStaticCatalogHash([...STATIC].reverse()), h);
});
check("supplied sourceCounts mismatch -> BLOCKED_INCOMPLETE_INPUT", () => {
  assert.equal(runShadowParity(fullBundle({ sourceCounts: { canonical: 999, static: 200, ledger: 0, reorder: 0, po: 0 } })).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("supplied contentHash mismatch -> BLOCKED_INCOMPLETE_INPUT", () => {
  assert.equal(runShadowParity(fullBundle({ staticCatalog: { rows: STATIC, contentHash: "fnv1a32:deadbeef" } })).status, "BLOCKED_INCOMPLETE_INPUT");
});
check("matching supplied metadata is accepted (PASS)", () => {
  const b = fullBundle();
  assert.equal(runShadowParity(fullBundle({ sourceCounts: deriveCounts(b), staticCatalog: { rows: STATIC, contentHash: deriveStaticCatalogHash(STATIC) } })).status, "PASS");
});

// ---- determinism / purity / sanitization -----------------------------------
check("determinism: same frozen bundle -> deep-equal result; inputs not mutated", () => {
  const b = fullBundle();
  const before = JSON.stringify(b);
  assert.equal(JSON.stringify(runShadowParity(b)), JSON.stringify(runShadowParity(b)));
  assert.equal(JSON.stringify(b), before);
});
check("purity: core imports no Firebase/partMasterQueries/network/clock/random", () => {
  assert.ok(!/from\s+["'][^"']*firebase/i.test(CORE_SRC));
  assert.ok(!/from\s+["'][^"']*partMasterQueries/.test(CORE_SRC));
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(CORE_SRC));
  assert.ok(!/Date\.now|Math\.random|new Date\(/.test(CORE_SRC));
});
check("sanitization: divergence summaries are {key,kind} only; no record fields leak", () => {
  const c = CANONICAL.map((r) => (r.partId === "TST-1001" ? { ...r, name: "DIFFERENT" } : r));
  const { evidence } = runShadowParity(fullBundle({ canonicalRead: { status: "OK", rows: c } }));
  for (const d of evidence.divergences) assert.deepEqual(Object.keys(d).sort(), ["key", "kind"]);
  assert.ok(!/"cost"|"price"|warehouseQty|currentSummary|DIFFERENT/.test(JSON.stringify(evidence)));
  assert.equal(PARITY_STATES.includes(evidence.status), true);
});

console.log(`\n${passed} passed`);
