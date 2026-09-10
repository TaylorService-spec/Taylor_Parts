// BIN-P7 -- Cycle Count admits BIN, behind the Bin conversion gate (Decision #178 B4).
//
// Drives the PRODUCTION composition (createCycleCountProduction & co.) on the emulator, so the policy
// under test is the one the deployed callables pin, not a test double. A real conversion is performed
// through relocateStock, proved by the real reconciliation, and recorded by the real completion builder.
//
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/binCycleCountEligibility.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts-emulator" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const cc = await import("../lib/cycleCount/cycleCountCommandComposition.js");
const { relocateStock } = await import("../lib/inventoryLocation/stockRelocationCommand.js");
const { BIN_SCHEMA_VERSION } = await import("../lib/inventoryLocation/binRegistry.js");
const { serializedAssetDocId } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { readBinConversionReport } = await import("../lib/inventoryLedger/binConversionReport.js");
const { buildConversionCompletion, ConversionNotProvenError, WAREHOUSE_BIN_CONVERSIONS_COLLECTION } = await import("../lib/inventoryLocation/binConversionGate.js");
const { reconcileBinConversion } = await import("../lib/inventoryLedger/binConversionReconciliation.js");
const { validateCycleCountLocationRef } = await import("../lib/cycleCount/cycleCountValidation.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const ts = Timestamp.fromDate(new Date(1_700_000_000_000));
const WH = (id) => ({ type: "WAREHOUSE", locationId: id });
const BIN = (id) => ({ type: "BIN", locationId: id });

async function seedWarehouse() {
  const id = nextId("wh");
  await db.collection("warehouses").doc(id).set({ id, name: id, location: "x", status: "ACTIVE", version: 1, updatedAt: ts, updatedBy: "seed", provenance: "NATIVE", createdAt: ts, createdBy: "seed" });
  return id;
}
async function seedBin(warehouseId, status = "ACTIVE") {
  const id = `bin_${String(runId).slice(-10)}${String((seq += 1)).padStart(30, "0")}`;
  await db.collection("bins").doc(id).set({ warehouseId, area: "PARTS_ROOM", aisle: "A", bay: 1, position: seq, code: `A01-${String(seq).padStart(3, "0")}`, name: null, status, version: 1, schemaVersion: BIN_SCHEMA_VERSION, idempotencyKey: nextId("bk"), fingerprint: "0".repeat(16) });
  return id;
}
async function receive(partId, warehouseId, qty) {
  await db.collection("inventory_transactions").doc(nextId("rcv")).set({
    schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE", location: WH(warehouseId), quantity: qty,
    sourceObject: { type: "RECEIVING_ORDER", id: nextId("ro") }, idempotencyKey: nextId("k"),
    actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" }, occurredAt: ts.toMillis(), recordedAt: ts, fingerprint: "0".repeat(16),
  });
}
const PARTS = new Map(); // partId -> trackingMode
const moveDeps = () => ({
  db, actor: { kind: "USER", id: nextId("mover") }, authorize: async () => true,
  resolvePart: async (_t, _d, id) => ({ partId: id, trackingMode: PARTS.get(id) ?? "NONE", active: true }),
  stageAudit: () => {}, now: () => new Date(),
});
const move = (partId, from, to, quantity, extra = {}) =>
  relocateStock({ partId, source: from, destination: to, ...(extra.serialNumbers ? {} : { quantity }), idempotencyKey: nextId("k"), ...extra }, moveDeps());

const ccInput = (actorId) => ({
  db, actor: { kind: "USER", id: actorId }, authorize: async () => true,
  resolvePart: async (_t, id) => ({ partId: id, trackingMode: PARTS.get(id) ?? "NONE", active: true }),
  stageAudit: () => {}, now: () => new Date(),
});
const createCount = (partId, location, actor = "counter") =>
  cc.createCycleCountProduction({ partId, location, idempotencyKey: nextId("cc") }, ccInput(actor));
async function codeOf(p) { try { await p; return null; } catch (e) { return e.code; } }

/** Convert: start the window, put stock away, reconcile, record completion from the balanced report. */
async function convert(warehouseId, work) {
  const start = Date.now() - 1;
  await work();
  const loaded = await readBinConversionReport(db, warehouseId, start, Date.now() + 1);
  const record = buildConversionCompletion(loaded.report, { completedBy: "test-operator", reportSha256: loaded.reportSha256, malformedRows: loaded.malformedRows });
  await db.collection(WAREHOUSE_BIN_CONVERSIONS_COLLECTION).doc(warehouseId).create({ ...record, completedAt: admin.firestore.FieldValue.serverTimestamp() });
  return loaded;
}

// ---------------------------------------------------------------- shape
await check("BIN is an admissible location SHAPE (eligibility is decided at command time)", () => {
  assert.deepEqual(validateCycleCountLocationRef(BIN("bin_x")), BIN("bin_x"));
});

// ---------------------------------------------------------------- before conversion: fail closed
await check("BEFORE conversion: counting an ACTIVE bin in an ACTIVE warehouse is refused", async () => {
  const wh = await seedWarehouse(); const binA = await seedBin(wh);
  const partId = nextId("part"); await receive(partId, wh, 10);
  await move(partId, WH(wh), BIN(binA), 4); // stock really is in the bin -- the warehouse is simply not converted
  assert.equal(await codeOf(createCount(partId, BIN(binA))), "LOCATION_INVALID");
});

// ---------------------------------------------------------------- after conversion
const W = await seedWarehouse();
const A = await seedBin(W); const B = await seedBin(W);
const P = nextId("part"); await receive(P, W, 10);
const SP = nextId("spart"); PARTS.set(SP, "SERIAL");
for (const [serialNo, loc] of [["S-1", W], ["S-2", W], ["S-3", W]]) {
  await db.collection("serialized_assets").doc(serializedAssetDocId(SP, serialNo)).set({
    schemaVersion: 1, serialNo, partId: SP, currentLocationId: loc, inventoryState: "AVAILABLE", currentEquipmentId: null,
    ownership: "COMPANY", activatedByReceivingId: nextId("rcv"), createdAtMillis: 1, createdByUid: "seed", updatedAtMillis: 1, updatedByUid: "seed",
  });
}

await check("the conversion reconciles and the gate is recorded ONLY from a balanced report", async () => {
  const loaded = await convert(W, async () => {
    await move(P, WH(W), BIN(A), 4);
    await move(P, WH(W), BIN(B), 3);
    await move(SP, WH(W), BIN(A), 1, { serialNumbers: ["S-1"] });
    await move(SP, WH(W), BIN(B), 1, { serialNumbers: ["S-2"] });
  });
  assert.equal(loaded.report.balanced, true);
  const rec = (await db.collection(WAREHOUSE_BIN_CONVERSIONS_COLLECTION).doc(W).get()).data();
  assert.equal(rec.state, "CONVERSION_COMPLETE");
  assert.equal(rec.evidence.reportSha256, loaded.reportSha256);
});

await check("an UNBALANCED report cannot pass the gate", () => {
  const unbalanced = reconcileBinConversion([
    { value: { type: "RECEIVED", quantity: 10, location: WH("X"), trackingMode: "NONE", partId: "p" }, recordedAt: 1 },
    { value: { type: "RELOCATION_IN", quantity: 4, location: BIN("bx"), trackingMode: "NONE", partId: "p" }, recordedAt: 5 },
  ], "X", new Map([["bx", "X"]]), 2, 9);
  assert.throws(() => buildConversionCompletion(unbalanced, { completedBy: "o", reportSha256: "0".repeat(64), malformedRows: 0 }), ConversionNotProvenError);
  const balanced = reconcileBinConversion([], "X", new Map(), 2, 9);
  assert.throws(() => buildConversionCompletion(balanced, { completedBy: "o", reportSha256: "0".repeat(64), malformedRows: 1 }), ConversionNotProvenError, "a report that skipped rows proves nothing");
});

await check("AFTER conversion: Bin A's expected quantity is EXACTLY Bin A -- not direct stock, not Bin B, not the roll-up", async () => {
  const outA = await createCount(P, BIN(A));
  assert.equal(outA.expectedQuantity, 4);
  const outB = await createCount(P, BIN(B));
  assert.equal(outB.expectedQuantity, 3);
  const outW = await createCount(P, WH(W));
  assert.equal(outW.expectedQuantity, 3, "a WAREHOUSE count expects the direct (unbinned) term only");
});

await check("serialized identity: Bin A expects exactly the unit whose custody is Bin A", async () => {
  const out = await createCount(SP, BIN(A));
  assert.deepEqual([...out.expectedSerialNumbers], ["S-1"]);
  assert.equal(out.expectedQuantity, 1);
});

await check("RECONCILIATION stays the only adjustment authority: a Bin A shortage adjusts Bin A and nothing else", async () => {
  const created = await createCount(P, BIN(A), "counter-1");
  await cc.submitCycleCountProduction({ cycleCountId: created.cycleCountId, countedQuantity: 3 }, ccInput("counter-1"));
  const beforeSelf = await codeOf(cc.reconcileCycleCountProduction({ cycleCountId: created.cycleCountId, reason: "one short" }, ccInput("counter-1")));
  const r = await cc.reconcileCycleCountProduction({ cycleCountId: created.cycleCountId, reason: "one short" }, ccInput("reviewer-1"));
  assert.equal(r.status, "RECONCILED");
  const adj = (await db.collection("inventory_transactions").where("sourceObject.id", "==", created.cycleCountId).get()).docs.map((d) => d.data());
  assert.equal(adj.length, 1);
  assert.deepEqual(adj[0].location, BIN(A));
  assert.equal(adj[0].quantity, -1);
  assert.equal((await createCount(P, BIN(B))).expectedQuantity, 3, "Bin B untouched");
  assert.equal((await createCount(P, WH(W))).expectedQuantity, 3, "direct stock untouched");
  assert.ok(beforeSelf === null || beforeSelf === "SEPARATION_OF_DUTIES", "SoD rules unchanged (material self-approval refused)");
});

await check("the gate is PER WAREHOUSE: converting W admits nothing in another warehouse", async () => {
  const other = await seedWarehouse(); const bin = await seedBin(other);
  assert.equal(await codeOf(createCount(P, BIN(bin))), "LOCATION_INVALID");
});

await check("an INACTIVE bin in a converted warehouse is refused", async () => {
  const retired = await seedBin(W, "INACTIVE");
  assert.equal(await codeOf(createCount(P, BIN(retired))), "LOCATION_INVALID");
});

await check("a malformed conversion record fails closed", async () => {
  const wh = await seedWarehouse(); const bin = await seedBin(wh);
  await db.collection(WAREHOUSE_BIN_CONVERSIONS_COLLECTION).doc(wh).set({ schemaVersion: 1, warehouseId: "someone-else", state: "CONVERSION_COMPLETE" });
  assert.equal(await codeOf(createCount(P, BIN(bin))), "LOCATION_INVALID");
});

await check("an unknown bin id is refused", async () => {
  assert.equal(await codeOf(createCount(P, BIN("bin_does_not_exist"))), "LOCATION_INVALID");
});

// ---------------------------------------------------------------- the completion script itself
await check("SCRIPT: completeBinConversion writes nothing on a stale hash, writes once on the reviewed one, and is idempotent", async () => {
  const { spawnSync } = await import("node:child_process");
  const wh = await seedWarehouse(); const bin = await seedBin(wh);
  const partId = nextId("part"); await receive(partId, wh, 6);
  const start = new Date(Date.now() - 1).toISOString();
  await move(partId, WH(wh), BIN(bin), 5);
  const end = new Date(Date.now() + 1).toISOString();
  const env = { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST };
  const run = (script, extra = []) => spawnSync(process.execPath, [`scripts/${script}`, "--warehouse", wh, "--start", start, "--end", end, ...extra], { encoding: "utf8", env });
  const reviewed = run("binConversionReconciliation.mjs");
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const sha = /report sha256: ([0-9a-f]{64})/.exec(reviewed.stdout)[1];

  const stale = run("completeBinConversion.mjs", ["--expect-report", "0".repeat(64)]);
  assert.equal(stale.status, 2);
  assert.equal((await db.collection(WAREHOUSE_BIN_CONVERSIONS_COLLECTION).doc(wh).get()).exists, false, "a stale hash writes nothing");

  const ok = run("completeBinConversion.mjs", ["--expect-report", sha]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /CONVERSION_COMPLETE recorded/);
  const again = run("completeBinConversion.mjs", ["--expect-report", sha]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /Already complete/);
  assert.equal((await createCount(partId, BIN(bin))).expectedQuantity, 5, "the gate it wrote admits the Bin");

  const missing = run("completeBinConversion.mjs");
  assert.equal(missing.status, 1, "--expect-report is required");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
