// Cycle Count A1 (sheet/line, schema v2) + A4 (durable governed read) -- emulator suite.
// Spec: docs/specifications/cycle-count-multi-part-sheet.md (Revision 2, Owner-approved), Decision #179.
// Numbers in [brackets] are the spec's own test list (1-36).
//
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/cycleCountSheet.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const C = await import("../lib/cycleCount/cycleCountSheetCommand.js");
const R = await import("../lib/cycleCount/cycleCountSheetRead.js");
const REPO = await import("../lib/cycleCount/cycleCountSheetRepository.js");
const CALL = await import("../lib/cycleCount/cycleCountSheetCallables.js");
const { makeResolveCycleCountLocationEligible } = await import("../lib/cycleCount/cycleCountLocationEligibility.js");
const { relocateStock } = await import("../lib/inventoryLocation/stockRelocationCommand.js");
const { BIN_SCHEMA_VERSION } = await import("../lib/inventoryLocation/binRegistry.js");
const { serializedAssetDocId } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { WAREHOUSE_BIN_CONVERSIONS_COLLECTION, buildConversionCompletion } = await import("../lib/inventoryLocation/binConversionGate.js");
const { readBinConversionReport } = await import("../lib/inventoryLedger/binConversionReport.js");
const { __resetRuntimeCapabilityOverridesCacheForTest } = await import("../lib/access/environmentCapabilityOverrides.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const T0 = Timestamp.fromDate(new Date(1_700_000_000_000));
const WH = (id) => ({ type: "WAREHOUSE", locationId: id });
const BIN = (id) => ({ type: "BIN", locationId: id });
const codeOf = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

// ---------------------------------------------------------------- fixtures
async function seedWarehouse(extra = {}) {
  const id = nextId("wh");
  await db.collection("warehouses").doc(id).set({ id, name: id, location: "x", status: "ACTIVE", version: 1, updatedAt: T0, updatedBy: "seed", provenance: "NATIVE", createdAt: T0, createdBy: "seed", ...extra });
  return id;
}
async function seedBin(warehouseId, status = "ACTIVE") {
  const id = `bin_${String(runId).slice(-10)}${String((seq += 1)).padStart(30, "0")}`;
  await db.collection("bins").doc(id).set({ warehouseId, area: "PARTS_ROOM", aisle: "A", bay: 1, position: seq, code: `A01-${String(seq).padStart(3, "0")}`, name: null, status, version: 1, schemaVersion: BIN_SCHEMA_VERSION, idempotencyKey: nextId("bk"), fingerprint: "0".repeat(16) });
  return id;
}
async function receive(partId, location, qty) {
  await db.collection("inventory_transactions").doc(nextId("rcv")).set({
    schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE", location, quantity: qty,
    sourceObject: { type: "RECEIVING_ORDER", id: nextId("ro") }, idempotencyKey: nextId("k"),
    actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" }, occurredAt: T0.toMillis(), recordedAt: T0, fingerprint: "0".repeat(16),
  });
}
async function seedSerial(partId, serialNo, locationId) {
  await db.collection("serialized_assets").doc(serializedAssetDocId(partId, serialNo)).set({
    schemaVersion: 1, serialNo, partId, currentLocationId: locationId, inventoryState: "AVAILABLE", currentEquipmentId: null,
    ownership: "COMPANY", activatedByReceivingId: nextId("rcv"), createdAtMillis: 1, createdByUid: "seed", updatedAtMillis: 1, updatedByUid: "seed",
  });
}
const PARTS = new Map(); // partId -> { trackingMode, active }
const part = (trackingMode = "NONE", active = true) => { const id = nextId("P"); PARTS.set(id, { trackingMode, active }); return id; };

let clock = 1_750_000_000_000;
function deps(actorId, grants = ["create", "submit", "reconcile", "cancel"]) {
  const caps = new Set(grants.map((g) => C.CYCLE_COUNT_CAPABILITY[g]));
  return {
    db, actor: { kind: "USER", id: actorId },
    authorize: async (_t, _a, cap) => caps.has(cap),
    resolvePart: async (_t, id) => (PARTS.has(id) ? { partId: id, ...PARTS.get(id) } : null),
    resolveLocationEligible: makeResolveCycleCountLocationEligible(db),
    resolveLocationCompany: (txn, loc) => CALL.resolveCountLocationCompany(txn, db, loc),
    stageAudit: () => {},
    now: () => new Date((clock += 1000)),
  };
}
const COUNTER = "counter-1", REVIEWER = "reviewer-1";
const sheetAt = async (location, who = COUNTER) => (await C.createCycleCountSheet({ location, idempotencyKey: nextId("s") }, deps(who))).sheetId;
const open = (sheetId, partId, who = COUNTER) => C.openCycleCountLine({ sheetId, partId }, deps(who));
const submit = (sheetId, partId, counted, who = COUNTER) => C.submitCycleCountLine({ sheetId, partId, ...counted }, deps(who));
const reconcile = (sheetId, partId, extra = {}, who = REVIEWER) => C.reconcileCycleCountLine({ sheetId, partId, reason: "checked", ...extra }, deps(who));
const lineDoc = async (sheetId, partId) => (await db.collection("cycle_counts").doc(sheetId).collection("lines").doc(REPO.cycleCountLineId(partId)).get()).data();
const adjustmentsFor = async (sheetId) => (await db.collection("inventory_transactions").where("sourceObject.id", "==", sheetId).get()).docs.map((d) => d.data());

const W = await seedWarehouse({ operatingCompanyId: "taylor" });

// ================================================================ sheet and location
await check("[1] creates a sheet against an eligible governed location, owned by its Warehouse's company", async () => {
  const out = await C.createCycleCountSheet({ location: WH(W), idempotencyKey: nextId("s") }, deps(COUNTER));
  assert.equal(out.outcome, "applied"); assert.equal(out.status, "OPEN");
  const d = (await db.collection("cycle_counts").doc(out.sheetId).get()).data();
  assert.equal(d.schemaVersion, 2); assert.equal(d.operatingCompanyId, "taylor");
  assert.ok(out.sheetId.startsWith("ccs_"), "v2 ids never share v1's cyc_ derivation");
  for (const k of ["partId", "expectedQuantity", "countedQuantity"]) assert.equal(d[k], undefined, `no part-scoped field on the sheet: ${k}`);
});
await check("[2][3] refuses an ineligible location: unknown, inactive Warehouse", async () => {
  assert.equal(await codeOf(C.createCycleCountSheet({ location: WH("nope"), idempotencyKey: nextId("s") }, deps(COUNTER))), "LOCATION_INVALID");
  const inactive = await seedWarehouse({ status: "INACTIVE" });
  assert.equal(await codeOf(C.createCycleCountSheet({ location: WH(inactive), idempotencyKey: nextId("s") }, deps(COUNTER))), "LOCATION_INVALID");
});
await check("[4] sheet create replays on the same key; conflicts on a different location", async () => {
  const key = nextId("s");
  const a = await C.createCycleCountSheet({ location: WH(W), idempotencyKey: key }, deps(COUNTER));
  const b = await C.createCycleCountSheet({ location: WH(W), idempotencyKey: key }, deps(COUNTER));
  assert.equal(b.outcome, "replayed"); assert.equal(b.sheetId, a.sheetId);
  const other = await seedWarehouse();
  assert.equal(await codeOf(C.createCycleCountSheet({ location: WH(other), idempotencyKey: key }, deps(COUNTER))), "IDEMPOTENCY_CONFLICT");
});

// ================================================================ line open and the expected authority
const P1 = part(); await receive(P1, WH(W), 10);
const SH = await sheetAt(WH(W));
await check("[5][13] opens a line -- and the response carries NO expected value", async () => {
  const out = await open(SH, P1);
  assert.equal(out.outcome, "applied"); assert.equal(out.status, "OPEN");
  assert.equal(out.expectedQuantity, undefined); assert.equal(out.expectedSerialNumbers, undefined);
  assert.equal(typeof out.expectedSnapshotAt, "number");
});
await check("[6] a repeat open returns the SAME line with no second snapshot", async () => {
  const before = await lineDoc(SH, P1);
  await receive(P1, WH(W), 5); // stock moves after the snapshot
  const again = await open(SH, P1);
  assert.equal(again.outcome, "replayed");
  const after = await lineDoc(SH, P1);
  assert.equal(after.expectedQuantity, before.expectedQuantity);
  assert.equal(after.expectedSnapshotAt.toMillis(), before.expectedSnapshotAt.toMillis());
  assert.equal(after.expectedQuantity, 10);
});
await check("[7][8][9] a discovered part uses the normal authority; zero only when the authority says zero", async () => {
  const stocked = part(); await receive(stocked, WH(W), 4);
  const empty = part();
  await open(SH, stocked); await open(SH, empty);
  assert.equal((await lineDoc(SH, stocked)).expectedQuantity, 4);
  assert.equal((await lineDoc(SH, empty)).expectedQuantity, 0);
});
await check("[10] SERIAL expected serials come from the registry (AVAILABLE at that location)", async () => {
  const SP = part("SERIAL");
  await seedSerial(SP, "S-1", W); await seedSerial(SP, "S-2", W); await seedSerial(SP, "S-9", "elsewhere");
  await open(SH, SP);
  const l = await lineDoc(SH, SP);
  assert.deepEqual(l.expectedSerialNumbers, ["S-1", "S-2"]); assert.equal(l.expectedQuantity, 2);
});
await check("[11] expectedSnapshotAt is per line and truthful", async () => {
  const a = part(), b = part();
  await open(SH, a); await open(SH, b);
  assert.notEqual((await lineDoc(SH, a)).expectedSnapshotAt.toMillis(), (await lineDoc(SH, b)).expectedSnapshotAt.toMillis());
});
await check("[12] refuses LOT; refuses an inactive or unknown part", async () => {
  assert.equal(await codeOf(open(SH, part("LOT"))), "PART_INVALID");
  assert.equal(await codeOf(open(SH, part("NONE", false))), "PART_INVALID");
  assert.equal(await codeOf(open(SH, "no-such-part")), "PART_INVALID");
});

// ================================================================ blind count
await check("[14][15] expected appears only in THAT line's submit response; siblings stay redacted", async () => {
  const x = part(), y = part(); await receive(x, WH(W), 7); await receive(y, WH(W), 3);
  const s = await sheetAt(WH(W));
  await open(s, x); await open(s, y);
  const sub = await submit(s, x, { countedQuantity: 7 });
  assert.equal(sub.expectedQuantity, 7); assert.equal(sub.variance, 0);
  const read = await R.getCycleCountSheet({ sheetId: s }, db);
  const lx = read.lines.find((l) => l.partId === x), ly = read.lines.find((l) => l.partId === y);
  assert.equal(lx.expectedQuantity, 7);
  assert.equal(ly.expectedQuantity, undefined, "an OPEN sibling's expected value never crosses the wire");
  assert.equal(ly.variance, undefined);
  assert.doesNotMatch(JSON.stringify(ly), /"expected(Quantity|SerialNumbers)"|"variance"/, "raw payload carries no expected value for an OPEN line");
});

// ================================================================ materiality and SoD
await check("[16][17][18] a MATERIAL line's submitter cannot dispose of it; a different principal can", async () => {
  const p = part(); await receive(p, WH(W), 10);
  const s = await sheetAt(WH(W));
  await open(s, p); await submit(s, p, { countedQuantity: 5 }); // -5 of 10: material
  assert.equal(await codeOf(reconcile(s, p, {}, COUNTER)), "SEPARATION_OF_DUTIES");
  assert.equal((await reconcile(s, p, {}, REVIEWER)).status, "RECONCILED");
});
await check("[19] a clean line is disposable by its own submitter even when a sibling is material", async () => {
  const clean = part(), material = part(); await receive(clean, WH(W), 100); await receive(material, WH(W), 10);
  const s = await sheetAt(WH(W));
  for (const p of [clean, material]) await open(s, p);
  await submit(s, clean, { countedQuantity: 99 }); await submit(s, material, { countedQuantity: 1 });
  assert.equal((await reconcile(s, clean, {}, COUNTER)).status, "RECONCILED");
  assert.equal(await codeOf(reconcile(s, material, {}, COUNTER)), "SEPARATION_OF_DUTIES");
});
await check("[20] a COUNTED line with a variance and no submittedBy fails closed on read", async () => {
  const p = part(); await receive(p, WH(W), 5);
  const s = await sheetAt(WH(W)); await open(s, p); await submit(s, p, { countedQuantity: 1 });
  const ref = db.collection("cycle_counts").doc(s).collection("lines").doc(REPO.cycleCountLineId(p));
  await ref.update({ submittedBy: admin.firestore.FieldValue.delete() });
  assert.equal(await codeOf(reconcile(s, p)), "MALFORMED_STORED_RECORD");
  assert.equal(await codeOf(R.getCycleCountSheet({ sheetId: s }, db)), "MALFORMED_STORED_RECORD", "the read fails closed too");
});

// ================================================================ disposition and atomicity
await check("[21][22][27] partial disposition; a line's decision and its evidence commit together; submit writes nothing", async () => {
  const a = part(), b = part(); await receive(a, WH(W), 10); await receive(b, WH(W), 10);
  const s = await sheetAt(WH(W));
  await open(s, a); await open(s, b);
  await submit(s, a, { countedQuantity: 8 }); await submit(s, b, { countedQuantity: 12 });
  assert.equal((await adjustmentsFor(s)).length, 0, "counting is observation");
  const r = await reconcile(s, a);
  assert.equal(r.ledgerEventIds.length, 1);
  const adj = await adjustmentsFor(s);
  assert.equal(adj.length, 1); assert.equal(adj[0].quantity, -2); assert.deepEqual(adj[0].location, WH(W));
  assert.equal((await lineDoc(s, b)).status, "COUNTED", "the other line is untouched");
});
await check("[23] an injected mid-transaction failure leaves no half-reconciled line and no orphan evidence", async () => {
  const p = part(); await receive(p, WH(W), 10);
  const s = await sheetAt(WH(W)); await open(s, p); await submit(s, p, { countedQuantity: 9 });
  const d = deps(REVIEWER);
  const failing = { ...d, stageAudit: () => { throw new Error("injected"); } };
  await assert.rejects(C.reconcileCycleCountLine({ sheetId: s, partId: p, reason: "x" }, failing));
  assert.equal((await lineDoc(s, p)).status, "COUNTED");
  assert.equal((await adjustmentsFor(s)).length, 0);
});
await check("[24][25] retry after a mid-sheet failure continues; replay stages no duplicate evidence", async () => {
  const ps = [part(), part(), part()];
  const s = await sheetAt(WH(W));
  for (const p of ps) { await receive(p, WH(W), 10); await open(s, p); await submit(s, p, { countedQuantity: 9 }); }
  await reconcile(s, ps[0]);
  const first = await reconcile(s, ps[0]); // retry of an applied line
  assert.equal(first.outcome, "replayed");
  for (const p of ps.slice(1)) await reconcile(s, p);
  assert.equal((await adjustmentsFor(s)).length, 3, "one adjustment per line, none doubled");
});
await check("[26] a decision cannot be reversed", async () => {
  const p = part(); await receive(p, WH(W), 10);
  const s = await sheetAt(WH(W)); await open(s, p); await submit(s, p, { countedQuantity: 9 });
  await reconcile(s, p);
  assert.equal(await codeOf(reconcile(s, p, { decision: "REJECT" })), "STATUS_INVALID");
});
await check("[28] REJECT stages no evidence and still requires a reason", async () => {
  const p = part(); await receive(p, WH(W), 10);
  const s = await sheetAt(WH(W)); await open(s, p); await submit(s, p, { countedQuantity: 4 });
  assert.equal(await codeOf(C.reconcileCycleCountLine({ sheetId: s, partId: p, decision: "REJECT" }, deps(REVIEWER))), "REASON_REQUIRED");
  const r = await reconcile(s, p, { decision: "REJECT" });
  assert.equal(r.status, "REJECTED"); assert.deepEqual(r.ledgerEventIds, []);
  assert.equal((await adjustmentsFor(s)).length, 0);
});
await check("[29] line cancel only before submit; sheet cancel only while no line is counted", async () => {
  const a = part(), b = part();
  const s = await sheetAt(WH(W)); await open(s, a); await open(s, b);
  assert.equal((await C.cancelCycleCountLine({ sheetId: s, partId: a }, deps(COUNTER))).status, "CANCELLED");
  await submit(s, b, { countedQuantity: 0 }); // [zero is a real count]
  assert.equal(await codeOf(C.cancelCycleCountLine({ sheetId: s, partId: b }, deps(COUNTER))), "STATUS_INVALID");
  assert.equal(await codeOf(C.cancelCycleCountSheet({ sheetId: s }, deps(COUNTER))), "SHEET_STATUS_INVALID");
  const s2 = await sheetAt(WH(W)); const c = part(); await open(s2, c);
  assert.equal((await C.cancelCycleCountSheet({ sheetId: s2 }, deps(COUNTER))).status, "CANCELLED");
  assert.equal((await lineDoc(s2, c)).status, "CANCELLED", "its open lines are cancelled with it");
  assert.equal(await codeOf(open(s2, part())), "SHEET_STATUS_INVALID");
});
await check("[30] close requires every non-cancelled line disposed; a closed sheet refuses work", async () => {
  const a = part(), b = part(); await receive(a, WH(W), 2); await receive(b, WH(W), 2);
  const s = await sheetAt(WH(W)); await open(s, a); await open(s, b);
  await submit(s, a, { countedQuantity: 2 });
  assert.equal(await codeOf(C.closeCycleCountSheet({ sheetId: s }, deps(REVIEWER))), "SHEET_STATUS_INVALID");
  await C.cancelCycleCountLine({ sheetId: s, partId: b }, deps(COUNTER));
  await reconcile(s, a, {}, REVIEWER);
  assert.equal((await C.closeCycleCountSheet({ sheetId: s }, deps(REVIEWER))).status, "CLOSED");
  assert.equal(await codeOf(open(s, part())), "SHEET_STATUS_INVALID");
});
await check("[31] one authority: the same eligibility seam and on-hand rule Transfer and P7 use", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../src/cycleCount/cycleCountSheetCommand.ts", import.meta.url), "utf8");
  assert.match(src, /computeExpectedQuantityThroughTxn/);
  assert.doesNotMatch(src, /\.type\s*===\s*"(RECEIVED|TRANSFER_IN|ADJUSTED)"/, "no second sign rule");
  const wiring = (await import("node:fs")).readFileSync(new URL("../src/cycleCount/cycleCountSheetCallables.ts", import.meta.url), "utf8");
  assert.match(wiring, /makeResolveCycleCountLocationEligible/);
});

