// EI Truck Registry -- onCall adapter tests. Same conventions as accessCommandCallables.test.js:
// invoke each v2 onCall via its `.run(request)` method (no HTTP layer), against the Firestore +
// Auth emulators, importing the compiled ../lib output. Proves: unauthenticated rejection,
// admin/dispatcher authorization mapping, actorUid derived ONLY from request.auth.uid (never
// request.data), the sanitized error->HttpsError mapping, and that deactivateTruck FAILS CLOSED
// (INVENTORY_STATE_UNKNOWN -> failed-precondition) under the default predicate.
// Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const c = await import("../lib/truckRegistry/truckRegistryCallables.js");
const { TruckAlreadyExistsError } = await import("../lib/truckRegistry/types.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined });

async function seedActor(role) { const u = uid("actor"); await db.collection("users").doc(u).set({ role }); return u; }
async function seedWarehouse() { const w = uid("wh"); await db.collection("warehouses").doc(w).set({ name: "WH" }); return w; }
async function seedEmployee() { const e = uid("emp"); await db.collection("employees").doc(e).set({ employmentStatus: "ACTIVE" }); return e; }
const LBL = { displayLabel: "Truck 204", vehicleNumber: "204" };

async function assertHttps(promise, expectedCode) {
  try { await promise; assert.fail(`expected HttpsError "${expectedCode}", none thrown`); }
  catch (err) { assert.equal(err.code, expectedCode, `expected "${expectedCode}", got "${err.code}": ${err.message}`); }
}

const admin1 = await seedActor("admin");
const disp1 = await seedActor("dispatcher");
const tech1 = await seedActor("technician");

async function createOk(actor = admin1, over = {}) {
  const wh = await seedWarehouse();
  const truckId = uid("TRK"), locationId = uid("MLOC");
  const r = await c.createTruckCallable.run(req({ idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, ...LBL, ...over }, actor));
  return { truckId, locationId, wh, r };
}

// ---- auth ----
await check("unauthenticated create -> unauthenticated", async () => {
  await assertHttps(c.createTruckCallable.run(req({ idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), ...LBL }, undefined)), "unauthenticated");
});
await check("technician create -> permission-denied", async () => {
  await assertHttps(c.createTruckCallable.run(req({ idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), ...LBL }, tech1)), "permission-denied");
});
await check("non-object data -> invalid-argument", async () => {
  await assertHttps(c.createTruckCallable.run(req("nope", admin1)), "invalid-argument");
});

// ---- success (admin + dispatcher) ----
await check("admin create succeeds; records written; audit actorUid == auth uid", async () => {
  const { truckId, r } = await createOk(admin1);
  assert.deepEqual(r, { outcome: "applied", version: 1 });
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().displayLabel, "Truck 204");
  const audits = await db.collection("auditEvents").where("targetId", "==", truckId).get();
  assert.equal(audits.docs[0].data().actorUid, admin1);
});
await check("dispatcher create succeeds", async () => {
  const { r } = await createOk(disp1);
  assert.equal(r.outcome, "applied");
});

// ---- actorUid is from request.auth.uid, NEVER request.data ----
await check("a spoofed actorUid in request.data is ignored (auth uid wins)", async () => {
  const { truckId } = await createOk(admin1, { actorUid: "evil-spoofed-uid" });
  const audits = await db.collection("auditEvents").where("targetId", "==", truckId).get();
  assert.equal(audits.docs[0].data().actorUid, admin1); // the real authenticated admin, not the data field
});

