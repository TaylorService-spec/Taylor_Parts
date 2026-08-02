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
  changeStatus, changeHomeWarehouse, deactivateTruck, reactivateTruck, deleteTruckCreatedInError,
} = await import("../lib/truckRegistry/truckRegistryCommands.js");
const {
  InvalidInputError, UnauthorizedActorError, TruckNotFoundError, TruckAlreadyExistsError,
  LocationClaimedError, EmployeeInvalidError, WarehouseInvalidError, InvalidStatusTransitionError,
  InventoryPresentError, InventoryStateUnknownError, VersionConflictError, IdempotencyConflictError,
  ClaimIntegrityError, TruckReferencedError, ReferenceStateUnknownError,
} = await import("../lib/truckRegistry/types.js");
// The AUTHORITATIVE governed read contract (pure ESM, no firebase) -- the parity test proves
// records produced by createTruck() round-trip through it.
const { validateMobileLocation, validateTruckRecord } =
  await import("../../field-ops-app-vite/src/domain/truckRegistry.js");

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

// displayLabel + vehicleNumber are REQUIRED create inputs (the read contract drops records
// without them) -- every create that is meant to pass validation supplies them.
const LBL = { displayLabel: "Truck 204", vehicleNumber: "204" };

async function makeTruck(deps = DEPS, over = {}) {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  const r = await createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, ...LBL, ...over }, deps);
  return { truckId, locationId, wh, version: r.version };
}

// ---- authorization ----
await check("admin creates truck: loc + truck + claim + audit(createTruck), version 1", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  const r = await createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, ...LBL }, DEPS);
  assert.deepEqual(r, { outcome: "applied", version: 1 });
  const t = await db.collection("trucks").doc(truckId).get();
  assert.equal(t.data().locationId, locationId);
  assert.equal(t.data().active, true);
  assert.equal(t.data().status, "ACTIVE");
  assert.equal(t.data().assignedDriverEmployeeId, null);
  assert.equal(t.data().displayLabel, "Truck 204");
  assert.equal(t.data().vehicleNumber, "204");
  const loc = await db.collection("mobile_locations").doc(locationId).get();
  assert.equal(loc.data().type, "MOBILE"); assert.equal(loc.data().active, true);
  const claim = await db.collection("location_truck_claims").doc(locationId).get();
  assert.equal(claim.data().truckId, truckId);
  const audits = await db.collection("auditEvents").where("targetId", "==", truckId).get();
  assert.equal(audits.size, 1); assert.equal(audits.docs[0].data().action, "createTruck");
});
await check("dispatcher is authorized to create", async () => {
  const wh = await seedWarehouse(true);
  const r = await createTruck({ actorUid: disp1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: wh, ...LBL }, DEPS);
  assert.equal(r.outcome, "applied");
});
await check("technician create rejected (PERMISSION_DENIED) + denied audit; nothing written", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  await assert.rejects(createTruck({ actorUid: tech1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, ...LBL }, DEPS), UnauthorizedActorError);
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
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: wh, ...LBL }, DEPS), WarehouseInvalidError);
});
await check("assigned driver not active -> EMPLOYEE_INVALID", async () => {
  const emp = await seedEmployee(false);
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), assignedDriverEmployeeId: emp, ...LBL }, DEPS), EmployeeInvalidError);
});
// displayLabel + vehicleNumber are REQUIRED (the read contract drops records without them).
await check("missing displayLabel -> INVALID_INPUT", async () => {
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), vehicleNumber: "204" }, DEPS), InvalidInputError);
});
await check("blank displayLabel -> INVALID_INPUT", async () => {
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), displayLabel: "   ", vehicleNumber: "204" }, DEPS), InvalidInputError);
});
await check("missing vehicleNumber -> INVALID_INPUT", async () => {
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), displayLabel: "Truck 204" }, DEPS), InvalidInputError);
});
await check("blank vehicleNumber -> INVALID_INPUT", async () => {
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId: uid("TRK"), locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), displayLabel: "Truck 204", vehicleNumber: "   " }, DEPS), InvalidInputError);
});
// CONTRACT PARITY: a record produced by createTruck() must pass the authoritative read
// contract (validateMobileLocation + validateTruckRecord) -- including its governed storage
// metadata (version/audit stamps) and truck `active`. This proves composeTruckFleet will NOT
// discard a created truck as malformed (Codex PR #512 P2, requirement 5).
await check("PARITY: createTruck() records pass validateMobileLocation() + validateTruckRecord()", async () => {
  const wh = await seedWarehouse(true);
  const emp = await seedEmployee(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  await createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, assignedDriverEmployeeId: emp, ...LBL }, DEPS);
  const locData = (await db.collection("mobile_locations").doc(locationId).get()).data();
  const truckData = (await db.collection("trucks").doc(truckId).get()).data();
  const locR = validateMobileLocation(locationId, locData);
  assert.equal(locR.valid, true, `mobile_location rejected: ${locR.reason}`);
  const truckR = validateTruckRecord(truckId, truckData, { mobileLocation: locR.value });
  assert.equal(truckR.valid, true, `truck rejected: ${truckR.reason}`);
  assert.equal(truckR.value.displayLabel, "Truck 204");
  assert.equal(truckR.value.vehicleNumber, "204");
});
await check("duplicate truckId -> TRUCK_EXISTS", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c2"), truckId, locationId: uid("MLOC"), homeWarehouseId: await seedWarehouse(), ...LBL }, DEPS), TruckAlreadyExistsError);
});
await check("second truck on a claimed location -> LOCATION_CLAIMED (1:1 enforced)", async () => {
  const { locationId } = await makeTruck();
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c2"), truckId: uid("TRK"), locationId, homeWarehouseId: await seedWarehouse(), ...LBL }, DEPS), LocationClaimedError);
});

