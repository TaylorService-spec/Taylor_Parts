// EI Truck Registry -- trusted write service tests. Same conventions as
// partMasterCommands.test.mjs: Firestore emulator required (127.0.0.1:8080), imports the
// compiled ../lib output, seeds actor role via users/{uid}.role (admin/dispatcher security
// role -- NO capability), and injects the governed-inventory predicate. Never touches
// production. Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const {
  createTruck, assignDriver, reassignDriver, unassignDriver,
  changeStatus, changeHomeWarehouse, deactivateTruck, reactivateTruck,
} = await import("../lib/truckRegistry/truckRegistryCommands.js");
const {
  InvalidInputError, UnauthorizedActorError, TruckNotFoundError, TruckAlreadyExistsError,
  LocationClaimedError, EmployeeInvalidError, WarehouseInvalidError, InvalidStatusTransitionError,
  InventoryPresentError, InventoryStateUnknownError, VersionConflictError, IdempotencyConflictError,
  ClaimIntegrityError,
} = await import("../lib/truckRegistry/types.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;

async function seedActor(role) { const u = uid("actor"); await db.collection("users").doc(u).set({ role }); return u; }
async function seedEmployee(active = true) { const e = uid("emp"); await db.collection("employees").doc(e).set({ employmentStatus: active ? "ACTIVE" : "INACTIVE" }); return e; }
async function seedWarehouse(active = true) { const w = uid("wh"); await db.collection("warehouses").doc(w).set(active ? { name: "WH" } : { name: "WH", active: false }); return w; }

const DEPS = { now: () => new Date(1750000000000) }; // default probe = UNKNOWN
const ABSENT = { ...DEPS, hasGovernedInventoryAtLocation: async () => "ABSENT" };
const PRESENT = { ...DEPS, hasGovernedInventoryAtLocation: async () => "PRESENT" };

const admin1 = await seedActor("admin");
const disp1 = await seedActor("dispatcher");
const tech1 = await seedActor("technician");

async function makeTruck(deps = DEPS, over = {}) {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  const r = await createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, ...over }, deps);
  return { truckId, locationId, wh, version: r.version };
}

// ---- authorization ----
await check("admin creates truck: loc + truck + claim + audit(createTruck), version 1", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  const r = await createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh }, DEPS);
  assert.deepEqual(r, { outcome: "applied", version: 1 });
  const t = await db.collection("trucks").doc(truckId).get();
  assert.equal(t.data().locationId, locationId);
  assert.equal(t.data().active, true);
  assert.equal(t.data().status, "ACTIVE");
  assert.equal(t.data().assignedDriverEmployeeId, null);
  const loc = await db.collection("mobile_locations").doc(locationId).get();
  assert.equal(loc.data().type, "MOBILE"); assert.equal(loc.data().active, true);
  const claim = await db.collection("location_truck_claims").doc(locationId).get();
  assert.equal(claim.data().truckId, truckId);
  const audits = await db.collection("auditEvents").where("targetId", "==", truckId).get();
  assert.equal(audits.size, 1); assert.equal(audits.docs[0].data().action, "createTruck");
});
await check("dispatcher is authorized to create", async () => {
  const wh = await seedWarehouse(true);
  const r = await createTruck({ actorUid: disp1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: wh }, DEPS);
  assert.equal(r.outcome, "applied");
});
await check("technician create rejected (PERMISSION_DENIED) + denied audit; nothing written", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  await assert.rejects(createTruck({ actorUid: tech1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh }, DEPS), UnauthorizedActorError);
  assert.equal((await db.collection("trucks").doc(truckId).get()).exists, false);
  assert.equal((await db.collection("location_truck_claims").doc(locationId).get()).exists, false);
  const audits = await db.collection("auditEvents").where("targetId", "==", truckId).get();
  assert.equal(audits.docs[0].data().outcome, "denied");
});
await check("missing actorUid -> INVALID_INPUT", async () => {
  await assert.rejects(createTruck({ actorUid: "", idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse() }, DEPS), InvalidInputError);
});