// ---- error mapping ----
await check("missing displayLabel -> invalid-argument", async () => {
  await assertHttps(c.createTruckCallable.run(req({ idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), vehicleNumber: "204" }, admin1)), "invalid-argument");
});
await check("duplicate truckId -> already-exists", async () => {
  const { truckId } = await createOk(admin1);
  await assertHttps(c.createTruckCallable.run(req({ idempotencyKey: key("c2"), truckId, locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), ...LBL }, admin1)), "already-exists");
});
await check("inactive warehouse -> failed-precondition", async () => {
  const wh = uid("wh"); await db.collection("warehouses").doc(wh).set({ name: "WH", active: false });
  await assertHttps(c.createTruckCallable.run(req({ idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: wh, ...LBL }, admin1)), "failed-precondition");
});
await check("assign driver: success, then wrong expectedVersion -> aborted", async () => {
  const { truckId } = await createOk(admin1);
  const emp = await seedEmployee();
  const r = await c.assignTruckDriverCallable.run(req({ idempotencyKey: key("a"), truckId, employeeId: emp, expectedVersion: 1 }, admin1));
  assert.equal(r.version, 2);
  await assertHttps(c.assignTruckDriverCallable.run(req({ idempotencyKey: key("a2"), truckId, employeeId: emp, expectedVersion: 99 }, admin1)), "aborted");
});

// ---- deactivate FAILS CLOSED on UNKNOWN (default predicate) ----
await check("deactivate -> failed-precondition (INVENTORY_STATE_UNKNOWN, fail-closed)", async () => {
  const { truckId } = await createOk(admin1);
  await assertHttps(c.deactivateTruckCallable.run(req({ idempotencyKey: key("d"), truckId, expectedVersion: 1 }, admin1)), "failed-precondition");
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().active, true); // unchanged
});

// ---- remaining wrappers ----
await check("changeStatus / changeHomeWarehouse / reassign / unassign / reactivate wrappers work", async () => {
  const { truckId } = await createOk(admin1);
  const emp1 = await seedEmployee(), emp2 = await seedEmployee(), wh2 = await seedWarehouse();
  await c.assignTruckDriverCallable.run(req({ idempotencyKey: key("a"), truckId, employeeId: emp1, expectedVersion: 1 }, admin1));
  const r2 = await c.reassignTruckDriverCallable.run(req({ idempotencyKey: key("r"), truckId, employeeId: emp2, expectedVersion: 2 }, admin1));
  assert.equal(r2.version, 3);
  await c.unassignTruckDriverCallable.run(req({ idempotencyKey: key("u"), truckId, expectedVersion: 3 }, admin1));
  const r4 = await c.changeTruckStatusCallable.run(req({ idempotencyKey: key("s"), truckId, status: "IDLE", expectedVersion: 4 }, admin1));
  assert.equal(r4.version, 5);
  const r5 = await c.changeTruckHomeWarehouseCallable.run(req({ idempotencyKey: key("w"), truckId, homeWarehouseId: wh2, expectedVersion: 5 }, admin1));
  assert.equal(r5.version, 6);
  const r6 = await c.reactivateTruckCallable.run(req({ idempotencyKey: key("re"), truckId, targetStatus: "ACTIVE", expectedVersion: 6 }, admin1));
  assert.equal(r6.version, 7);
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().status, "ACTIVE");
});
await check("reactivate with invalid targetStatus -> invalid-argument", async () => {
  const { truckId } = await createOk(admin1);
  await assertHttps(c.reactivateTruckCallable.run(req({ idempotencyKey: key("re"), truckId, targetStatus: "OUT_OF_SERVICE", expectedVersion: 1 }, admin1)), "invalid-argument");
});

// ---- idempotency passes through the callable ----
await check("idempotency: repeating the same request through the callable returns replayed", async () => {
  const wh = await seedWarehouse();
  const truckId = uid("TRK"), locationId = uid("MLOC"), k = key("c");
  const first = await c.createTruckCallable.run(req({ idempotencyKey: k, truckId, locationId, homeWarehouseId: wh, ...LBL }, admin1));
  assert.deepEqual(first, { outcome: "applied", version: 1 });
  const second = await c.createTruckCallable.run(req({ idempotencyKey: k, truckId, locationId, homeWarehouseId: wh, ...LBL }, admin1));
  assert.deepEqual(second, { outcome: "replayed", version: 1 });
  assert.equal((await db.collection("auditEvents").where("targetId", "==", truckId).get()).size, 1); // no duplicate write
});

