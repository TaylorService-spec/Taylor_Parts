// INV-CONVERGENCE-E Stage A -- view mapper, authorization, sanitization, and
// PartsList/PartDetail isolation. Plain Node; offline; no Firebase/network.
import assert from "node:assert/strict";
import fs from "node:fs";
import { toDiagnosticsView, isDiagnosticsAuthorized, runFailureView, sanitizedEvidencePayload } from "../src/domain/partsShadowParityView.js";

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

// ---- production reader bundle wires the existing one-shot live readers + build id --
// (source scan: the module imports Firebase, so it is not node-importable here)
check("production reader bundle wires the existing one-shot readers via readOnce + build id", () => {
  const src = read("src/modules/inventory/partsShadowParityReaders.js");
  assert.ok(/fetchInventoryTransactions/.test(src), "ledger: fetchInventoryTransactions");
  assert.ok(/fetchReorderRequests/.test(src), "reorder: fetchReorderRequests");
  assert.ok(/fetchReorderPurchaseOrders/.test(src), "PO: fetchReorderPurchaseOrders (live reorder_purchase_orders)");
  for (const reader of ["ledgerReader", "reorderReader", "purchaseOrderReader"]) {
    assert.ok(new RegExp(reader + ":[^\\n]*readOnce").test(src), `${reader} must wrap a fetch via readOnce`);
  }
  assert.ok(/__APP_COMMIT__/.test(src), "adapterCommit sourced from the injected build id __APP_COMMIT__");
  assert.ok(!/adapterCommit:\s*null/.test(src), "no longer the foundation null commit");
});
check("the new one-shot readers exist and use the LIVE reorder collections (not dormant purchase_orders)", () => {
  const src = read("src/services/operationsQueries.ts");
  assert.ok(/reorder_requests/.test(src) && /fetchReorderRequests/.test(src));
  assert.ok(/reorder_purchase_orders/.test(src) && /fetchReorderPurchaseOrders/.test(src));
  assert.ok(!/onSnapshot\s*\(/.test(src), "operationsQueries stays one-shot (no onSnapshot call)");
});

// ---- dedicated gated route; no ordinary Inventory nav exposure -------------
check("diagnostics has a dedicated operator-only route and NO navigation entry", () => {
  const app = read("src/App.jsx");
  assert.ok(/path="\/admin\/diagnostics\/inventory-parts-parity"/.test(app), "exact diagnostics route present");
  assert.ok(/PartsShadowParityDiagnostics/.test(app), "route renders the diagnostics surface");
  assert.ok(!/PartsShadowParityDiagnostics|inventory-parts-parity|partsShadowParity/i.test(read("src/navigation/navConfig.js")), "no nav entry");
});
check("route authorization is enforced by the component gate (standard No Access, not obscurity)", () => {
  const comp = read("src/modules/inventory/PartsShadowParityDiagnostics.jsx");
  assert.ok(/isDiagnosticsAuthorized\(role\)/.test(comp), "component gates on admin/dispatcher role");
  assert.ok(/available to admin\/dispatcher only/.test(comp), "renders a standard No Access state when unauthorized");
});

// ---- execution behavior: manual, single active run, ephemeral, no persistence
check("execution is manual, single-active-run, ephemeral, and never persists/writes", () => {
  const comp = read("src/modules/inventory/PartsShadowParityDiagnostics.jsx");
  assert.ok(/onClick=\{run\}/.test(comp) && /disabled=\{running\}/.test(comp), "manual Run button, disabled while running");
  assert.ok(/if \(running\) return;/.test(comp), "repeat clicks ignored while running (single active run)");
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(comp), "no client persistence");
  assert.ok(!/setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|onSnapshot/.test(comp), "no Firestore writes/subscriptions");
});

// ---- unique run id: one reader bundle per mount (useRef) + provider from bundle ------
check("reader bundle is created once per mount (useRef) and run id comes from a provider", () => {
  const comp = read("src/modules/inventory/PartsShadowParityDiagnostics.jsx");
  assert.ok(/useRef/.test(comp) && /readersRef/.test(comp), "reader bundle stored in a ref (stable across runs/re-renders)");
  const readersSrc = read("src/modules/inventory/partsShadowParityReaders.js");
  assert.ok(/createRunIdProvider\(\)/.test(readersSrc), "runId sourced from createRunIdProvider() (persistent sequence)");
});

