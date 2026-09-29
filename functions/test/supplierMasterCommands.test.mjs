// Supplier Master (S2) -- trusted command tests. Conventions of partSupplierItems.test.mjs:
// Firestore emulator + the deps.roles/now seam; no production. Exercises capability gating,
// governed create (ACTIVE/v1/audit/normalizedKey), dedup DETECTION (flag-not-block), idempotency
// (replay / conflict / abort-atomicity), versioned update, ACTIVE<->INACTIVE status transitions,
// and serialization integrity (malformed surfaced; no forbidden fields).
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, FROZEN/INACTIVE). createSupplier / updateSupplier /
// activateSupplier / deactivateSupplier are legacy Firestore catalog writers and are FROZEN: each refuses FIRST with
// FirestoreCatalogWriterClosedError (FIRESTORE_CATALOG_WRITER_FROZEN) -- before id/name validation, before capability
// resolution, before the transaction. So:
//   A. the superseded WRITER contract (governed create, capability gating at the writer, replay/conflict/atomicity,
//      versioned update, status transitions) asserts the governed refusal carrying the writer's own id AND that
//      nothing was written: no supplier document (or an existing one byte-for-byte unchanged), and no audit event --
//      which is also this machinery's idempotency record.
//   B. still-valid domain proof moves to the existing lower boundary: normalizeSupplierName (the dedup key),
//      validateGovernedSupplier (id pattern, blank optionals, forbidden `active`), the repository's dedup-DETECTION
//      read (findActiveByNormalizedKey) and the stored-shape adapters, over suppliers seeded DIRECTLY in exactly the
//      shape the frozen writer staged (supplierToFirestore).
// Nothing here reopens a writer or replaces the guard.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { createSupplier, updateSupplier, activateSupplier, deactivateSupplier } =
  await import("../lib/supplierMaster/supplierMasterCommands.js");
const { supplierFromFirestore, supplierToFirestore, buildFirestoreSupplierRepository } =
  await import("../lib/supplierMaster/supplierMasterRepository.js");
const { normalizeSupplierName, validateGovernedSupplier } = await import("../lib/supplierMaster/supplierMasterValidation.js");
const { FirestoreCatalogWriterClosedError } = await import("../lib/catalogMaster/catalogWriterState.js");
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

