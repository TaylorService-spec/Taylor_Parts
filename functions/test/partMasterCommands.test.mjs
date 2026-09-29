// INV-1 Phase 1 PR 1.2 -- trusted Part Master repository/service tests.
// Same conventions as savedDefinitionCommands.test.mjs: Firestore emulator
// required (127.0.0.1:8080), capabilities granted ONLY via the service's
// test-only `deps.roles` seam + emulator roleAssignments fixtures; never
// touches production or the frozen role catalogs.
// Prerequisite: npm run build; emulator running.
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, CATALOG_WRITER_AUTHORITY = FROZEN/INACTIVE). Every
// command in this file -- createPart / updatePart / changePartStatus / createManufacturer / updateManufacturer /
// changeManufacturerStatus -- is a legacy Firestore catalog writer and is FROZEN: its first statement refuses with
// FirestoreCatalogWriterClosedError (FIRESTORE_CATALOG_WRITER_FROZEN), before capability resolution. So:
//   A. the superseded WRITER contract (create/update/status/replay/version/capability-at-the-writer) now asserts
//      the governed refusal carrying the writer's own id AND that nothing was written: no document, no changed
//      document, no audit event -- which is also this machinery's idempotency record (the audit under a
//      deterministic id IS the "already applied" record), and no "denied" audit either (the guard precedes the
//      capability check that used to write one).
//   B. still-valid domain proof moves to the existing lower boundary: the stored-shape adapters
//      (partToFirestore/partFromFirestore, manufacturerToFirestore/manufacturerFromFirestore) over documents
//      seeded DIRECTLY in exactly the shape the frozen writer staged, validatePart, and PART_STATUS_TRANSITIONS.
// Nothing here reopens a writer or replaces the guard.
import "./support/firebaseEmulatorGuard.cjs"; // FIRST: Firebase test-safety guard (emulator mode) -- see test/support/firebaseTestGuard.cjs
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "demo-eos-test" });
const db = admin.firestore();

const {
  createPart, updatePart, changePartStatus,
  createManufacturer, updateManufacturer, changeManufacturerStatus,
  PART_STATUS_TRANSITIONS,
} = await import("../lib/partMaster/partMasterCommands.js");
const { partToFirestore, partFromFirestore, manufacturerToFirestore, manufacturerFromFirestore, MalformedStoredRecordError } =
  await import("../lib/partMaster/partMasterRepository.js");
const { validatePart } = await import("../lib/partMaster/validation.js");
const { FirestoreCatalogWriterClosedError } = await import("../lib/catalogMaster/catalogWriterState.js");
const { Timestamp } = admin.firestore;

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

