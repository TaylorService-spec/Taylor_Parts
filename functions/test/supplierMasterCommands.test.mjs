// Supplier Master (S2) -- trusted command tests. Conventions of partSupplierItems.test.mjs:
// Firestore emulator + the deps.roles/now seam; no production. Exercises capability gating,
// governed create (ACTIVE/v1/audit/normalizedKey), dedup DETECTION (flag-not-block), idempotency
// (replay / conflict / abort-atomicity), versioned update, ACTIVE<->INACTIVE status transitions,
// and serialization integrity (malformed surfaced; no forbidden fields).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { InvalidInputError, UnauthorizedActorError, NotFoundError, AlreadyExistsError, VersionConflictError, IdempotencyConflictError, InvalidStatusTransitionError } =
  await import("../lib/partMaster/partMasterCommands.js");
const { createSupplier, updateSupplier, activateSupplier, deactivateSupplier } =
  await import("../lib/supplierMaster/supplierMasterCommands.js");
const { supplierFromFirestore, supplierToFirestore } =
  await import("../lib/supplierMaster/supplierMasterRepository.js");
const { MalformedStoredRecordError } = await import("../lib/partMaster/partMasterRepository.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const sid = (p) => `${p}_${now}_${(seq += 1)}`; // [A-Za-z0-9_-]{1,64}
const TEST_ROLES = Object.freeze({
  noGrant: { id: "noGrant", name: "x", description: "x", permissions: [] },
  manageOnly: { id: "manageOnly", name: "x", description: "x", permissions: ["inventory.catalog.manage"] },
  full: { id: "full", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] },
});
async function seedActor(roleId) {
  const actorUid = uid("actor");
  await db.collection("users").doc(actorUid).set({ accessVersion: 1 });
  const id = uid("assignment");
  await db.collection("roleAssignments").doc(id).set({ id, principalUid: actorUid, roleId, scope: { type: "global" }, grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1 });
  return actorUid;
}
const DEPS = { roles: TEST_ROLES, now: () => new Date(1750000000000) };
const granted = await seedActor("full");
const manageOnly = await seedActor("manageOnly");
const ungranted = await seedActor("noGrant");
const read = async (id) => (await db.collection("suppliers").doc(id).get()).data();
const audits = async (id) => (await db.collection("auditEvents").where("targetId", "==", id).get());

console.log("supplierMasterCommands.test.mjs");

