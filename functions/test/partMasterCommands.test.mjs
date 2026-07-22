// INV-1 Phase 1 PR 1.2 -- trusted Part Master repository/service tests.
// Same conventions as savedDefinitionCommands.test.mjs: Firestore emulator
// required (127.0.0.1:8080), capabilities granted ONLY via the service's
// test-only `deps.roles` seam + emulator roleAssignments fixtures; never
// touches production or the frozen role catalogs.
// Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const {
  createPart, updatePart, changePartStatus,
  createManufacturer, updateManufacturer, changeManufacturerStatus,
  InvalidInputError, UnauthorizedActorError, NotFoundError, AlreadyExistsError,
  VersionConflictError, IdempotencyConflictError, InvalidStatusTransitionError,
  PART_STATUS_TRANSITIONS,
} = await import("../lib/partMaster/partMasterCommands.js");
const { partToFirestore, partFromFirestore, manufacturerFromFirestore, MalformedStoredRecordError } =
  await import("../lib/partMaster/partMasterRepository.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;

const TEST_ROLES = Object.freeze({
  noGrant: { id: "noGrant", name: "x", description: "x", permissions: [] },
  pmFull: { id: "pmFull", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] },
});
async function seedActor(roleId) {
  const actorUid = uid("actor");
  await db.collection("users").doc(actorUid).set({ accessVersion: 1 });
  const id = uid("assignment");
  await db.collection("roleAssignments").doc(id).set({
    id, principalUid: actorUid, roleId, scope: { type: "global" },
    grantedBy: "test-fixture", grantedAt: admin.firestore.Timestamp.now(),
    status: "active", accessVersionAtGrant: 1,
  });
  return actorUid;
}
const DEPS = { roles: TEST_ROLES, now: () => new Date(1750000000000) };
const partInput = (partId, extra = {}) => ({
  partId, internalPartNumber: partId, name: "Test Part", status: "DRAFT",
  stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", ...extra,
});

const granted = await seedActor("pmFull");
const ungranted = await seedActor("noGrant");

// ---- A. Serialization ----
await check("A1/A2 Part+Manufacturer round trip via adapters", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  const snap = await db.collection("parts").doc(pid).get();
  const stored = partFromFirestore(snap.id, snap.data());
  assert.equal(stored.part.partId, pid); assert.equal(stored.version, 1);
  const mid = uid("MFR");
  await createManufacturer({ actorUid: granted, idempotencyKey: key("m"), manufacturerId: mid, name: "Acme  Corp" }, DEPS);
  const msnap = await db.collection("manufacturers").doc(mid).get();
  const m = manufacturerFromFirestore(msnap.id, msnap.data());
  assert.equal(m.manufacturer.name, "Acme  Corp");
  assert.equal(msnap.data().normalizedName, "ACME CORP");
});
await check("A3 doc ID/data mismatch rejected", () => {
  assert.throws(() => partFromFirestore("OTHER", { partId: "P-X" }), MalformedStoredRecordError);
});
await check("A4/A5/A7 malformed stored records rejected (bad enum, missing meta)", async () => {
  assert.throws(() => partFromFirestore("P-BAD", { partId: "P-BAD", internalPartNumber: "P-BAD", name: "x", status: "NOPE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" }), MalformedStoredRecordError);
  assert.throws(() => manufacturerFromFirestore("M-BAD", { manufacturerId: "M-BAD", name: "x", status: "GONE" }), MalformedStoredRecordError);
});
await check("A6 Firestore timestamp conversion", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  const stored = partFromFirestore(pid, (await db.collection("parts").doc(pid).get()).data());
  assert.ok(stored.createdAt instanceof Date && stored.updatedAt instanceof Date);
});
await check("A8 forbidden authority fields never serialized", async () => {
  const doc = partToFirestore({ part: (await import("../lib/partMaster/validation.js")).validatePart(partInput("P-SER-1")).value, version: 1, createdAt: new Date(0), createdBy: "t", updatedAt: new Date(0), updatedBy: "t" });
  for (const k of ["onHand", "reserved", "available", "supplierCost", "purchasePrice", "tenantId", "companyId", "aliases", "supplierItems"]) assert.ok(!(k in doc), k);
});