// ---- freeze helpers (ruling A) ----
const frozen = (writer) => (err) => {
  assert.ok(err instanceof FirestoreCatalogWriterClosedError, `expected the governed freeze refusal, got ${err?.name}: ${err?.message}`);
  assert.equal(err.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
  assert.equal(err.state, "FROZEN");
  assert.equal(err.writer, writer);
  return true;
};
const auditsFor = async (targetId) => (await db.collection("auditEvents").where("targetId", "==", targetId).get()).size;
const partDoc = async (id) => (await db.collection("parts").doc(id).get());
const mfrDoc = async (id) => (await db.collection("manufacturers").doc(id).get());
/** No document, and no audit / idempotency record of any outcome for the target. */
async function assertNothingWritten(collection, id) {
  assert.equal((await db.collection(collection).doc(id).get()).exists, false, `${collection}/${id} must not exist`);
  assert.equal(await auditsFor(id), 0, `no audit / idempotency record for ${id}`);
}
/** An existing record is byte-for-byte unchanged, and no audit / idempotency record was added for it. */
async function assertUnchanged(collection, id, before) {
  assert.deepEqual((await db.collection(collection).doc(id).get()).data(), before, `${collection}/${id} must be unchanged`);
  assert.equal(await auditsFor(id), 0, `no audit / idempotency record for ${id}`);
}

// ---- stored-shape fixtures (ruling B): EXACTLY what the frozen writers staged, through their own serializers ----
const AT = DEPS.now();
function storedPart(input, version = 1) {
  const v = validatePart(input);
  assert.equal(v.valid, true, `fixture must be a valid Part: ${JSON.stringify(v.errors)}`);
  return { part: v.value, version, createdAt: AT, createdBy: granted, updatedAt: AT, updatedBy: granted };
}
async function seedPart(input, version = 1) {
  const doc = partToFirestore(storedPart(input, version));
  await db.collection("parts").doc(input.partId).set(doc);
  return (await partDoc(input.partId)).data();
}
async function seedManufacturer(manufacturerId, name, status = "ACTIVE", version = 1) {
  await db.collection("manufacturers").doc(manufacturerId).set(manufacturerToFirestore({ manufacturer: { manufacturerId, name, status }, version, createdAt: AT, createdBy: granted, updatedAt: AT, updatedBy: granted }));
  return (await mfrDoc(manufacturerId)).data();
}

// ---- A. Serialization ----
// Ruling B: the adapters are the still-active read boundary (every Part/Manufacturer read parses through them).
await check("A1/A2 Part+Manufacturer round trip via adapters", async () => {
  const pid = uid("P");
  await seedPart(partInput(pid));
  const snap = await partDoc(pid);
  const stored = partFromFirestore(snap.id, snap.data());
  assert.equal(stored.part.partId, pid); assert.equal(stored.version, 1);
  assert.deepEqual(stored.part, storedPart(partInput(pid)).part);
  const mid = uid("MFR");
  await seedManufacturer(mid, "Acme  Corp");
  const msnap = await mfrDoc(mid);
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
// Ruling B: timestamp conversion of a STORED record, through the emulator round trip.
await check("A6 Firestore timestamp conversion", async () => {
  const pid = uid("P");
  const raw = await seedPart(partInput(pid));
  assert.ok(raw.createdAt instanceof Timestamp && raw.updatedAt instanceof Timestamp, "stored as Firestore Timestamps");
  const stored = partFromFirestore(pid, (await partDoc(pid)).data());
  assert.ok(stored.createdAt instanceof Date && stored.updatedAt instanceof Date);
  assert.equal(stored.createdAt.getTime(), AT.getTime());
});
await check("A8 forbidden authority fields never serialized", async () => {
  const doc = partToFirestore({ part: validatePart(partInput("P-SER-1")).value, version: 1, createdAt: new Date(0), createdBy: "t", updatedAt: new Date(0), updatedBy: "t" });
  for (const k of ["onHand", "reserved", "available", "supplierCost", "purchasePrice", "tenantId", "companyId", "aliases", "supplierItems"]) assert.ok(!(k in doc), k);
});

// ---- B. Create Part ----
// Ruling A: the legacy create is frozen -- no Part, no applied audit.
await check("B9/B13/B14/B15 authorized create: FROZEN, no doc, no audit", async () => {
  const pid = uid("P");
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS), frozen("part.create"));
  await assertNothingWritten("parts", pid);
});
// Ruling A: the guard precedes capability resolution, so an ungranted actor gets the SAME governed refusal and no
// "denied" audit is written (capability resolution itself is proven at the governed access boundary, not here).
await check("B10 unauthorized create: FROZEN before capability resolution, no doc, no denied audit", async () => {
  const pid = uid("P");
  await assert.rejects(createPart({ actorUid: ungranted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS), frozen("part.create"));
  await assertNothingWritten("parts", pid);
});
// Ruling B: the validation rule createPart applied lives in validatePart; ruling A: the frozen writer answers first.
await check("B11 invalid part rejected by validatePart; the frozen writer refuses before validating", async () => {
  const bad = partInput(uid("P"), { stockingUnit: "PALLET" });
  const v = validatePart(bad);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.path === "stockingUnit"), JSON.stringify(v.errors));
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: key("c"), part: bad }, DEPS), frozen("part.create"));
  await assertNothingWritten("parts", bad.partId);
});
// Ruling A: a create over an existing Part is refused as FROZEN; the stored Part is untouched.
await check("B12 create over an existing part: FROZEN, existing record unchanged", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: key("c2"), part: partInput(pid, { name: "Other" }) }, DEPS), frozen("part.create"));
  await assertUnchanged("parts", pid, before);
});
// Ruling A: a retry with the same key is refused the same way; no idempotency record is ever created.
await check("B16 same-key retry: FROZEN both times, no doc, no idempotency/audit record", async () => {
  const pid = uid("P");
  const k = key("c");
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(createPart({ actorUid: granted, idempotencyKey: k, part: partInput(pid) }, DEPS), frozen("part.create"));
  }
  await assertNothingWritten("parts", pid);
});
await check("B17 same key, different request: FROZEN, nothing recorded", async () => {
  const pid = uid("P");
  const k = key("c");
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: k, part: partInput(pid) }, DEPS), frozen("part.create"));
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: k, part: partInput(pid, { name: "Different" }) }, DEPS), frozen("part.create"));
  await assertNothingWritten("parts", pid);
});
// Ruling A: the refusal precedes the transaction entirely -- the atomicity seam is never reached.
await check("B18 FROZEN precedes the transaction: no partial state", async () => {
  const pid = uid("P");
  await assert.rejects(createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }), frozen("part.create"));
  await assertNothingWritten("parts", pid);
});

