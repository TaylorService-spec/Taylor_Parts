// BIN CONVERSION RECONCILIATION -- pure proofs plus one real conversion on the emulator.
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/binConversionReconciliation.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts-emulator" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const { reconcileBinConversion } = await import("../lib/inventoryLedger/binConversionReconciliation.js");
const { relocateStock } = await import("../lib/inventoryLocation/stockRelocationCommand.js");
const { BIN_SCHEMA_VERSION } = await import("../lib/inventoryLocation/binRegistry.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;

const row = (type, quantity, location, recordedAt, partId = "P1") => ({
  value: { type, quantity, location, trackingMode: "NONE", partId }, recordedAt,
});
const WH = { type: "WAREHOUSE", locationId: "WH" };
const BA = { type: "BIN", locationId: "binA" };
const P = new Map([["binA", "WH"]]);

// ================================ pure ================================
await check("a clean conversion balances: relocation nets to zero, aggregate unchanged", async () => {
  const r = reconcileBinConversion([
    row("RECEIVED", 10, WH, 100),
    row("RELOCATION_OUT", 6, WH, 200), row("RELOCATION_IN", 6, BA, 200),
  ], "WH", P, 150, 300);
  assert.equal(r.balanced, true);
  assert.deepEqual({ ...r.parts[0] }, { partId: "P1", aggregateBefore: 10, aggregateAfter: 10, relocationNet: 0, otherNet: 0, binnedAfter: 6, directAfter: 4, balanced: true });
});

await check("concurrent real activity is EXPLAINED, not forbidden", async () => {
  const r = reconcileBinConversion([
    row("RECEIVED", 10, WH, 100),
    row("RELOCATION_OUT", 4, WH, 200), row("RELOCATION_IN", 4, BA, 200),
    row("WORK_ORDER_CONSUMPTION", -3, BA, 250), // a job used 3 from the bin mid-conversion
  ], "WH", P, 150, 300);
  assert.equal(r.balanced, true);
  assert.equal(r.parts[0].aggregateAfter - r.parts[0].aggregateBefore, -3);
  assert.equal(r.parts[0].otherNet, -3);
});

await check("a one-sided relocation is caught", async () => {
  const r = reconcileBinConversion([row("RECEIVED", 10, WH, 100), row("RELOCATION_IN", 4, BA, 200)], "WH", P, 150, 300);
  assert.equal(r.balanced, false);
  assert.equal(r.parts[0].relocationNet, 4);
});

await check("a row at an unresolved bin is reported, never assumed to be this warehouse's", async () => {
  const r = reconcileBinConversion([row("RELOCATION_IN", 4, { type: "BIN", locationId: "binGhost" }, 200)], "WH", P, 150, 300);
  assert.deepEqual(r.unresolvedBinIds, ["binGhost"]);
  assert.equal(r.balanced, false);
});

await check("rows after the window are excluded; another warehouse's rows are ignored", async () => {
  const r = reconcileBinConversion([
    row("RECEIVED", 10, WH, 100),
    row("RECEIVED", 99, WH, 999),
    row("RECEIVED", 50, { type: "WAREHOUSE", locationId: "OTHER" }, 200),
  ], "WH", P, 150, 300);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].aggregateAfter, 10);
});

// ================================ a real conversion, through the governed command ================================
async function seedWarehouse(id) {
  const ts = Timestamp.fromDate(new Date(1_700_000_000_000));
  await db.collection("warehouses").doc(id).set({ id, name: id, location: "x", status: "ACTIVE", version: 1, updatedAt: ts, updatedBy: "seed", provenance: "NATIVE", createdAt: ts, createdBy: "seed" });
}
async function seedBin(warehouseId) {
  const id = `bin_${String(runId).slice(-10)}${String((seq += 1)).padStart(30, "0")}`;
  await db.collection("bins").doc(id).set({ warehouseId, area: "PARTS_ROOM", aisle: "A", bay: 1, position: seq, code: `A01-${String(seq).padStart(3, "0")}`, name: null, status: "ACTIVE", version: 1, schemaVersion: BIN_SCHEMA_VERSION, idempotencyKey: nextId("bk"), fingerprint: "0".repeat(16) });
  return id;
}

await check("END TO END: put-away via relocateStock, then the reconciliation script reports BALANCED", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh); const binB = await seedBin(wh);
  const partId = nextId("part");
  const receivedAt = new Date(Date.now() - 60_000);
  await db.collection("inventory_transactions").doc(nextId("rcv")).set({
    schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE",
    location: { type: "WAREHOUSE", locationId: wh }, quantity: 12,
    sourceObject: { type: "RECEIVING_ORDER", id: nextId("ro") }, idempotencyKey: nextId("k"),
    actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" }, occurredAt: receivedAt.getTime(),
    recordedAt: Timestamp.fromDate(receivedAt), fingerprint: "0".repeat(16),
  });
  const startIso = new Date(Date.now() - 1000).toISOString();
  const deps = {
    db, actor: { kind: "USER", id: nextId("op") },
    authorize: async () => true,
    resolvePart: async (_t, _d, id) => ({ partId: id, trackingMode: "NONE", active: true }),
    stageAudit: () => {}, now: () => new Date(),
  };
  await relocateStock({ partId, source: { type: "WAREHOUSE", locationId: wh }, destination: { type: "BIN", locationId: binA }, quantity: 7, idempotencyKey: nextId("k") }, deps);
  await relocateStock({ partId, source: { type: "BIN", locationId: binA }, destination: { type: "BIN", locationId: binB }, quantity: 2, idempotencyKey: nextId("k") }, deps);

  const out = execFileSync(process.execPath, ["scripts/binConversionReconciliation.mjs", "--warehouse", wh, "--start", startIso], {
    encoding: "utf8", env: { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST },
  });
  assert.match(out, /BALANCED --/);
  assert.doesNotMatch(out, /NOT BALANCED/);
  assert.match(out, new RegExp(`${partId}\\s+12\\s+12\\s+0\\s+0\\s+7\\s+5\\s+yes`), "12 before, 12 after, 7 binned, 5 still direct");
});

await check("the script refuses production by name", async () => {
  let threw = null;
  try {
    execFileSync(process.execPath, ["scripts/binConversionReconciliation.mjs", "--projectId", "taylor-parts", "--warehouse", "x", "--start", "2026-01-01T00:00:00Z"], {
      encoding: "utf8", env: { ...process.env, FIRESTORE_EMULATOR_HOST: "" }, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) { threw = err; }
  assert.ok(threw, "must exit non-zero");
  assert.match(String(threw.stderr), /production project\. Refused by name/);
});

// Gate E moved from SHAPE to POLICY in BIN-P7 (Decision #178 B4): Cycle Count accepts a BIN location
// shape, and its command-time eligibility refuses a Bin whose Warehouse has not passed the conversion
// gate -- counting before conversion books stock still recorded direct as a positive variance, and an
// ADJUSTED +N would double it. The refusal and everything after the gate are proved in
// test/binCycleCountEligibility.test.mjs against the production composition.
await check("GATE E (P7): BIN is an admitted SHAPE; eligibility is the conversion-gated policy", async () => {
  const { CYCLE_COUNT_LOCATION_TYPES } = await import("../lib/cycleCount/cycleCountTypes.js");
  assert.deepEqual([...CYCLE_COUNT_LOCATION_TYPES], ["WAREHOUSE", "MOBILE", "BIN"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