// ================================================================ BIN and relocation (Rev 2)
const B_WH = await seedWarehouse({ operatingCompanyId: "ventana" });
const BA = await seedBin(B_WH), BB = await seedBin(B_WH);
const BP = part(); await receive(BP, WH(B_WH), 10);
const SBP = part("SERIAL"); await seedSerial(SBP, "B-1", B_WH); await seedSerial(SBP, "B-2", B_WH);
const moveDeps = { db, actor: { kind: "USER", id: "mover" }, authorize: async () => true,
  resolvePart: async (_t, _d, id) => ({ partId: id, trackingMode: PARTS.get(id)?.trackingMode ?? "NONE", active: true }), stageAudit: () => {}, now: () => new Date() };
const move = (partId, from, to, extra) => relocateStock({ partId, source: from, destination: to, idempotencyKey: nextId("mv"), ...extra }, moveDeps);

await check("[33] a BIN sheet is refused before its Warehouse passes the gate, admitted after", async () => {
  assert.equal(await codeOf(C.createCycleCountSheet({ location: BIN(BA), idempotencyKey: nextId("s") }, deps(COUNTER))), "LOCATION_INVALID");
  const start = Date.now() - 1;
  await move(BP, WH(B_WH), BIN(BA), { quantity: 4 });
  await move(BP, WH(B_WH), BIN(BB), { quantity: 3 });
  await move(SBP, WH(B_WH), BIN(BA), { serialNumbers: ["B-1"] });
  const loaded = await readBinConversionReport(db, B_WH, start, Date.now() + 1);
  await db.collection(WAREHOUSE_BIN_CONVERSIONS_COLLECTION).doc(B_WH).create({ ...buildConversionCompletion(loaded.report, { completedBy: "t", reportSha256: loaded.reportSha256, malformedRows: 0 }), completedAt: T0 });
  const s = await sheetAt(BIN(BA));
  assert.equal((await db.collection("cycle_counts").doc(s).get()).data().operatingCompanyId, "ventana", "a Bin inherits its parent Warehouse's company");
});
let BSHEET;
await check("[34] a BIN line expects the exact Bin -- not direct stock, not the sibling Bin", async () => {
  BSHEET = await sheetAt(BIN(BA));
  await open(BSHEET, BP);
  assert.equal((await lineDoc(BSHEET, BP)).expectedQuantity, 4);
  const sb = await sheetAt(BIN(BB)); await open(sb, BP);
  assert.equal((await lineDoc(sb, BP)).expectedQuantity, 3);
  const sw = await sheetAt(WH(B_WH)); await open(sw, BP);
  assert.equal((await lineDoc(sw, BP)).expectedQuantity, 3, "the Warehouse sheet expects the direct term only");
});
await check("[35] stock relocated between two line opens is in the later snapshot only", async () => {
  const late = part(); await receive(late, WH(B_WH), 5);
  const s = await sheetAt(BIN(BA));
  const early = part(); await receive(early, WH(B_WH), 5);
  await open(s, early);
  await move(early, WH(B_WH), BIN(BA), { quantity: 2 });
  await move(late, WH(B_WH), BIN(BA), { quantity: 2 });
  await open(s, late);
  assert.equal((await lineDoc(s, early)).expectedQuantity, 0, "opened before the move");
  assert.equal((await lineDoc(s, late)).expectedQuantity, 2, "opened after the move");
});
await check("[36] a serial relocated into the Bin is expected there; one relocated out is not", async () => {
  await open(BSHEET, SBP);
  assert.deepEqual((await lineDoc(BSHEET, SBP)).expectedSerialNumbers, ["B-1"]);
  const sw = await sheetAt(WH(B_WH)); await open(sw, SBP);
  assert.deepEqual((await lineDoc(sw, SBP)).expectedSerialNumbers, ["B-2"]);
});
await check("BIN reconciliation adjusts the exact Bin only", async () => {
  await submit(BSHEET, BP, { countedQuantity: 3 });
  await reconcile(BSHEET, BP);
  const adj = await adjustmentsFor(BSHEET);
  assert.equal(adj.length, 1); assert.deepEqual(adj[0].location, BIN(BA)); assert.equal(adj[0].quantity, -1);
});
await check("serial count: duplicates refused; missing and unexpected recorded; only missing adjusts", async () => {
  assert.equal(await codeOf(submit(BSHEET, SBP, { countedSerialNumbers: ["B-1", "B-1"] })), "PART_INVALID");
  const sub = await submit(BSHEET, SBP, { countedSerialNumbers: ["X-9"] });
  assert.deepEqual(sub.serialVariance, { missing: ["B-1"], unexpected: ["X-9"] });
  const r = await reconcile(BSHEET, SBP);
  const adj = (await adjustmentsFor(BSHEET)).filter((a) => a.partId === SBP);
  assert.equal(adj.length, 1); assert.equal(adj[0].serialNo, "B-1");
  assert.equal(r.ledgerEventIds.length, 1);
});