// ---- C. Update Part ----
// Ruling A throughout: updatePart is frozen; an existing (fixture) Part is never changed and no audit is written.
await check("C19/C24/C25 authorized update: FROZEN, stored part unchanged, no audit", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { name: "Renamed" } }, DEPS), frozen("part.update"));
  await assertUnchanged("parts", pid, before);
});
await check("C20 stale-version update: FROZEN, unchanged", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 99, changes: { name: "x" } }, DEPS), frozen("part.update"));
  await assertUnchanged("parts", pid, before);
});
await check("C21/C22 partId + forbidden field mutation: FROZEN for every change, unchanged", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  for (const bad of [{ partId: "P-NEW" }, { version: 9 }, { createdBy: "x" }, { status: "ACTIVE" }, { onHand: 5 }]) {
    await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: bad }, DEPS), frozen("part.update"));
  }
  await assertUnchanged("parts", pid, before);
});
await check("C23 internalPartNumber change: FROZEN, canonical record unchanged", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { internalPartNumber: "NEW-NUMBER-1" } }, DEPS), frozen("part.update"));
  await assertUnchanged("parts", pid, before);
});
await check("C26 same-key update retry: FROZEN both times, version never moves", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  const k = key("u");
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: k, partId: pid, expectedVersion: 1, changes: { name: "Once" } }, DEPS), frozen("part.update"));
  }
  await assertUnchanged("parts", pid, before);
});

// ---- D. Part status ----
// Ruling B: the transition matrix is the pure PART_STATUS_TRANSITIONS; ruling A: changePartStatus is frozen.
await check("D27/D30 allowed transition in the matrix; matrix shape; the frozen writer changes nothing", async () => {
  assert.ok(PART_STATUS_TRANSITIONS.DRAFT.includes("ACTIVE"));
  assert.deepEqual(PART_STATUS_TRANSITIONS.DISCONTINUED, []); // terminal
  assert.deepEqual(PART_STATUS_TRANSITIONS.SUPERSEDED, []); // terminal
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(changePartStatus({ actorUid: granted, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS), frozen("part.changeStatus"));
  await assertUnchanged("parts", pid, before);
});
await check("D28 invalid transition absent from the matrix (DRAFT->DISCONTINUED, terminal exit); writer FROZEN", async () => {
  assert.equal(PART_STATUS_TRANSITIONS.DRAFT.includes("DISCONTINUED"), false);
  for (const terminal of ["DISCONTINUED", "SUPERSEDED"]) assert.equal(PART_STATUS_TRANSITIONS[terminal].length, 0);
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(changePartStatus({ actorUid: granted, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "DISCONTINUED" }, DEPS), frozen("part.changeStatus"));
  await assertUnchanged("parts", pid, before);
});
await check("D29 stale status transition: FROZEN, unchanged", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(changePartStatus({ actorUid: granted, idempotencyKey: key("s"), partId: pid, expectedVersion: 5, newStatus: "ACTIVE" }, DEPS), frozen("part.changeStatus"));
  await assertUnchanged("parts", pid, before);
});
await check("D31 SUPERSEDED reachable in the matrix (ACTIVE/INACTIVE -> SUPERSEDED); writer FROZEN", async () => {
  assert.ok(PART_STATUS_TRANSITIONS.ACTIVE.includes("SUPERSEDED"));
  assert.ok(PART_STATUS_TRANSITIONS.INACTIVE.includes("SUPERSEDED"));
  const pid = uid("P");
  const before = await seedPart(partInput(pid, { status: "ACTIVE" }), 2);
  await assert.rejects(changePartStatus({ actorUid: granted, idempotencyKey: key("s2"), partId: pid, expectedVersion: 2, newStatus: "SUPERSEDED" }, DEPS), frozen("part.changeStatus"));
  await assertUnchanged("parts", pid, before);
});