await check("create: authorized -> ACTIVE/v1, normalizedKey + optionals persisted, single audit, no dup flag", async () => {
  const id = sid("SUP");
  const r = await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id, name: "Acme Supply", vendorNumber: "V-100", email: "a@acme.test" }, DEPS);
  assert.equal(r.outcome, "applied");
  assert.equal(r.version, 1);
  assert.equal(r.supplierId, id);
  assert.deepEqual(r.suspectedDuplicateOf, []);
  const doc = await read(id);
  assert.equal(doc.status, "ACTIVE");
  assert.equal(doc.normalizedKey, "acme supply");
  assert.equal(doc.vendorNumber, "V-100");
  assert.equal(doc.email, "a@acme.test");
  assert.equal(doc.version, 1);
  assert.ok(!("active" in doc)); // governed pattern forbids the legacy boolean
  assert.equal((await audits(id)).size, 1);
});
await check("create: manage capability alone suffices (activate not required to create)", async () => {
  const id = sid("SUP");
  const r = await createSupplier({ actorUid: manageOnly, idempotencyKey: key("c"), supplierId: id, name: "Managed Vendor" }, DEPS);
  assert.equal(r.version, 1);
});
await check("create: unauthorized/bad id/blank name/blank optional/empty-normalized all rejected; dup id conflicts", async () => {
  const id = sid("SUP");
  await assert.rejects(createSupplier({ actorUid: ungranted, idempotencyKey: key("c"), supplierId: id, name: "X" }, DEPS), UnauthorizedActorError);
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: "bad id!", name: "X" }, DEPS), InvalidInputError);
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: sid("SUP"), name: "   " }, DEPS), InvalidInputError);
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: sid("SUP"), name: "!!!" }, DEPS), InvalidInputError); // normalizes to ""
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: sid("SUP"), name: "Ok", email: "  " }, DEPS), InvalidInputError);
  await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id, name: "First" }, DEPS);
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c2"), supplierId: id, name: "Second" }, DEPS), AlreadyExistsError);
});
await check("dedup DETECTION: same normalized name flags (not blocks); INACTIVE neighbor not flagged", async () => {
  const a = sid("SUP"), b = sid("SUP"), c = sid("SUP");
  await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: a, name: "Globex Corp" }, DEPS);
  const rb = await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: b, name: "globex   corp" }, DEPS); // same key, still created
  assert.equal(rb.version, 1);
  assert.deepEqual(rb.suspectedDuplicateOf, [a]);
  // deactivate A; a third same-key create should no longer flag the now-INACTIVE A (but flags B).
  await deactivateSupplier({ actorUid: granted, idempotencyKey: key("d"), supplierId: a, expectedVersion: 1 }, DEPS);
  const rc = await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: c, name: "GLOBEX CORP" }, DEPS);
  assert.deepEqual(rc.suspectedDuplicateOf, [b]);
});
await check("idempotency: exact replay no dup; conflicting replay rejected; abort-after-stage leaves nothing", async () => {
  const id = sid("SUP");
  const k = key("c");
  const r1 = await createSupplier({ actorUid: granted, idempotencyKey: k, supplierId: id, name: "Replay Co" }, DEPS);
  const r2 = await createSupplier({ actorUid: granted, idempotencyKey: k, supplierId: id, name: "Replay Co" }, DEPS);
  assert.equal(r2.outcome, "replayed");
  assert.equal((await audits(id)).size, 1);
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: k, supplierId: id, name: "Different Name" }, DEPS), IdempotencyConflictError);
  const id2 = sid("SUP");
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id2, name: "Boom Co" }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }));
  assert.equal((await db.collection("suppliers").doc(id2).get()).exists, false);
});
await check("update: version/allowlist enforced; name change bumps version + recomputes normalizedKey", async () => {
  const id = sid("SUP");
  await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id, name: "Initech" }, DEPS);
  await assert.rejects(updateSupplier({ actorUid: granted, idempotencyKey: key("u"), supplierId: id, expectedVersion: 9, changes: { name: "X" } }, DEPS), VersionConflictError);
  await assert.rejects(updateSupplier({ actorUid: granted, idempotencyKey: key("u"), supplierId: id, expectedVersion: 1, changes: {} }, DEPS), InvalidInputError);
  await assert.rejects(updateSupplier({ actorUid: granted, idempotencyKey: key("u"), supplierId: id, expectedVersion: 1, changes: { status: "INACTIVE" } }, DEPS), InvalidInputError);
  await assert.rejects(updateSupplier({ actorUid: granted, idempotencyKey: key("u"), supplierId: id, expectedVersion: 1, changes: { name: "  " } }, DEPS), InvalidInputError);
  const u = await updateSupplier({ actorUid: granted, idempotencyKey: key("u"), supplierId: id, expectedVersion: 1, changes: { name: "Initech Global", phone: "555-1000" } }, DEPS);
  assert.equal(u.version, 2);
  const doc = await read(id);
  assert.equal(doc.name, "Initech Global");
  assert.equal(doc.normalizedKey, "initech global");
  assert.equal(doc.phone, "555-1000");
  assert.equal(doc.status, "ACTIVE"); // update never changes status
});
await check("status: activate needs activate-cap; ACTIVE<->INACTIVE versioned; same-status invalid; missing NotFound", async () => {
  const id = sid("SUP");
  await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id, name: "Umbrella" }, DEPS);
  await assert.rejects(deactivateSupplier({ actorUid: manageOnly, idempotencyKey: key("d"), supplierId: id, expectedVersion: 1 }, DEPS), UnauthorizedActorError);
  await assert.rejects(activateSupplier({ actorUid: granted, idempotencyKey: key("a"), supplierId: id, expectedVersion: 1 }, DEPS), InvalidStatusTransitionError); // already ACTIVE
  const d = await deactivateSupplier({ actorUid: granted, idempotencyKey: key("d"), supplierId: id, expectedVersion: 1 }, DEPS);
  assert.equal(d.version, 2);
  assert.equal((await read(id)).status, "INACTIVE");
  await assert.rejects(deactivateSupplier({ actorUid: granted, idempotencyKey: key("d"), supplierId: id, expectedVersion: 2 }, DEPS), InvalidStatusTransitionError); // already INACTIVE
  const a = await activateSupplier({ actorUid: granted, idempotencyKey: key("a"), supplierId: id, expectedVersion: 2 }, DEPS);
  assert.equal(a.version, 3);
  assert.equal((await read(id)).status, "ACTIVE");
  await assert.rejects(deactivateSupplier({ actorUid: granted, idempotencyKey: key("d"), supplierId: sid("SUP"), expectedVersion: 1 }, DEPS), NotFoundError);
});
await check("serialization: round trip; malformed surfaced (id binding / status / forbidden active / version)", async () => {
  const id = sid("SUP");
  await createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id, name: "Wayne Ent", notes: "vip" }, DEPS);
  const snap = await db.collection("suppliers").doc(id).get();
  const stored = supplierFromFirestore(snap.id, snap.data());
  assert.equal(stored.id, id);
  assert.equal(stored.notes, "vip");
  assert.throws(() => supplierFromFirestore("WRONG-ID", snap.data()), MalformedStoredRecordError);
  assert.throws(() => supplierFromFirestore(snap.id, { ...snap.data(), status: "GONE" }), MalformedStoredRecordError);
  assert.throws(() => supplierFromFirestore(snap.id, { ...snap.data(), active: true }), MalformedStoredRecordError);
  assert.throws(() => supplierFromFirestore(snap.id, { ...snap.data(), version: 0 }), MalformedStoredRecordError);
  const doc = supplierToFirestore(stored);
  for (const k of ["active", "onHand", "tenantId", "companyId"]) assert.ok(!(k in doc), k);
});

console.log(`\nsupplierMasterCommands: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