// ---- B. Create Part ----
await check("B9/B13/B14/B15 authorized create: doc + version 1 + audit", async () => {
  const pid = uid("P");
  const r = await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  assert.deepEqual(r, { outcome: "applied", version: 1 });
  const snap = await db.collection("parts").doc(pid).get();
  assert.equal(snap.data().partId, pid);
  const audits = await db.collection("auditEvents").where("targetId", "==", pid).get();
  assert.equal(audits.size, 1);
  assert.equal(audits.docs[0].data().action, "createPart");
  assert.equal(audits.docs[0].data().actorUid, granted);
});
await check("B10 unauthorized create rejected + denied audit", async () => {
  const pid = uid("P");
  await assert.rejects(createPart({ actorUid: ungranted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS), UnauthorizedActorError);
  assert.equal((await db.collection("parts").doc(pid).get()).exists, false);
  const audits = await db.collection("auditEvents").where("targetId", "==", pid).get();
  assert.equal(audits.docs[0].data().outcome, "denied");
});
await check("B11 invalid part rejected", async () => {
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(uid("P"), { stockingUnit: "PALLET" }) }, DEPS), InvalidInputError);
});
await check("B12 duplicate part rejected", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: key("c2"), part: partInput(pid) }, DEPS), AlreadyExistsError);
});
await check("B16 exact replay idempotent (no dup mutation/audit, version stable)", async () => {
  const pid = uid("P");
  const k = key("c");
  await createPart({ actorUid: granted, idempotencyKey: k, part: partInput(pid) }, DEPS);
  const r2 = await createPart({ actorUid: granted, idempotencyKey: k, part: partInput(pid) }, DEPS);
  assert.deepEqual(r2, { outcome: "replayed", version: 1 });
  assert.equal((await db.collection("auditEvents").where("targetId", "==", pid).get()).size, 1);
});
await check("B17 same key, different request rejected", async () => {
  const pid = uid("P");
  const k = key("c");
  await createPart({ actorUid: granted, idempotencyKey: k, part: partInput(pid) }, DEPS);
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: k, part: partInput(pid, { name: "Different" }) }, DEPS), IdempotencyConflictError);
});
await check("B18 transaction failure leaves no partial state", async () => {
  const pid = uid("P");
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }));
  assert.equal((await db.collection("parts").doc(pid).get()).exists, false);
  assert.equal((await db.collection("auditEvents").where("targetId", "==", pid).get()).size, 0);
});

// ---- C. Update Part ----
await check("C19/C24/C25 authorized update: merged, version 2, audit summary", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  const r = await updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { name: "Renamed" } }, DEPS);
  assert.deepEqual(r, { outcome: "applied", version: 2 });
  const snap = await db.collection("parts").doc(pid).get();
  assert.equal(snap.data().name, "Renamed"); assert.equal(snap.data().version, 2);
  const audits = await db.collection("auditEvents").where("targetId", "==", pid).where("action", "==", "updatePart").get();
  assert.match(audits.docs[0].data().summary, /fields=\[name\]/);
});
await check("C20 stale version rejected", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 99, changes: { name: "x" } }, DEPS), VersionConflictError);
});
await check("C21/C22 partId + forbidden field mutation rejected", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  for (const bad of [{ partId: "P-NEW" }, { version: 9 }, { createdBy: "x" }, { status: "ACTIVE" }, { onHand: 5 }]) {
    await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: bad }, DEPS), InvalidInputError);
  }
});
await check("C23 internalPartNumber mutable under governance (audited; alias = PR 1.3 dependency)", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  const r = await updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { internalPartNumber: "NEW-NUMBER-1" } }, DEPS);
  assert.equal(r.version, 2);
  assert.equal((await db.collection("parts").doc(pid).get()).data().internalPartNumber, "NEW-NUMBER-1");
  assert.equal((await db.collection("parts").doc(pid).get()).data().partId, pid); // canonical identity preserved
});
await check("C26 replay does not increment version twice", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  const k = key("u");
  await updatePart({ actorUid: granted, idempotencyKey: k, partId: pid, expectedVersion: 1, changes: { name: "Once" } }, DEPS);
  const r2 = await updatePart({ actorUid: granted, idempotencyKey: k, partId: pid, expectedVersion: 1, changes: { name: "Once" } }, DEPS);
  assert.deepEqual(r2, { outcome: "replayed", version: 2 });
  assert.equal((await db.collection("parts").doc(pid).get()).data().version, 2);
});