// ---- E. Manufacturer ----
// Ruling A: every manufacturer writer is frozen (the name normalization it persisted is proven in A1/A2 via the adapter).
await check("E32-E40 manufacturer lifecycle: create/update/status all FROZEN; nothing written or changed", async () => {
  const mid = uid("MFR");
  const k = key("m");
  for (const actor of [ungranted, granted, granted]) {
    await assert.rejects(createManufacturer({ actorUid: actor, idempotencyKey: k, manufacturerId: mid, name: "Acme" }, DEPS), frozen("manufacturer.create"));
  }
  await assertNothingWritten("manufacturers", mid);
  const existing = uid("MFR");
  const before = await seedManufacturer(existing, "Acme");
  await assert.rejects(createManufacturer({ actorUid: granted, idempotencyKey: key("m2"), manufacturerId: existing, name: "Acme" }, DEPS), frozen("manufacturer.create"));
  await assert.rejects(updateManufacturer({ actorUid: granted, idempotencyKey: key("m3"), manufacturerId: existing, expectedVersion: 9, name: "B" }, DEPS), frozen("manufacturer.update"));
  await assert.rejects(updateManufacturer({ actorUid: granted, idempotencyKey: key("m4"), manufacturerId: existing, expectedVersion: 1, name: "Acme Industries" }, DEPS), frozen("manufacturer.update"));
  await assert.rejects(changeManufacturerStatus({ actorUid: granted, idempotencyKey: key("m5"), manufacturerId: existing, expectedVersion: 1, newStatus: "INACTIVE" }, DEPS), frozen("manufacturer.changeStatus"));
  await assertUnchanged("manufacturers", existing, before);
});

// ---- F. Capability / security ----
// Ruling A: the freeze is the first statement, so it answers identically for a granted, ungranted, empty or revoked
// actor -- no capability is resolved and no denied audit is written. Capability RESOLUTION for inventory.catalog.*
// remains proven at the governed access boundary (resolveEffectivePermission / effective-access tests).
await check("F41-F44 FROZEN precedes capability resolution for every actor (granted/ungranted/empty/revoked)", async () => {
  const pid = uid("P");
  const revoked = await seedActor("pmFull");
  const asg = await db.collection("roleAssignments").where("principalUid", "==", revoked).get();
  await asg.docs[0].ref.set({ status: "revoked" }, { merge: true });
  for (const actorUid of [granted, ungranted, "", revoked]) {
    await assert.rejects(createPart({ actorUid, idempotencyKey: key("c"), part: partInput(pid) }, DEPS), frozen("part.create"));
  }
  await assertNothingWritten("parts", pid);
});
await check("F45/F46 tenant + foreign-authority field updates: FROZEN, unchanged", async () => {
  const pid = uid("P");
  const before = await seedPart(partInput(pid));
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { tenantId: "t1" } }, DEPS), frozen("part.update"));
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { supplierCost: 5 } }, DEPS), frozen("part.update"));
  await assertUnchanged("parts", pid, before);
  // The forbidden fields cannot enter the stored shape at all (the serializer's allow-list, A8).
  for (const k of ["tenantId", "supplierCost"]) assert.ok(!(k in before), k);
});

console.log(`\npartMasterCommands: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