// ---- freeze helpers (ruling A) ----
const frozen = (writer) => (err) => {
  assert.ok(err instanceof FirestoreCatalogWriterClosedError, `expected the governed freeze refusal, got ${err?.name}: ${err?.message}`);
  assert.equal(err.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
  assert.equal(err.writer, writer);
  return true;
};
async function assertNothingWritten(id) {
  assert.equal((await db.collection("suppliers").doc(id).get()).exists, false, `suppliers/${id} must not exist`);
  assert.equal((await audits(id)).size, 0, "no audit / idempotency record");
}
async function assertUnchanged(id, before) {
  assert.deepEqual(await read(id), before, `suppliers/${id} must be byte-for-byte unchanged`);
  assert.equal((await audits(id)).size, 0, "no audit / idempotency record");
}
// ---- stored-shape fixture (ruling B): exactly what createSupplier / changeSupplierStatus staged ----
const AT = admin.firestore.Timestamp.fromDate(DEPS.now());
async function seedSupplier(id, name, { status = "ACTIVE", version = 1, ...optionals } = {}) {
  await db.collection("suppliers").doc(id).set(supplierToFirestore({
    id, name, normalizedKey: normalizeSupplierName(name), status, version,
    createdAt: AT, createdBy: granted, updatedAt: AT, updatedBy: granted, ...optionals,
  }));
  return read(id);
}

await check("create: authorized -> FROZEN, no supplier, no audit; the dedup key it would persist is normalizeSupplierName", async () => {
  const id = sid("SUP");
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id, name: "Acme Supply", vendorNumber: "V-100", email: "a@acme.test" }, DEPS), frozen("supplier.create"));
  await assertNothingWritten(id);
  assert.equal(normalizeSupplierName("Acme Supply"), "acme supply");
});
await check("create: manage-only actor -> FROZEN (the guard precedes capability resolution), nothing written", async () => {
  const id = sid("SUP");
  await assert.rejects(createSupplier({ actorUid: manageOnly, idempotencyKey: key("c"), supplierId: id, name: "Managed Vendor" }, DEPS), frozen("supplier.create"));
  await assertNothingWritten(id);
});
await check("create: every input (unauthorized/bad id/blank name/blank optional/empty-normalized/dup) -> FROZEN; the rules live in the pure validators", async () => {
  const id = sid("SUP");
  const cases = [
    { actorUid: ungranted, supplierId: id, name: "X" },
    { actorUid: granted, supplierId: "bad id!", name: "X" },
    { actorUid: granted, supplierId: sid("SUP"), name: "   " },
    { actorUid: granted, supplierId: sid("SUP"), name: "!!!" },
    { actorUid: granted, supplierId: sid("SUP"), name: "Ok", email: "  " },
  ];
  for (const c of cases) {
    await assert.rejects(createSupplier({ idempotencyKey: key("c"), ...c }, DEPS), frozen("supplier.create"));
    if (c.supplierId !== "bad id!") await assertNothingWritten(c.supplierId);
  }
  // Ruling B: the same rules at the governed stored-record boundary.
  assert.equal(normalizeSupplierName("   "), "");
  assert.equal(normalizeSupplierName("!!!"), ""); // normalizes to "" -- no usable content
  const ok = { id: "SUP_OK", name: "Ok", normalizedKey: "ok", status: "ACTIVE", version: 1, createdAt: AT, createdBy: "t", updatedAt: AT, updatedBy: "t" };
  assert.equal(validateGovernedSupplier(ok, "SUP_OK").valid, true);
  assert.equal(validateGovernedSupplier({ ...ok, id: "bad id!" }, "bad id!").valid, false);
  assert.equal(validateGovernedSupplier({ ...ok, email: "  " }, "SUP_OK").valid, false);
  // A create over an existing supplier is refused the same way and never touches it.
  const existing = sid("SUP");
  const before = await seedSupplier(existing, "First");
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c2"), supplierId: existing, name: "Second" }, DEPS), frozen("supplier.create"));
  await assertUnchanged(existing, before);
});
await check("dedup DETECTION (repository read): same normalized name flags ACTIVE neighbours only; the writer is FROZEN", async () => {
  const a = sid("SUP"), b = sid("SUP"), c = sid("SUP");
  await seedSupplier(a, "Globex Corp");
  await seedSupplier(b, "globex   corp"); // same key: the governed create still created it (flag, not block)
  const repo = buildFirestoreSupplierRepository(db);
  const flagged = async (name, excludeId) => (await db.runTransaction((txn) => repo.findActiveByNormalizedKey(txn, normalizeSupplierName(name), excludeId))).map((s) => s.id).sort();
  assert.deepEqual(await flagged("globex   corp", b), [a]);
  // A deactivated (INACTIVE v2) neighbour is no longer flagged; the ACTIVE one still is.
  await seedSupplier(a, "Globex Corp", { status: "INACTIVE", version: 2 });
  assert.deepEqual(await flagged("GLOBEX CORP", c), [b]);
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: c, name: "GLOBEX CORP" }, DEPS), frozen("supplier.create"));
  await assertNothingWritten(c);
});
await check("idempotency: same-key retry / conflicting retry / abort-after-stage -> FROZEN every time, nothing recorded", async () => {
  const id = sid("SUP");
  const k = key("c");
  for (const name of ["Replay Co", "Replay Co", "Different Name"]) {
    await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: k, supplierId: id, name }, DEPS), frozen("supplier.create"));
  }
  await assertNothingWritten(id);
  const id2 = sid("SUP");
  await assert.rejects(createSupplier({ actorUid: granted, idempotencyKey: key("c"), supplierId: id2, name: "Boom Co" }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }), frozen("supplier.create"));
  await assertNothingWritten(id2);
});
await check("update: every change (stale/empty/status/blank/valid) -> FROZEN; the stored supplier is unchanged", async () => {
  const id = sid("SUP");
  const before = await seedSupplier(id, "Initech");
  for (const [expectedVersion, changes] of [[9, { name: "X" }], [1, {}], [1, { status: "INACTIVE" }], [1, { name: "  " }], [1, { name: "Initech Global", phone: "555-1000" }]]) {
    await assert.rejects(updateSupplier({ actorUid: granted, idempotencyKey: key("u"), supplierId: id, expectedVersion, changes }, DEPS), frozen("supplier.update"));
  }
  await assertUnchanged(id, before);
  assert.equal(normalizeSupplierName("Initech Global"), "initech global"); // the key a rename would recompute
});
await check("status: activate/deactivate (any actor, any version, missing supplier) -> FROZEN; stored status unchanged", async () => {
  const id = sid("SUP");
  const before = await seedSupplier(id, "Umbrella");
  await assert.rejects(deactivateSupplier({ actorUid: manageOnly, idempotencyKey: key("d"), supplierId: id, expectedVersion: 1 }, DEPS), frozen("supplier.deactivate"));
  await assert.rejects(activateSupplier({ actorUid: granted, idempotencyKey: key("a"), supplierId: id, expectedVersion: 1 }, DEPS), frozen("supplier.activate"));
  await assert.rejects(deactivateSupplier({ actorUid: granted, idempotencyKey: key("d"), supplierId: id, expectedVersion: 1 }, DEPS), frozen("supplier.deactivate"));
  await assertUnchanged(id, before);
  assert.equal(before.status, "ACTIVE");
  const missing = sid("SUP");
  await assert.rejects(deactivateSupplier({ actorUid: granted, idempotencyKey: key("d"), supplierId: missing, expectedVersion: 1 }, DEPS), frozen("supplier.deactivate"));
  await assertNothingWritten(missing);
});
await check("serialization: round trip; malformed surfaced (id binding / status / forbidden active / version)", async () => {
  const id = sid("SUP");
  await seedSupplier(id, "Wayne Ent", { notes: "vip" });
  const snap = await db.collection("suppliers").doc(id).get();
  assert.ok(!("active" in snap.data())); // governed pattern forbids the legacy boolean
  const stored = supplierFromFirestore(snap.id, snap.data());
  assert.equal(stored.id, id);
  assert.equal(stored.notes, "vip");
  assert.equal(stored.normalizedKey, "wayne ent");
  assert.throws(() => supplierFromFirestore("WRONG-ID", snap.data()), MalformedStoredRecordError);
  assert.throws(() => supplierFromFirestore(snap.id, { ...snap.data(), status: "GONE" }), MalformedStoredRecordError);
  assert.throws(() => supplierFromFirestore(snap.id, { ...snap.data(), active: true }), MalformedStoredRecordError);
  assert.throws(() => supplierFromFirestore(snap.id, { ...snap.data(), version: 0 }), MalformedStoredRecordError);
  const doc = supplierToFirestore(stored);
  for (const k of ["active", "onHand", "tenantId", "companyId"]) assert.ok(!(k in doc), k);
});

console.log(`\nsupplierMasterCommands: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