// ================================================================ strict version boundary + A4
await check("a v1 record is never read as v2 -- not by a command, not by the reader, not by the list", async () => {
  const v1id = `cyc_${String(runId).padStart(40, "0").slice(-40)}`;
  await db.collection("cycle_counts").doc(v1id).set({ schemaVersion: 1, partId: "P", status: "OPEN", location: WH(W) });
  assert.equal(await codeOf(open(v1id, P1)), "MALFORMED_STORED_RECORD");
  assert.equal(await codeOf(R.getCycleCountSheet({ sheetId: v1id }, db)), "SHEET_NOT_FOUND");
  let cursor = null; const seen = [];
  do { const page = await R.listCycleCountSheets({ limit: 50, ...(cursor ? { cursor } : {}) }, db); seen.push(...page.sheets); cursor = page.nextCursor; } while (cursor);
  assert.ok(!seen.some((x) => x.sheetId === v1id)); assert.ok(seen.every((x) => x.sheetId.startsWith("ccs_")));
});
await check("A4: pagination is explicit, never a silent truncation; resume reads a sheet's lines back", async () => {
  const s = await sheetAt(WH(W));
  const ps = [part(), part(), part()]; for (const p of ps) await open(s, p);
  const p1 = await R.getCycleCountSheet({ sheetId: s, limit: 2 }, db);
  assert.equal(p1.lines.length, 2); assert.ok(p1.nextCursor);
  const p2 = await R.getCycleCountSheet({ sheetId: s, limit: 2, cursor: p1.nextCursor }, db);
  assert.equal(p2.lines.length, 1); assert.equal(p2.nextCursor, null);
  assert.deepEqual([...p1.lines, ...p2.lines].map((l) => l.partId).sort(), [...ps].sort());
  assert.equal(await codeOf(R.getCycleCountSheet({ sheetId: s, where: "x" }, db).catch((e) => { throw Object.assign(e, { code: "INVALID" }); })), "INVALID");
});
await check("A4 callable: authenticated + a Cycle Count capability required; production-inactive", async () => {
  const uid = `cc-read-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`${uid}-r`).set({ principalUid: uid, roleId: "inventoryCycleCountReconciler", scope: { type: "global" }, grantedBy: "t", grantedAt: T0, status: "active", accessVersionAtGrant: 1 });
  const tech = `cc-tech-${runId}`;
  await db.collection("users").doc(tech).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`${tech}-r`).set({ principalUid: tech, roleId: "technician", scope: { type: "global" }, grantedBy: "t", grantedAt: T0, status: "active", accessVersionAtGrant: 1 });
  const req = (u, data = {}) => ({ data, auth: u ? { uid: u, token: {} } : undefined });
  assert.equal(await codeOf(CALL.runListCycleCountSheets(req(undefined), db)), "unauthenticated");
  assert.equal(await codeOf(CALL.runListCycleCountSheets(req(uid), db)), "permission-denied", "inactive outside an activating environment");
  const prev = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = "eos-platform-sandbox"; __resetRuntimeCapabilityOverridesCacheForTest();
  try {
    const out = await CALL.runListCycleCountSheets(req(uid, { limit: 5 }), db);
    assert.ok(Array.isArray(out.sheets));
    assert.equal(await codeOf(CALL.runListCycleCountSheets(req(tech), db)), "permission-denied");
    assert.equal(await codeOf(CALL.runCreateCycleCountSheet(req(uid, { location: WH(W), idempotencyKey: nextId("s"), stray: 1 }), db)), "invalid-argument");
    assert.equal(await codeOf(CALL.runCreateCycleCountSheet(req(uid, { location: WH(W), idempotencyKey: nextId("s") }), db)), "permission-denied", "a reconciler cannot open a count");
  } finally {
    if (prev === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = prev;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
});

// ================================================================ Rules posture and the v1 boundary
await check("[32] Rules: the only cycle_counts rule denies everything, and nothing can reach the lines subcollection", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["../../firestore.rules", "../../field-ops-app-vite/firestore.rules"]) {
    const rules = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(rules, /\{[a-zA-Z_]+=\*\*\}/, `${f}: a recursive wildcard would reach every subcollection`);
    const blocks = [...rules.matchAll(/match \/cycle_counts\/\{[^}]+\}\s*\{([^}]*)\}/g)];
    assert.equal(blocks.length, 1, `${f}: exactly one cycle_counts rule`);
    assert.match(blocks[0][1], /allow read, write: if false;/, `${f}: it denies all client access`);
    assert.doesNotMatch(rules, /match \/cycle_counts\/\{[^}]+\}\/lines/, `${f}: no rule opens the lines subcollection`);
  }
});
await check("v1 is unreachable from any deployed function: index.ts exports only the sheet/line family", async () => {
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  for (const v1 of ["createCycleCountCallable", "submitCycleCountCallable", "reconcileCycleCountCallable", "cancelCycleCountCallable", "cycleCount/cycleCountCallables\""]) {
    assert.ok(!index.includes(v1), `index.ts must not export ${v1}`);
  }
  for (const v2 of ["createCycleCountSheet", "openCycleCountLine", "submitCycleCountLine", "reconcileCycleCountLine", "listCycleCountSheets", "getCycleCountSheet"]) {
    assert.ok(index.includes(`as ${v2}`), `index.ts must export ${v2}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