// ---- idempotency + atomic rollback ----
await check("exact replay is idempotent (no dup write/audit, version stable)", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC"), k = key("c");
  await createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId, homeWarehouseId: wh, ...LBL }, DEPS);
  const r2 = await createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId, homeWarehouseId: wh, ...LBL }, DEPS);
  assert.deepEqual(r2, { outcome: "replayed", version: 1 });
  assert.equal((await db.collection("auditEvents").where("targetId", "==", truckId).get()).size, 1);
});
await check("same key, different request -> IDEMPOTENCY_CONFLICT", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), k = key("c");
  await createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId: uid("MLOC"), homeWarehouseId: wh, ...LBL }, DEPS);
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: k, truckId, locationId: uid("MLOC2"), homeWarehouseId: wh, ...LBL }, DEPS), IdempotencyConflictError);
});
await check("transaction failure after staging leaves NO partial state (atomic)", async () => {
  const wh = await seedWarehouse(true);
  const truckId = uid("TRK"), locationId = uid("MLOC");
  await assert.rejects(createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, ...LBL }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }), /boom/);
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

// ---- deleteTruckCreatedInError (admin-only Created-in-Error hard delete) ----
const CLEAR = { ...DEPS, hasOperationalReferences: async () => "CLEAR" };
const REFERENCED = { ...DEPS, hasOperationalReferences: async () => "REFERENCED" };
const REASON = "created in error - duplicate entry";
async function docsExist(truckId, locationId) {
  const [t, l, c] = await Promise.all([
    db.collection("trucks").doc(truckId).get(),
    db.collection("mobile_locations").doc(locationId).get(),
    db.collection("location_truck_claims").doc(locationId).get(),
  ]);
  return { t: t.exists, l: l.exists, c: c.exists };
}

await check("delete: admin + CLEAR probe + no driver -> truck+location+claim gone, tombstone written", async () => {
  const { truckId, locationId } = await makeTruck();
  const k = key("del");
  const r = await deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: k, truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR);
  assert.deepEqual(r, { outcome: "applied", version: 1 });
  assert.deepEqual(await docsExist(truckId, locationId), { t: false, l: false, c: false });
  // Immutable deletion tombstone: exactly one auditEvents doc for this actor/target with the action + reason.
  const audits = await db.collection("auditEvents").where("actorUid", "==", admin1).where("targetId", "==", truckId).get();
  const tomb = audits.docs.map((d) => d.data()).find((a) => a.action === "deleteTruckCreatedInError");
  assert.ok(tomb, "tombstone audit exists");
  assert.equal(tomb.outcome, "applied");
  assert.match(tomb.summary, /deleted-in-error truck/);
  assert.match(tomb.summary, /reason:\[created in error - duplicate entry\]/);
});

