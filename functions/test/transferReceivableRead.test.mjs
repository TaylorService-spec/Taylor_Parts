// listMyReceivableTransfers -- the technician's command-scoped Transfer read. Firestore emulator.
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/transferReceivableRead.test.mjs (after npm run build)
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const R = await import("../lib/inventoryTransfer/transferReceivableRead.js");
const CALL = await import("../lib/inventoryTransfer/transferCallables.js");
const { createTransferOrder, dispatchTransferOrder, receiveTransferOrder, UnauthorizedTransferError } = await import("../lib/inventoryTransfer/transferOrderCommand.js");
const { serializeTransferOrder, fingerprintTransferOrder } = await import("../lib/inventoryTransfer/transferOrderRepository.js");
const { makeResolveTransferLocationActive } = await import("../lib/inventoryTransfer/transferLocationResolver.js");
const { makeResolveTransferPermissionThroughTxn } = await import("../lib/inventoryTransfer/transferCallableWiring.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);
const codeOf = async (p) => { try { await p; return null; } catch (e) { return e.details?.code ?? e.code; } };

// ---- fixtures -----------------------------------------------------------------------------------
async function seedWarehouse(id) {
  await db.collection("warehouses").doc(id).set({
    id, name: id, location: "x", status: "ACTIVE", version: 1, updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
    provenance: "NATIVE", createdAt: Timestamp.fromDate(NOW), createdBy: "seed",
  });
}
async function seedMobileLocation(id) {
  await db.collection("mobile_locations").doc(id).set({
    locationId: id, type: "MOBILE", displayLabel: id, active: true, version: 1,
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed", updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
  });
}
/** A technician: users/{uid}.technicianId, and (optionally) N trucks whose driver is that technician. */
async function seedTechnician({ trucks = 1, status = "ACTIVE" } = {}) {
  const uid = nextId("uid"); const technicianId = nextId("tech");
  await db.collection("users").doc(uid).set({ role: "technician", technicianId });
  const locations = [];
  for (let i = 0; i < trucks; i += 1) {
    const locationId = nextId("truck-loc");
    await seedMobileLocation(locationId);
    await db.collection("trucks").doc(nextId("truck")).set({ assignedDriverEmployeeId: technicianId, locationId, status, displayLabel: `Van ${locationId}` });
    locations.push(locationId);
  }
  return { uid, technicianId, truckLoc: locations[0] ?? null };
}
/** A stored order in any status, written through the real serializer. */
async function seedOrder({ destination, status = "IN_TRANSIT", trackingMode = "NONE", serialNumbers, extra = {} }) {
  const origin = { type: "WAREHOUSE", locationId: nextId("wh") };
  const value = {
    partId: nextId("part"), trackingMode, quantity: serialNumbers ? serialNumbers.length : 2, origin, destination,
    ...(serialNumbers ? { serialNumbers } : {}), idempotencyKey: nextId("idem"),
  };
  const id = `trf_${String(runId)}${String((seq += 1)).padStart(12, "0")}`;
  const data = serializeTransferOrder(value, { kind: "USER", id: "seed" }, NOW, fingerprintTransferOrder(value), `TO-2026-${String(seq).padStart(6, "0")}`);
  await db.collection("transfer_orders").doc(id).set({ ...data, status, ...extra });
  return id;
}
const MOBILE = (locationId) => ({ type: "MOBILE", locationId });
const allow = { db, resolveReceivePermission: async () => true };
const list = (uid, data, deps = allow) => R.listMyReceivableTransfers(uid, data, deps);
const callAs = (uid, data, deps = allow) => CALL.runListMyReceivableTransfers({ auth: uid ? { uid } : null, data }, deps);

// ---- authority and identity ---------------------------------------------------------------------
await check("1 unauthenticated caller is refused", async () => {
  assert.equal(await codeOf(callAs(null, {})), "unauthenticated");
});
await check("2 a caller without inventory.transfer.receive is refused (injected and REAL resolver)", async () => {
  const t = await seedTechnician();
  await seedOrder({ destination: MOBILE(t.truckLoc) });
  const e = await callAs(t.uid, {}, { db, resolveReceivePermission: async () => false }).catch((x) => x);
  assert.equal(e.code, "permission-denied"); assert.equal(e.details.code, "PERMISSION_DENIED");
  const real = { db, resolveReceivePermission: (txn, uid) => makeResolveTransferPermissionThroughTxn("inventory.transfer.receive")(txn, db, uid) };
  assert.equal(await codeOf(callAs(t.uid, {}, real)), "PERMISSION_DENIED", "no roleAssignment -> the receive resolver denies");
});
await check("3 the technician identity is server-derived from users/{uid}.technicianId", async () => {
  const t = await seedTechnician();
  const id = await seedOrder({ destination: MOBILE(t.truckLoc) });
  const r = await list(t.uid, {});
  assert.equal(r.truck.locationId, t.truckLoc);
  assert.deepEqual(r.transfers.map((x) => x.transferOrderId), [id]);
  const noMap = nextId("uid"); await db.collection("users").doc(noMap).set({ role: "technician" });
  assert.equal(await codeOf(list(noMap, {})), "TECHNICIAN_IDENTITY_UNAVAILABLE");
});
await check("4-6 the caller cannot supply employeeId, truckId, destination, status, filters or an actor", async () => {
  const t = await seedTechnician();
  for (const bad of [{ employeeId: "x" }, { technicianId: "x" }, { truckId: "x" }, { destination: MOBILE("x") }, { status: "REQUESTED" }, { where: "x" }, { uid: "x" }, { capability: "x" }, { cursor: "a/b" }, []]) {
    const e = await callAs(t.uid, bad).catch((x) => x);
    assert.equal(e.code, "invalid-argument", JSON.stringify(bad));
  }
});
await check("7 exactly one assigned truck resolves", async () => {
  const t = await seedTechnician();
  assert.equal((await list(t.uid)).truck.locationId, t.truckLoc);
  assert.equal((await list(t.uid, null)).transfers.length, 0);
});
await check("8 no truck assignment is distinguishable from zero transfers", async () => {
  const none = await seedTechnician({ trucks: 0 });
  const e = await callAs(none.uid, {}).catch((x) => x);
  assert.equal(e.code, "failed-precondition"); assert.equal(e.details.code, "NO_TRUCK_ASSIGNMENT");
  const inactive = await seedTechnician({ status: "OUT_OF_SERVICE" });
  assert.equal(await codeOf(list(inactive.uid)), "NO_TRUCK_ASSIGNMENT", "an out-of-service truck is not a receiving destination");
  const empty = await seedTechnician();
  assert.deepEqual((await list(empty.uid)).transfers, [], "an assigned truck with no work is an EMPTY SUCCESS");
});
await check("9 two assigned trucks fail closed -- never pick one", async () => {
  const t = await seedTechnician({ trucks: 2 });
  await seedOrder({ destination: MOBILE(t.truckLoc) });
  assert.equal(await codeOf(callAs(t.uid, {})), "TRUCK_ASSIGNMENT_AMBIGUOUS");
});

// ---- scope ----------------------------------------------------------------------------------------
await check("10-14 only IN_TRANSIT to MY truck: not another truck, not REQUESTED/COMPLETED/CANCELLED, not a warehouse", async () => {
  const me = await seedTechnician(); const other = await seedTechnician();
  const mine = await seedOrder({ destination: MOBILE(me.truckLoc) });
  await seedOrder({ destination: MOBILE(other.truckLoc) });
  await seedOrder({ destination: MOBILE(me.truckLoc), status: "REQUESTED" });
  await seedOrder({ destination: MOBILE(me.truckLoc), status: "COMPLETED" });
  await seedOrder({ destination: MOBILE(me.truckLoc), status: "CANCELLED" });
  await seedOrder({ destination: { type: "WAREHOUSE", locationId: me.truckLoc } }); // same id, different type
  assert.deepEqual((await list(me.uid)).transfers.map((x) => x.transferOrderId), [mine]);
  assert.ok(!(await list(other.uid)).transfers.some((x) => x.transferOrderId === mine), "another technician never sees it");
});
await check("15-16 the projection is the exact allow-list: no actor, audit, fingerprint, balance or availability", async () => {
  const t = await seedTechnician();
  await seedOrder({ destination: MOBILE(t.truckLoc), trackingMode: "SERIAL", serialNumbers: ["S1", "S2"] });
  const [p] = (await list(t.uid)).transfers;
  assert.deepEqual(Object.keys(p).sort(), ["destination", "origin", "partId", "quantity", "serialNumbers", "status", "trackingMode", "transferOrderId", "transferOrderNumber"]);
  assert.deepEqual(p.serialNumbers, ["S1", "S2"]); assert.equal(p.quantity, 2);
  const r = await list(t.uid);
  assert.deepEqual(Object.keys(r).sort(), ["nextCursor", "transfers", "truck"]);
  assert.deepEqual(Object.keys(r.truck).sort(), ["label", "locationId"]);
  const json = JSON.stringify(r);
  for (const leak of ["onHand", "available", "reserved", "fingerprint", "createdBy", "updatedBy", "actor", "idempotencyKey", "version"]) assert.ok(!json.includes(`"${leak}"`), leak);
});
await check("17 a malformed stored record fails the read closed -- never widened, never leaked, never 'no work'", async () => {
  const t = await seedTechnician();
  await seedOrder({ destination: MOBILE(t.truckLoc), extra: { secretNote: "do-not-leak" } });
  const e = await callAs(t.uid, {}).catch((x) => x);
  assert.equal(e.code, "failed-precondition"); assert.equal(e.details.code, "MALFORMED_STORED_RECORD");
  assert.ok(!e.message.includes("do-not-leak"));
});
await check("18 paging is explicit: a full page names its cursor, the last page says so", async () => {
  const t = await seedTechnician();
  const ids = [];
  for (let i = 0; i < R.RECEIVABLE_PAGE_MAX + 2; i += 1) ids.push(await seedOrder({ destination: MOBILE(t.truckLoc) }));
  const p1 = await list(t.uid);
  assert.equal(p1.transfers.length, R.RECEIVABLE_PAGE_MAX); assert.ok(p1.nextCursor);
  const p2 = await list(t.uid, { cursor: p1.nextCursor });
  assert.equal(p2.transfers.length, 2); assert.equal(p2.nextCursor, null);
  assert.deepEqual([...p1.transfers, ...p2.transfers].map((x) => x.transferOrderId).sort(), ids.sort());
});

// ---- the receipt is still the existing command --------------------------------------------------
await check("19-20 a projected order is received through receiveTransferOrder, which re-authorizes on its own", async () => {
  const t = await seedTechnician();
  const origin = { type: "WAREHOUSE", locationId: nextId("wh") };
  await seedWarehouse(origin.locationId);
  const partId = nextId("part");
  await db.collection("inventory_transactions").doc(nextId("seedmv")).set({
    schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE", location: origin, quantity: 5,
    sourceObject: { type: "RECEIVING_ORDER", id: nextId("rcv") }, idempotencyKey: nextId("idem"),
    actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" }, occurredAt: NOW.getTime(), recordedAt: Timestamp.fromDate(NOW), fingerprint: "0".repeat(16),
  });
  const cmdDeps = (grants) => ({
    db, actor: { kind: "USER", id: t.uid }, authorize: async (_t, _a, cap) => grants.includes(cap),
    resolvePart: async (_t, id) => ({ partId: id, trackingMode: "NONE", active: true }),
    resolveLocationActive: makeResolveTransferLocationActive(db), stageAudit: () => {}, now: () => NOW,
  });
  const warehouse = cmdDeps(["inventory.transfer.create", "inventory.transfer.dispatch"]);
  const { transferOrderId } = await createTransferOrder({ partId, quantity: 3, origin, destination: MOBILE(t.truckLoc), idempotencyKey: nextId("idem") }, warehouse);
  assert.ok(!(await list(t.uid)).transfers.some((x) => x.transferOrderId === transferOrderId), "REQUESTED is not yet receivable");
  await dispatchTransferOrder({ transferOrderId }, warehouse);
  const [seen] = (await list(t.uid)).transfers;
  assert.equal(seen.transferOrderId, transferOrderId);
  // The read admitted it; the command still decides for itself.
  await assert.rejects(receiveTransferOrder({ transferOrderId: seen.transferOrderId }, cmdDeps([])), UnauthorizedTransferError);
  const done = await receiveTransferOrder({ transferOrderId: seen.transferOrderId }, cmdDeps(["inventory.transfer.receive"]));
  assert.equal(done.outcome, "applied");
  assert.equal((await db.collection("transfer_orders").doc(transferOrderId).get()).data().status, "COMPLETED");
  assert.deepEqual((await list(t.uid)).transfers, [], "a completed transfer is no longer actionable");
});

// ---- static fences ------------------------------------------------------------------------------
await check("no Rules change and no new capability: the read rides inventory.transfer.receive", async () => {
  const src = readFileSync(new URL("../src/inventoryTransfer/transferCallables.ts", import.meta.url), "utf8");
  assert.match(src, /listMyReceivableTransfersCallable[\s\S]*resolveReceivePermission: wiring\.resolveReceivePermission/);
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /listMyReceivableTransfersCallable as listMyReceivableTransfers/);
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/transfer_orders\/\{transferOrderId\} \{\s*allow read: if isAdminOrDispatcher\(\)\s*\|\| isAssignedToWarehouse\(resource\.data\.fromWarehouseId\)\s*\|\| isAssignedToWarehouse\(resource\.data\.toWarehouseId\);/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
