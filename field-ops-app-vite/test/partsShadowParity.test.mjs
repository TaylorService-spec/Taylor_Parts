// INV-CONVERGENCE-E Stage A -- pure parity core tests. Plain Node; deterministic;
// offline (fixtures: committed production read-back + static catalog). No Firebase,
// no credentials, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  runShadowParity,
  deriveCounts,
  deriveStaticCatalogHash,
  PARITY_STATES,
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
  runId: "run-1", adapterCommit: "test", capturedAtStart: "t0", capturedAtEnd: "t1",
  canonicalRead: { status: "OK", rows: CANONICAL },
  staticCatalog: { rows: STATIC },
  ledgerSnapshot: [], reorderSnapshot: [], poSnapshot: [],
  ...over,
});

// ---- PASS ------------------------------------------------------------------
check("PASS on full valid bundle: 190 match / 10 excluded / 0 divergences", () => {
  const { status, evidence } = runShadowParity(fullBundle());
  assert.equal(status, "PASS");
  assert.equal(evidence.canonicalMatchCount, 190);
  assert.equal(evidence.staticOnlyExcludedCount, 10);
  assert.equal(evidence.unexpectedUnmatchedCount, 0);
  assert.equal(evidence.nameDivergenceCount, 0);
  assert.equal(evidence.normalizedUnitDivergenceCount, 0);
  assert.equal(evidence.provenanceIssueCount, 0);
  assert.equal(evidence.sourceCounts.static, 200);
  assert.equal(evidence.sourceCounts.canonical, 190);
});

// ---- FAIL_PARITY -----------------------------------------------------------
check("FAIL_PARITY on a name divergence", () => {
  const c = CANONICAL.map((r) => (r.partId === "TST-1001" ? { ...r, name: "WRONG" } : r));
  const { status, evidence } = runShadowParity(fullBundle({ canonicalRead: { status: "OK", rows: c } }));
  assert.equal(status, "FAIL_PARITY");
  assert.ok(evidence.nameDivergenceCount >= 1);
});
check("FAIL_PARITY on a normalized-unit divergence", () => {
  const c = CANONICAL.map((r) => (r.partId === "TST-1001" ? { ...r, stockingUnit: "BOTTLE" } : r));
  const { status, evidence } = runShadowParity(fullBundle({ canonicalRead: { status: "OK", rows: c } }));
  assert.equal(status, "FAIL_PARITY");
  assert.ok(evidence.normalizedUnitDivergenceCount >= 1);
});
check("FAIL_PARITY on an unexpected unmatched (11th static-only) record", () => {
  const extra = { sku: "TST-9999", name: "Rogue", category: "X", unit: "ea", cost: 1, price: 2, reorderThreshold: 1, warehouseQty: 1 };
  const { status, evidence } = runShadowParity(fullBundle({ staticCatalog: { rows: [...STATIC, extra] } }));
  assert.equal(status, "FAIL_PARITY");
  assert.ok(evidence.unexpectedUnmatchedCount >= 1);
});

// ---- BLOCKED ---------------------------------------------------------------
check("BLOCKED_PERMISSION: canonical read absent (not empty), no parity computed", () => {
  const { status, evidence } = runShadowParity(fullBundle({ canonicalRead: { status: "PERMISSION_DENIED", rows: null } }));
  assert.equal(status, "BLOCKED_PERMISSION");
  assert.equal(evidence.canonicalMatchCount, undefined); // no fabricated counts
  assert.equal(evidence.sourceCounts, null);
});
check("BLOCKED_UNAVAILABLE short-circuits before comparison", () => {
  const { status, evidence } = runShadowParity(fullBundle({ canonicalRead: { status: "UNAVAILABLE", rows: null } }));
  assert.equal(status, "BLOCKED_UNAVAILABLE");
  assert.equal(evidence.nameDivergenceCount, undefined);
});
check("BLOCKED_INCOMPLETE_INPUT when a required input is missing (static rows null)", () => {
  const { status } = runShadowParity(fullBundle({ staticCatalog: { rows: null } }));
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
});
check("BLOCKED_INCOMPLETE_INPUT when a required snapshot is missing (ledger null)", () => {
  const { status } = runShadowParity(fullBundle({ ledgerSnapshot: null }));
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
});

// ---- counts / hash derivation + mismatch -----------------------------------
check("counts and hash are derived from captured arrays", () => {
  const b = fullBundle();
  assert.deepEqual(deriveCounts(b), { canonical: 190, static: 200, ledger: 0, reorder: 0, po: 0 });
  const h = deriveStaticCatalogHash(STATIC);
  assert.match(h, /^fnv1a32:[0-9a-f]{8}$/);
  // deterministic regardless of input order
  assert.equal(deriveStaticCatalogHash([...STATIC].reverse()), h);
});
check("supplied sourceCounts mismatch -> BLOCKED_INCOMPLETE_INPUT (not PASS/FAIL)", () => {
  const { status } = runShadowParity(fullBundle({ sourceCounts: { canonical: 999, static: 200, ledger: 0, reorder: 0, po: 0 } }));
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
});
check("supplied contentHash mismatch -> BLOCKED_INCOMPLETE_INPUT", () => {
  const { status } = runShadowParity(fullBundle({ staticCatalog: { rows: STATIC, contentHash: "fnv1a32:deadbeef" } }));
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
});
check("matching supplied metadata is accepted (PASS)", () => {
  const b = fullBundle();
  const withMeta = fullBundle({ sourceCounts: deriveCounts(b), staticCatalog: { rows: STATIC, contentHash: deriveStaticCatalogHash(STATIC) } });
  assert.equal(runShadowParity(withMeta).status, "PASS");
});

// ---- determinism / purity / sanitization -----------------------------------
check("determinism: same frozen bundle -> deep-equal result; inputs not mutated", () => {
  const b = fullBundle();
  const before = JSON.stringify(b);
  const a = runShadowParity(b);
  const c = runShadowParity(b);
  assert.equal(JSON.stringify(a), JSON.stringify(c));
  assert.equal(JSON.stringify(b), before);
});
check("purity: core imports no Firebase, no partMasterQueries, no network, no clock/random", () => {
  assert.ok(!/from\s+["'][^"']*firebase/i.test(CORE_SRC));
  assert.ok(!/from\s+["'][^"']*partMasterQueries/.test(CORE_SRC)); // no IMPORT (comment mention is fine)
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(CORE_SRC));
  assert.ok(!/Date\.now|Math\.random|new Date\(/.test(CORE_SRC));
});
check("sanitization: evidence carries only counts/hash/timestamps/summaries (no records)", () => {
  const { evidence } = runShadowParity(fullBundle());
  const json = JSON.stringify(evidence);
  // divergences are {key,kind} summaries; on PASS there are none
  assert.deepEqual(evidence.divergences, []);
  assert.ok(!/warehouseQty|"cost"|"price"|currentSummary/.test(json)); // no raw record fields
  assert.equal(PARITY_STATES.includes(evidence.status), true);
});
check("divergence summaries are {key,kind} only (no record values)", () => {
  const extra = { sku: "TST-9999", name: "Rogue", category: "X", unit: "ea", cost: 1, price: 2, reorderThreshold: 1, warehouseQty: 1 };
  const { evidence } = runShadowParity(fullBundle({ staticCatalog: { rows: [...STATIC, extra] } }));
  for (const d of evidence.divergences) {
    assert.deepEqual(Object.keys(d).sort(), ["key", "kind"]);
  }
});

console.log(`\n${passed} passed`);