await check("delete retry (same key) -> replayed, idempotent (no error though truck is gone)", async () => {
  const { truckId } = await makeTruck();
  const k = key("del");
  await deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: k, truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR);
  const retry = await deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: k, truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR);
  assert.equal(retry.outcome, "replayed");
});

await check("delete same key, DIFFERENT reason -> IDEMPOTENCY_CONFLICT", async () => {
  const { truckId } = await makeTruck();
  const k = key("del");
  await deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: k, truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR);
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: k, truckId, expectedVersion: 1, deletionReason: "different reason" }, CLEAR), IdempotencyConflictError);
});

await check("delete DENIED for dispatcher (admin-only) -> truck untouched", async () => {
  const { truckId, locationId } = await makeTruck();
  await assert.rejects(deleteTruckCreatedInError({ actorUid: disp1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR), UnauthorizedActorError);
  assert.deepEqual(await docsExist(truckId, locationId), { t: true, l: true, c: true });
});

await check("delete DENIED for technician", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(deleteTruckCreatedInError({ actorUid: tech1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR), UnauthorizedActorError);
});

await check("delete malformed: empty reason / reason with '=' / bad truckId / bad version -> INVALID_INPUT", async () => {
  const { truckId } = await makeTruck();
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: "   " }, CLEAR), InvalidInputError);
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: "fp=deadbeefdeadbeef" }, CLEAR), InvalidInputError);
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId: "  ", expectedVersion: 1, deletionReason: REASON }, CLEAR), InvalidInputError);
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 0, deletionReason: REASON }, CLEAR), InvalidInputError);
});

await check("delete VERSION_CONFLICT (stale expectedVersion) -> truck untouched", async () => {
  const { truckId, locationId } = await makeTruck();
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 99, deletionReason: REASON }, CLEAR), VersionConflictError);
  assert.deepEqual(await docsExist(truckId, locationId), { t: true, l: true, c: true });
});

await check("delete BLOCKED: truck has a driver assignment (conclusive) -> TRUCK_REFERENCED", async () => {
  const { truckId, locationId } = await makeTruck();
  const emp = await seedEmployee(true);
  const a = await assignDriver({ actorUid: admin1, idempotencyKey: key("a"), truckId, employeeId: emp, expectedVersion: 1 }, CLEAR);
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: a.version, deletionReason: REASON }, CLEAR), TruckReferencedError);
  assert.deepEqual(await docsExist(truckId, locationId), { t: true, l: true, c: true });
});

await check("delete BLOCKED: reference probe REFERENCED -> TRUCK_REFERENCED, truck untouched", async () => {
  const { truckId, locationId } = await makeTruck();
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: REASON }, REFERENCED), TruckReferencedError);
  assert.deepEqual(await docsExist(truckId, locationId), { t: true, l: true, c: true });
});

await check("delete FAILS CLOSED: default probe UNKNOWN -> REFERENCE_STATE_UNKNOWN, truck untouched", async () => {
  const { truckId, locationId } = await makeTruck();
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: REASON }, DEPS), ReferenceStateUnknownError);
  assert.deepEqual(await docsExist(truckId, locationId), { t: true, l: true, c: true });
});

await check("delete NOT_FOUND for a nonexistent truck", async () => {
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId: uid("GHOST"), expectedVersion: 1, deletionReason: REASON }, CLEAR), TruckNotFoundError);
});

await check("delete BLOCKED: mismatched claim -> CLAIM_INTEGRITY, no partial delete", async () => {
  const { truckId, locationId } = await makeTruck();
  await db.collection("location_truck_claims").doc(locationId).set({ locationId, truckId: "SOMEONE-ELSE", version: 1, createdAt: admin.firestore.Timestamp.now(), createdBy: admin1 });
  await assert.rejects(deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR), ClaimIntegrityError);
  assert.equal((await db.collection("trucks").doc(truckId).get()).exists, true);
});

