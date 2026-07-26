// INV-CONVERGENCE-E Stage A -- capture-orchestrator tests. Offline, INJECTED fakes;
// no Firebase, no network. Verifies reader-outcome translation, absent-not-empty,
// short-circuit before comparison, incomplete-input, and one-shot reads.
import assert from "node:assert/strict";
import fs from "node:fs";
import { captureShadowParity } from "../src/domain/partsShadowParityCapture.js";

const rel = (p) => new URL(p, new URL("../", import.meta.url));
const CAPTURE_SRC = fs.readFileSync(rel("src/domain/partsShadowParityCapture.js"), "utf8");
const POSTWRITE = JSON.parse(fs.readFileSync(
  rel("../docs/audits/inv1-phase1/create-execution-20260724/postwrite-analyzer/row-results.json"), "utf8"));
const CATALOG_SRC = fs.readFileSync(rel("src/data/partsCatalog.ts"), "utf8");

let passed = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { passed += 1; console.log(`  ok - ${name}`); }); }
console.log("partsShadowParityCapture.test.mjs");

// ---- fixtures + a counting fake factory ------------------------------------
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

// a fake reader that counts invocations
function fake(result) {
  const f = async () => { f.calls += 1; return result; };
  f.calls = 0;
  return f;
}
function readers(over = {}) {
  const base = {
    canonicalPartsReader: fake({ ok: true, parts: CANONICAL }),
    staticCatalogProvider: fake({ ok: true, rows: STATIC }),
    ledgerReader: fake({ ok: true, rows: [] }),
    reorderReader: fake({ ok: true, rows: [] }),
    purchaseOrderReader: fake({ ok: true, rows: [] }),
    clock: () => "t",
    runId: () => "run-x",
    adapterCommit: "test",
  };
  return { ...base, ...over };
}

await check("success: canonical OK with actual rows -> PASS; each reader called exactly once", async () => {
  const r = readers();
  const { status } = await captureShadowParity(r);
  assert.equal(status, "PASS");
  for (const k of ["canonicalPartsReader", "staticCatalogProvider", "ledgerReader", "reorderReader", "purchaseOrderReader"]) {
    assert.equal(r[k].calls, 1, `${k} called once`);
  }
});

await check("permission-denied -> BLOCKED_PERMISSION; rows never [] ; other readers NOT called", async () => {
  const r = readers({ canonicalPartsReader: fake({ ok: false, code: "permission-denied" }) });
  const { status, evidence } = await captureShadowParity(r);
  assert.equal(status, "BLOCKED_PERMISSION");
  assert.equal(evidence.sourceCounts, null);
  // short-circuit: non-canonical readers not invoked
  assert.equal(r.staticCatalogProvider.calls, 0);
  assert.equal(r.ledgerReader.calls, 0);
  assert.equal(r.reorderReader.calls, 0);
  assert.equal(r.purchaseOrderReader.calls, 0);
  assert.equal(r.canonicalPartsReader.calls, 1);
});

await check("unavailable -> BLOCKED_UNAVAILABLE; canonical treated as absent, not empty", async () => {
  const r = readers({ canonicalPartsReader: fake({ ok: false, code: "unavailable" }) });
  const { status } = await captureShadowParity(r);
  assert.equal(status, "BLOCKED_UNAVAILABLE");
  assert.equal(r.staticCatalogProvider.calls, 0); // short-circuit before comparison
});

await check("failed required ledger read -> BLOCKED_INCOMPLETE_INPUT (canonical OK)", async () => {
  const r = readers({ ledgerReader: fake({ ok: false, code: "unavailable" }) });
  const { status } = await captureShadowParity(r);
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
  assert.equal(r.canonicalPartsReader.calls, 1);
  assert.equal(r.ledgerReader.calls, 1); // invoked once, still failed
});

await check("failed static provider -> BLOCKED_INCOMPLETE_INPUT", async () => {
  const r = readers({ staticCatalogProvider: fake({ ok: false, code: "unavailable" }) });
  const { status } = await captureShadowParity(r);
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
});

await check("missing adapterCommit (foundation) -> BLOCKED_INCOMPLETE_INPUT", async () => {
  const r = readers({ adapterCommit: null });
  const { status } = await captureShadowParity(r);
  assert.equal(status, "BLOCKED_INCOMPLETE_INPUT");
});

await check("no reader invoked more than once per run (success path)", async () => {
  const r = readers();
  await captureShadowParity(r);
  for (const k of ["canonicalPartsReader", "staticCatalogProvider", "ledgerReader", "reorderReader", "purchaseOrderReader"]) {
    assert.ok(r[k].calls <= 1, `${k} <= 1`);
  }
});

await check("orchestrator source imports no Firebase and performs no writes", () => {
  assert.ok(!/from\s+["'][^"']*firebase/i.test(CAPTURE_SRC));
  assert.ok(!/partMasterQueries/.test(CAPTURE_SRC));
  assert.ok(!/setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction/.test(CAPTURE_SRC));
  // one-shot reads: no realtime subscription APIs
  assert.ok(!/onSnapshot|subscribe\(/.test(CAPTURE_SRC));
});

console.log(`\n${passed} passed`);