// ---- sanitized error surfaces (end-to-end + direct) ----
await check("known error's raw internal message is NOT exposed (only the generic per-code message)", async () => {
  const { truckId } = await createOk(admin1); // real truckId, echoes into the raw service message
  try {
    await c.createTruckCallable.run(req({ idempotencyKey: key("c2"), truckId, locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), ...LBL }, admin1));
    assert.fail("expected an already-exists HttpsError");
  } catch (err) {
    assert.equal(err.code, "already-exists");
    assert.equal(err.message, "A truck already exists at that id.");        // the generic per-code message
    assert.doesNotMatch(err.message, new RegExp(truckId), "must not leak the truckId");
    assert.doesNotMatch(err.message, /already exists\b.*\b(truck )?[A-Za-z0-9-]{6,}/); // no raw "truck <id> already exists"
  }
});
await check("mapError: a known TruckRegistryError -> generic per-code message, no raw detail", () => {
  const https = c.mapError(new TruckAlreadyExistsError("truck TRK-SECRET-123 already exists at location MLOC-SECRET"));
  assert.equal(https.code, "already-exists");
  assert.equal(https.message, "A truck already exists at that id.");
  assert.doesNotMatch(https.message, /TRK-SECRET-123|MLOC-SECRET/);
});
await check("mapError: an unexpected/internal failure -> only the generic internal response", () => {
  const https = c.mapError(new Error("boom at /var/secret/path with token abc123"));
  assert.equal(https.code, "internal");
  assert.equal(https.message, "The request could not be completed.");
  assert.doesNotMatch(https.message, /boom|secret|token|abc123/);
});

// ---- deleteTruckCreatedInErrorCallable (admin-only; fails closed under the default probe) ----
await check("delete callable: unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.deleteTruckCreatedInErrorCallable.run(req({ idempotencyKey: key("del"), truckId: uid("TRK"), expectedVersion: 1, deletionReason: "x" })), "unauthenticated");
});
await check("delete callable: dispatcher (admin-only) -> permission-denied", async () => {
  const { truckId } = await createOk(admin1);
  await assertHttps(c.deleteTruckCreatedInErrorCallable.run(req({ idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: "created in error" }, disp1)), "permission-denied");
});
await check("delete callable: technician -> permission-denied", async () => {
  const { truckId } = await createOk(admin1);
  await assertHttps(c.deleteTruckCreatedInErrorCallable.run(req({ idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: "created in error" }, tech1)), "permission-denied");
});
await check("delete callable: admin + default UNKNOWN probe -> failed-precondition (fail closed)", async () => {
  const { truckId } = await createOk(admin1);
  await assertHttps(c.deleteTruckCreatedInErrorCallable.run(req({ idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: "created in error" }, admin1)), "failed-precondition");
});
await check("delete callable: missing/blank deletionReason -> invalid-argument", async () => {
  const { truckId } = await createOk(admin1);
  await assertHttps(c.deleteTruckCreatedInErrorCallable.run(req({ idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: "  " }, admin1)), "invalid-argument");
});
await check("mapError: TRUCK_REFERENCED / REFERENCE_STATE_UNKNOWN -> sanitized failed-precondition", async () => {
  const { TruckReferencedError, ReferenceStateUnknownError } = await import("../lib/truckRegistry/types.js");
  const a = c.mapError(new TruckReferencedError("truck TRK-SECRET has ledger row LR-9"));
  assert.equal(a.code, "failed-precondition");
  assert.equal(a.message, "This truck has operational history and cannot be deleted.");
  assert.doesNotMatch(a.message, /SECRET|LR-9/);
  const b = c.mapError(new ReferenceStateUnknownError("probe timeout at 10.0.0.1"));
  assert.equal(b.code, "failed-precondition");
  assert.equal(b.message, "The truck's operational history cannot be confirmed, so deletion is blocked.");
  assert.doesNotMatch(b.message, /10\.0\.0\.1/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