await check("delete AUTHZ commit-time: admin role REVOKED mid-transaction -> denied, nothing deleted, no applied tombstone", async () => {
  const { truckId, locationId } = await makeTruck();
  const raceAdmin = await seedActor("admin"); // fresh admin so revoking it is isolated
  // A SEPARATE Firestore connection performs the concurrent revocation (a genuinely independent
  // writer -- not the transaction's own stream), so it conflicts the txn's read set of
  // users/{raceAdmin} instead of corrupting the in-flight transaction.
  const writerApp = admin.apps.find((a) => a && a.name === "concurrent-writer") || admin.initializeApp({ projectId: "taylor-parts" }, "concurrent-writer");
  const db2 = writerApp.firestore();
  let revokedOnce = false;
  const deps = {
    ...CLEAR,
    // After the in-txn admin read passes (attempt 1), revoke the role via the OTHER connection. This
    // conflicts the transaction's read set -> Firestore retries -> attempt 2 re-reads the now-
    // technician role and throws UnauthorizedActorError before any write commits.
    __afterAuthReadHook: async () => {
      if (!revokedOnce) { revokedOnce = true; await db2.collection("users").doc(raceAdmin).set({ role: "technician" }); }
    },
  };
  // The concurrent revocation conflicts the transaction's read set, so the deletion NEVER commits.
  // (Real Firestore retries -> the retried txn re-reads the now-technician role -> UnauthorizedActor
  // Error; the emulator aborts the conflicted transaction with a non-retryable error. Both outcomes
  // guarantee the safety property here: no stale-authorized deletion commits. The SANITIZED
  // UnauthorizedActorError itself is proven by the entry-time non-admin tests above.)
  await assert.rejects(deleteTruckCreatedInError({ actorUid: raceAdmin, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: REASON }, deps));
  // truck + MOBILE location + claim all remain; no APPLIED deletion tombstone was written.
  assert.deepEqual(await docsExist(truckId, locationId), { t: true, l: true, c: true });
  const audits = await db.collection("auditEvents").where("actorUid", "==", raceAdmin).where("targetId", "==", truckId).get();
  const applied = audits.docs.map((d) => d.data()).filter((a) => a.action === "deleteTruckCreatedInError" && a.outcome === "applied");
  assert.equal(applied.length, 0, "no applied deletion tombstone");
});

await check("delete AUTHZ before replay: a SAME actor who loses admin cannot execute an idempotent replay", async () => {
  // A fresh admin deletes a truck (its per-actor tombstone would make a same-key retry a REPLAY).
  // After the role is revoked, the SAME actor retries the SAME key -> the in-txn admin read (which
  // runs BEFORE checkIdempotency) denies it, so the former admin never receives/executes the replay.
  const { truckId } = await makeTruck();
  const exAdmin = await seedActor("admin");
  const k = key("del");
  await deleteTruckCreatedInError({ actorUid: exAdmin, idempotencyKey: k, truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR);
  await db.collection("users").doc(exAdmin).set({ role: "technician" }); // revoke admin
  await assert.rejects(
    deleteTruckCreatedInError({ actorUid: exAdmin, idempotencyKey: k, truckId, expectedVersion: 1, deletionReason: REASON }, CLEAR),
    UnauthorizedActorError,
  );
});

await check("delete ATOMIC ROLLBACK: failure after stage -> nothing deleted, no tombstone", async () => {
  const { truckId, locationId } = await makeTruck();
  await assert.rejects(
    deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: 1, deletionReason: REASON }, { ...CLEAR, __simulateFailureAfterStage: new Error("boom") }),
    /boom/,
  );
  assert.deepEqual(await docsExist(truckId, locationId), { t: true, l: true, c: true });
  const audits = await db.collection("auditEvents").where("actorUid", "==", admin1).where("targetId", "==", truckId).get();
  assert.equal(audits.docs.some((d) => d.data().action === "deleteTruckCreatedInError"), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