// ---- unexpected rejection handling ----------------------------------------
check("runFailureView is a sanitized blocked/unavailable view (no raw error/records)", () => {
  const v = runFailureView("run-x-1");
  assert.equal(v.invalid, false);
  assert.equal(v.status, "BLOCKED_UNAVAILABLE");
  assert.equal(v.isBlocked, true);
  const json = JSON.stringify(v);
  assert.ok(!/stack|Error:|password|token|"cost"|"price"|currentSummary/.test(json), "no raw error/record leakage");
});
check("component catches rejection: leaves running, keeps Run enabled, shows sanitized state", () => {
  const comp = read("src/modules/inventory/PartsShadowParityDiagnostics.jsx");
  assert.ok(/\.catch\(/.test(comp), "capture promise has a catch");
  assert.ok(/runFailureView\(\)/.test(comp), "catch renders the sanitized failure view");
  const catchBlock = comp.slice(comp.indexOf(".catch("));
  assert.ok(/phase:\s*"ready"/.test(catchBlock), "catch leaves running (sets phase ready -> button re-enabled, retry possible)");
  assert.ok(!/phase:\s*"running"/.test(catchBlock), "catch never re-enters running");
});

// ---- evidence surface: sanitized payload ----------------------------------
const REQUIRED_PAYLOAD_KEYS = ["status", "counts", "sourceCounts", "staticCatalogHash", "buildId", "runId", "capturedAtStart", "capturedAtEnd"];
const COUNT_KEYS = ["canonicalMatch", "staticOnlyExcluded", "rowMissing", "fieldDivergence", "availabilityDivergence", "workflowDivergence", "unexpectedUnmatched", "structuralIssue"];
const passView = () => toDiagnosticsView({
  status: "PASS",
  evidence: {
    runId: "run-f8f26d71-1", adapterCommit: "5609496", staticCatalogHash: "fnv1a32:f65d57fb",
    capturedAtStart: "2026-07-26T00:00:00.000Z", capturedAtEnd: "2026-07-26T00:00:01.000Z",
    sourceCounts: { canonical: 190, static: 200, ledger: 0, reorder: 0, po: 0 },
    canonicalMatchCount: 190, staticOnlyExcludedCount: 10, rowMissingCount: 0, fieldDivergenceCount: 0,
    availabilityDivergenceCount: 0, workflowDivergenceCount: 0, unexpectedUnmatchedCount: 0, structuralIssueCount: 0,
    status: "PASS", reason: null, divergences: [],
  },
});

check("copied payload contains EVERY required field (incl. capture timestamps + sourceCounts)", () => {
  const p = sanitizedEvidencePayload(passView());
  assert.deepEqual(Object.keys(p).sort(), [...REQUIRED_PAYLOAD_KEYS].sort());
  assert.deepEqual(Object.keys(p.counts).sort(), [...COUNT_KEYS].sort());
  assert.equal(p.status, "PASS");
  assert.equal(p.buildId, "5609496");
  assert.equal(p.runId, "run-f8f26d71-1");
  assert.equal(p.staticCatalogHash, "fnv1a32:f65d57fb");
  assert.equal(p.capturedAtStart, "2026-07-26T00:00:00.000Z");
  assert.equal(p.capturedAtEnd, "2026-07-26T00:00:01.000Z");
  assert.deepEqual(p.sourceCounts, { canonical: 190, static: 200, ledger: 0, reorder: 0, po: 0 });
  assert.equal(p.counts.canonicalMatch, 190);
  assert.equal(p.counts.staticOnlyExcluded, 10);
});
check("copied payload exposes NO identity / raw-record / divergence-value fields", () => {
  const json = JSON.stringify(sanitizedEvidencePayload(passView()));
  for (const bad of ["uid", "email", "password", "token", "divergenceSummary", "divergences", "key", "kind", "cost", "price", "currentSummary", "reason", "tone"]) {
    assert.ok(!new RegExp('"' + bad + '"').test(json), `payload must not contain "${bad}"`);
  }
});
check("copy is unavailable before a result exists (null payload for absent/invalid view)", () => {
  assert.equal(sanitizedEvidencePayload(null), null);
  assert.equal(sanitizedEvidencePayload(undefined), null);
  assert.equal(sanitizedEvidencePayload({ invalid: true }), null);
});
check("BLOCKED and FAIL results yield a copyable payload (diagnostic evidence only)", () => {
  const fail = sanitizedEvidencePayload(toDiagnosticsView({ status: "FAIL_PARITY", evidence: { status: "FAIL_PARITY", runId: "r", adapterCommit: "5609496", fieldDivergenceCount: 1, divergences: [{ key: "TST-1001", kind: "CURRENT_SHADOW_FIELD_DIVERGENCE" }] } }));
  assert.equal(fail.status, "FAIL_PARITY");
  assert.deepEqual(Object.keys(fail).sort(), [...REQUIRED_PAYLOAD_KEYS].sort());
  assert.ok(!/TST-1001|CURRENT_SHADOW/.test(JSON.stringify(fail)), "no divergence values in the payload");
  const blocked = sanitizedEvidencePayload(toDiagnosticsView({ status: "BLOCKED_PERMISSION", evidence: { status: "BLOCKED_PERMISSION", reason: "denied" } }));
  assert.equal(blocked.status, "BLOCKED_PERMISSION");
  assert.equal(blocked.staticCatalogHash, null); // absent -> null, not fabricated
});

check("component renders sanitized timestamps + sourceCounts + a manual Copy action (gated on a result)", () => {
  const comp = read("src/modules/inventory/PartsShadowParityDiagnostics.jsx");
  assert.ok(/capturedAtStart:/.test(comp) && /capturedAtEnd:/.test(comp), "renders capture timestamps");
  assert.ok(/sourceCounts:/.test(comp), "renders sourceCounts");
  assert.ok(/Copy sanitized evidence/.test(comp), "manual Copy action present");
  assert.ok(/sanitizedEvidencePayload\(v\)/.test(comp), "copies from the sanitized view model");
  // copy action lives inside the result-present branch (unavailable before a result)
  const resultBranch = comp.slice(comp.indexOf("v && !v.invalid ? ("));
  assert.ok(/Copy sanitized evidence/.test(resultBranch), "Copy button only rendered when a result exists");
});
check("copy action performs no write / network / download / persistence", () => {
  const comp = read("src/modules/inventory/PartsShadowParityDiagnostics.jsx");
  assert.ok(/navigator\.clipboard/.test(comp), "uses the clipboard copy action");
  assert.ok(!/fetch\(|XMLHttpRequest|axios/.test(comp), "no network");
  assert.ok(!/setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|onSnapshot/.test(comp), "no Firestore writes/subscriptions");
  // real persistence/download APIs only (avoid matching the word in comments)
  assert.ok(!/localStorage\.|sessionStorage\.|indexedDB\b|createObjectURL|download=|\.click\(\)/.test(comp), "no persistence / automatic download");
});

console.log(`\n${passed} passed`);
