// INV-CONVERGENCE-E Stage A -- view mapper, authorization, sanitization, and
// PartsList/PartDetail isolation. Plain Node; offline; no Firebase/network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { toDiagnosticsView, isDiagnosticsAuthorized } from "../src/domain/partsShadowParityView.js";

const rel = (p) => new URL(p, new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(rel(p), "utf8");

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partsShadowParityView.test.mjs");

// ---- authorization ---------------------------------------------------------
check("isDiagnosticsAuthorized: admin/dispatcher only", () => {
  assert.equal(isDiagnosticsAuthorized("admin"), true);
  assert.equal(isDiagnosticsAuthorized("dispatcher"), true);
  for (const r of ["technician", "", null, undefined, "owner"]) assert.equal(isDiagnosticsAuthorized(r), false);
});

// ---- view mapping ----------------------------------------------------------
const passResult = {
  status: "PASS",
  evidence: {
    runId: "run-1", adapterCommit: "c", staticCatalogHash: "fnv1a32:abcd1234",
    capturedAtStart: "t0", capturedAtEnd: "t1", sourceCounts: { canonical: 190, static: 200, ledger: 0, reorder: 0, po: 0 },
    canonicalMatchCount: 190, staticOnlyExcludedCount: 10, unexpectedUnmatchedCount: 0,
    nameDivergenceCount: 0, normalizedUnitDivergenceCount: 0, provenanceIssueCount: 0, status: "PASS", reason: null, divergences: [],
  },
};

check("PASS result maps to a complete sanitized view", () => {
  const v = toDiagnosticsView(passResult);
  assert.equal(v.invalid, false);
  assert.equal(v.status, "PASS");
  assert.equal(v.isPass, true);
  assert.equal(v.isBlocked, false);
  assert.equal(v.counts.canonicalMatch, 190);
  assert.equal(v.counts.staticOnlyExcluded, 10);
  assert.equal(v.meta.staticCatalogHash, "fnv1a32:abcd1234");
});
check("each BLOCKED status maps to isBlocked with its tone label", () => {
  for (const status of ["BLOCKED_PERMISSION", "BLOCKED_UNAVAILABLE", "BLOCKED_INCOMPLETE_INPUT"]) {
    const v = toDiagnosticsView({ status, evidence: { status, reason: "r" } });
    assert.equal(v.isBlocked, true);
    assert.equal(v.tone.label, status);
  }
});
check("FAIL_PARITY maps with non-pass tone", () => {
  const v = toDiagnosticsView({ status: "FAIL_PARITY", evidence: { status: "FAIL_PARITY", nameDivergenceCount: 1, divergences: [{ key: "TST-1001", kind: "NAME_DIVERGENCE" }] } });
  assert.equal(v.isPass, false);
  assert.deepEqual(v.divergenceSummary, [{ key: "TST-1001", kind: "NAME_DIVERGENCE" }]);
});
check("unrecognized result -> invalid view (never throws)", () => {
  for (const bad of [null, undefined, {}, { status: "NOPE" }]) assert.equal(toDiagnosticsView(bad).invalid, true);
});
check("divergence summaries expose only {key,kind}; no record values leak", () => {
  const v = toDiagnosticsView({ status: "FAIL_PARITY", evidence: { status: "FAIL_PARITY", divergences: [{ key: "TST-9999", kind: "STATIC_WITHOUT_CANONICAL_UNAPPROVED", secret: "x" }] } });
  assert.deepEqual(Object.keys(v.divergenceSummary[0]).sort(), ["key", "kind"]);
  assert.ok(!JSON.stringify(v).includes("secret"));
});

// ---- isolation from PartsList / PartDetail ---------------------------------
check("Stage A modules do not import PartsList or PartDetail", () => {
  for (const p of [
    "src/domain/partsShadowParity.js",
    "src/domain/partsShadowParityCapture.js",
    "src/domain/partsShadowParityView.js",
    "src/modules/inventory/PartsShadowParityDiagnostics.jsx",
  ]) {
    const src = read(p);
    // no IMPORT of, and no JSX use of, PartsList/PartDetail (comment mentions are fine)
    assert.ok(!/from\s+["'][^"']*Part(sList|Detail)/.test(src), `${p} must not import PartsList/PartDetail`);
    assert.ok(!/<\s*Part(sList|Detail)[\s/>]/.test(src), `${p} must not render PartsList/PartDetail`);
  }
});
check("PartsList and PartDetail do not import the Stage A shadow-parity modules", () => {
  for (const p of ["src/modules/inventory/PartsList.jsx", "src/modules/inventory/PartDetail.jsx"]) {
    const src = read(p);
    assert.ok(!/partsShadowParity/i.test(src), `${p} must not import shadow-parity`);
    assert.ok(!/PartsShadowParityDiagnostics/.test(src), `${p} must not import the diagnostics surface`);
  }
});

// ---- production reader bundle is explicitly classified as FOUNDATION --------
// (source scan: the module imports Firebase, so it is not node-importable here)
check("production reader bundle is explicitly classified as foundation (cannot run live parity)", () => {
  const src = read("src/modules/inventory/partsShadowParityReaders.js");
  assert.ok(/FOUNDATION/.test(src), "must be labelled FOUNDATION");
  assert.ok(/adapterCommit:\s*null/.test(src), "foundation adapterCommit must be null (run BLOCKS)");
  // ledger/reorder/PO live readers are deferred -> report unavailable
  for (const reader of ["ledgerReader", "reorderReader", "purchaseOrderReader"]) {
    const re = new RegExp(reader + ":[^\\n]*unavailable");
    assert.ok(re.test(src), `${reader} must report unavailable in the foundation bundle`);
  }
});
check("diagnostics surface is NOT wired into navigation/App in this unit", () => {
  for (const p of ["src/App.jsx", "src/navigation/navConfig.js"]) {
    const src = read(p);
    assert.ok(!/PartsShadowParityDiagnostics|partsShadowParity/i.test(src), `${p} must not wire the diagnostics surface`);
  }
});

console.log(`\n${passed} passed`);