// ---- D. Part status ----
await check("D27/D30 allowed transition + audit; matrix shape", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  const r = await changePartStatus({ actorUid: granted, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
  assert.equal(r.version, 2);
  assert.equal((await db.collection("parts").doc(pid).get()).data().status, "ACTIVE");
  assert.deepEqual(PART_STATUS_TRANSITIONS.DISCONTINUED, []); // terminal
  assert.deepEqual(PART_STATUS_TRANSITIONS.SUPERSEDED, []); // terminal
});
await check("D28 invalid transition rejected (DRAFT->DISCONTINUED, terminal exit)", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  await assert.rejects(changePartStatus({ actorUid: granted, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "DISCONTINUED" }, DEPS), InvalidStatusTransitionError);
});
await check("D29 stale status transition rejected", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  await assert.rejects(changePartStatus({ actorUid: granted, idempotencyKey: key("s"), partId: pid, expectedVersion: 5, newStatus: "ACTIVE" }, DEPS), VersionConflictError);
});
await check("D31 SUPERSEDED reachable; relationship record documented as PR 1.4 authority", async () => {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  await changePartStatus({ actorUid: granted, idempotencyKey: key("s1"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
  const r = await changePartStatus({ actorUid: granted, idempotencyKey: key("s2"), partId: pid, expectedVersion: 2, newStatus: "SUPERSEDED" }, DEPS);
  assert.equal(r.version, 3);
});

// ---- E. Manufacturer ----
await check("E32-E40 manufacturer lifecycle: create/dup/update/version/status/audit/replay", async () => {
  const mid = uid("MFR");
  await assert.rejects(createManufacturer({ actorUid: ungranted, idempotencyKey: key("m"), manufacturerId: mid, name: "A" }, DEPS), UnauthorizedActorError);
  const k = key("m");
  await createManufacturer({ actorUid: granted, idempotencyKey: k, manufacturerId: mid, name: "Acme" }, DEPS);
  assert.equal((await createManufacturer({ actorUid: granted, idempotencyKey: k, manufacturerId: mid, name: "Acme" }, DEPS)).outcome, "replayed");
  await assert.rejects(createManufacturer({ actorUid: granted, idempotencyKey: key("m2"), manufacturerId: mid, name: "Acme" }, DEPS), AlreadyExistsError);
  await assert.rejects(updateManufacturer({ actorUid: granted, idempotencyKey: key("m3"), manufacturerId: mid, expectedVersion: 9, name: "B" }, DEPS), VersionConflictError);
  await updateManufacturer({ actorUid: granted, idempotencyKey: key("m4"), manufacturerId: mid, expectedVersion: 1, name: "Acme Industries" }, DEPS);
  const r = await changeManufacturerStatus({ actorUid: granted, idempotencyKey: key("m5"), manufacturerId: mid, expectedVersion: 2, newStatus: "INACTIVE" }, DEPS);
  assert.equal(r.version, 3);
  await assert.rejects(changeManufacturerStatus({ actorUid: granted, idempotencyKey: key("m6"), manufacturerId: mid, expectedVersion: 3, newStatus: "INACTIVE" }, DEPS), InvalidStatusTransitionError);
  const audits = await db.collection("auditEvents").where("targetId", "==", mid).get();
  assert.equal(audits.size, 4); // create, update, statusChange, and NOT the replay
});

// ---- F. Capability / security ----
await check("F41-F44 capability enforcement (real resolver; roles never permissions)", async () => {
  const pid = uid("P");
  // granted actor allowed (F41) is proven throughout; raw role w/o capability:
  await assert.rejects(createPart({ actorUid: ungranted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS), UnauthorizedActorError);
  // empty/missing actor rejected before any read (F43):
  await assert.rejects(createPart({ actorUid: "", idempotencyKey: key("c"), part: partInput(pid) }, DEPS), InvalidInputError);
  // revoked assignment denies (F44):
  const revoked = await seedActor("pmFull");
  const asg = await db.collection("roleAssignments").where("principalUid", "==", revoked).get();
  await asg.docs[0].ref.set({ status: "revoked" }, { merge: true });
  await assert.rejects(createPart({ actorUid: revoked, idempotencyKey: key("c"), part: partInput(pid) }, DEPS), UnauthorizedActorError);
});
await check("F45/F46 tenant + foreign-authority fields rejected at domain boundary", async () => {
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: "TST-1001", expectedVersion: 1, changes: { tenantId: "t1" } }, DEPS), InvalidInputError);
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: "TST-1001", expectedVersion: 1, changes: { supplierCost: 5 } }, DEPS), InvalidInputError);
});

console.log(`\npartMasterCommands: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