// ---- validation / references ----
await check("invalid input (blank truckId) -> INVALID_INPUT", async () => {
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: "  ", locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse() }, DEPS), InvalidInputError);
});
await check("inactive/missing warehouse -> WAREHOUSE_INVALID", async () => {
  const wh = await seedWarehouse(false);
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: wh }, DEPS), WarehouseInvalidError);
});
await check("assigned driver not active -> EMPLOYEE_INVALID", async () => {
  const emp = await seedEmployee(false);
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), assignedDriverEmployeeId: emp }, DEPS), EmployeeInvalidError);
});
await check("duplicate truckId -> TRUCK_EXISTS", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c2"), truckId, locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse() }, DEPS), TruckAlreadyExistsError);
});
await check("second truck on a claimed location -> LOCATION_CLAIMED (1:1 enforced)", async () => {
  const { locationId } = await makeTruck();
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c2"), truckId: uid("TRK"), locationId, homeWarehouseId: await seedWarehouse() }, DEPS), LocationClaimedError);
});

// ---- idempotency + atomic rollback ----
await check("exact replay is idempotent (no dup write/audit, version stable)", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC"), k = key("c");
  await createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId, homeWarehouseId: wh }, DEPS);
  const r2 = await createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId, homeWarehouseId: wh }, DEPS);
  assert.deepEqual(r2, { outcome: "replayed", version: 1 });
  assert.equal((await db.collection("auditEvents").where("targetId", "==", truckId).get()).size, 1);
});
await check("same key, different request -> IDEMPOTENCY_CONFLICT", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), k = key("c");
  await createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId: uid("MLOC"), homeWarehouseId: wh }, DEPS);
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId: uid("MLOC2"), homeWarehouseId: wh }, DEPS), IdempotencyConflictError);
});
await check("transaction failure after staging leaves NO partial state (atomic)", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }), /boom/);
  assert.equal((await db.collection("trucks").doc(truckId).get()).exists, false);
  assert.equal((await db.collection("mobile_locations").doc(locationId).get()).exists, false);
  assert.equal((await db.collection("location_truck_claims").doc(locationId).get()).exists, false);
});

// ---- driver assign/reassign/unassign + custody non-mutation ----
await check("assign driver sets the field and does NOT mutate claim/location (custody unchanged)", async () => {
  const { truckId, locationId } = await makeTruck();
  const emp = await seedEmployee(true);
  const claimBefore = (await db.collection("location_truck_claims").doc(locationId).get()).data();
  const locBefore = (await db.collection("mobile_locations").doc(locationId).get()).data();
  const r = await assignDriver({ actorUid: admin1, idempotencyKey: key("a"), truckId, employeeId: emp, expectedVersion: 1 }, DEPS);
  assert.deepEqual(r, { outcome: "applied", version: 2 });
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().assignedDriverEmployeeId, emp);
  const claimAfter = (await db.collection("location_truck_claims").doc(locationId).get()).data();
  const locAfter = (await db.collection("mobile_locations").doc(locationId).get()).data();
  assert.deepEqual({ truckId: claimAfter.truckId, version: claimAfter.version }, { truckId: claimBefore.truckId, version: claimBefore.version });
  assert.deepEqual({ v: locAfter.version, active: locAfter.active }, { v: locBefore.version, active: locBefore.active });
});
await check("reassign to a new active driver, then unassign to null", async () => {
  const { truckId } = await makeTruck();
  const emp1 = await seedEmployee(true), emp2 = await seedEmployee(true);
  await assignDriver({ actorUid: admin1, idempotencyKey: key("a"), truckId, employeeId: emp1, expectedVersion: 1 }, DEPS);
  await reassignDriver({ actorUid: admin1, idempotencyKey: key("r"), truckId, employeeId: emp2, expectedVersion: 2 }, DEPS);
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().assignedDriverEmployeeId, emp2);
  await unassignDriver({ actorUid: admin1, idempotencyKey: key("u"), truckId, expectedVersion: 3 }, DEPS);
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().assignedDriverEmployeeId, null);
});
await check("assign inactive driver -> EMPLOYEE_INVALID", async () => {
  const { truckId } = await makeTruck();
  const emp = await seedEmployee(false);
  await assert.rejects(assignDriver({ actorUid: admin1, idempotencyKey: key("a"), truckId, employeeId: emp, expectedVersion: 1 }, DEPS), EmployeeInvalidError);
});
await check("assign on unknown truck -> TRUCK_NOT_FOUND", async () => {
  await assert.rejects(assignDriver({ actorUid: admin1, idempotencyKey: key("a"), truckId: uid("TRK"), employeeId: await seedEmployee(), expectedVersion: 1 }, DEPS), TruckNotFoundError);
});

// ---- concurrency (version CAS) ----
await check("wrong expectedVersion -> VERSION_CONFLICT", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(changeStatus({ actorUid: admin1, idempotencyKey: key("s"), truckId, status: "IDLE", expectedVersion: 99 }, DEPS), VersionConflictError);
});

// ---- change status (any distinct enum; not-distinct rejected) ----
await check("change status to a distinct value succeeds; does not touch active", async () => {
  const { truckId } = await makeTruck();
  const r = await changeStatus({ actorUid: admin1, idempotencyKey: key("s"), truckId, status: "IDLE", expectedVersion: 1 }, DEPS);
  assert.equal(r.version, 2);
  const t = (await db.collection("trucks").doc(truckId).get()).data();
  assert.equal(t.status, "IDLE"); assert.equal(t.active, true);
});
await check("change status to the SAME value -> INVALID_STATUS_TRANSITION", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(changeStatus({ actorUid: admin1, idempotencyKey: key("s"), truckId, status: "ACTIVE", expectedVersion: 1 }, DEPS), InvalidStatusTransitionError);
});

// ---- change home warehouse ----
await check("change home warehouse to an active warehouse; invalid warehouse rejected", async () => {
  const { truckId } = await makeTruck();
  const wh2 = await seedWarehouse(true);
  const r = await changeHomeWarehouse({ actorUid: admin1, idempotencyKey: key("w"), truckId, homeWarehouseId: wh2, expectedVersion: 1 }, DEPS);
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().homeWarehouseId, wh2);
  await assert.rejects(changeHomeWarehouse({ actorUid: admin1, idempotencyKey: key("w2"), truckId, homeWarehouseId: await seedWarehouse(false), expectedVersion: r.version }, DEPS), WarehouseInvalidError);
});

// ---- deactivation states ----
await check("deactivate with ABSENT inventory sets truck+location inactive and status OUT_OF_SERVICE", async () => {
  const { truckId, locationId } = await makeTruck();
  const r = await deactivateTruck({ actorUid: admin1, idempotencyKey: key("d"), truckId, expectedVersion: 1 }, ABSENT);
  assert.equal(r.version, 2);
  const t = (await db.collection("trucks").doc(truckId).get()).data();
  assert.equal(t.active, false); assert.equal(t.status, "OUT_OF_SERVICE");
  assert.equal((await db.collection("mobile_locations").doc(locationId).get()).data().active, false);
});
await check("deactivate with PRESENT inventory -> INVENTORY_PRESENT (blocked, nothing changes)", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(deactivateTruck({ actorUid: admin1, idempotencyKey: key("d"), truckId, expectedVersion: 1 }, PRESENT), InventoryPresentError);
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().active, true);
});
await check("deactivate with UNKNOWN inventory (default probe) -> INVENTORY_STATE_UNKNOWN (fail closed)", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(deactivateTruck({ actorUid: admin1, idempotencyKey: key("d"), truckId, expectedVersion: 1 }, DEPS), InventoryStateUnknownError);
  assert.equal((await db.collection("trucks").doc(truckId).get()).data().active, true);
});

// ---- reactivation ----
await check("reactivate requires explicit ACTIVE|IDLE; restores truck+location active", async () => {
  const { truckId, locationId } = await makeTruck();
  await deactivateTruck({ actorUid: admin1, idempotencyKey: key("d"), truckId, expectedVersion: 1 }, ABSENT);
  await assert.rejects(reactivateTruck({ actorUid: admin1, idempotencyKey: key("re"), truckId, targetStatus: "OUT_OF_SERVICE", expectedVersion: 2 }, DEPS), InvalidInputError);
  const r = await reactivateTruck({ actorUid: admin1, idempotencyKey: key("re"), truckId, targetStatus: "IDLE", expectedVersion: 2 }, DEPS);
  assert.equal(r.version, 3);
  const t = (await db.collection("trucks").doc(truckId).get()).data();
  assert.equal(t.active, true); assert.equal(t.status, "IDLE");
  assert.equal((await db.collection("mobile_locations").doc(locationId).get()).data().active, true);
});
await check("reactivate with a missing/mismatched claim -> CLAIM_INTEGRITY", async () => {
  const { truckId, locationId } = await makeTruck();
  await deactivateTruck({ actorUid: admin1, idempotencyKey: key("d"), truckId, expectedVersion: 1 }, ABSENT);
  await db.collection("location_truck_claims").doc(locationId).delete(); // Admin SDK tamper
  await assert.rejects(reactivateTruck({ actorUid: admin1, idempotencyKey: key("re"), truckId, targetStatus: "ACTIVE", expectedVersion: 2 }, DEPS), ClaimIntegrityError);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
