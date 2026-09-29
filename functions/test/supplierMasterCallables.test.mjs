// Supplier Master -- onCall adapter tests. Conventions of truckRegistryCallables.test.mjs / accessCommandCallables.test.js:
// invoke each v2 onCall via `.run(request)` (no HTTP layer), against the Firestore emulator, importing the
// compiled ../lib. Proves: unauthenticated rejection; non-object rejection; capability enforced INSIDE the
// command (no-capability actor -> permission-denied) against REAL governed roles; actorUid derived ONLY from
// request.auth.uid (never request.data); the sanitized error->HttpsError mapping; idempotency replay; and that
// activate/deactivate require the DISTINCT inventory.catalog.activate (a .manage-only actor is denied) -- which
// no standing role carries today, so they fail closed until a deferred protected grant.
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, FROZEN/INACTIVE). Every command these callables front
// (createSupplier / updateSupplier / activateSupplier / deactivateSupplier) is a FROZEN legacy Firestore catalog
// writer whose guard is its FIRST statement -- before capability resolution, by design. So at this boundary every
// authenticated, well-shaped call is now the governed refusal (ruling A): HttpsError failed-precondition, details.code
// FIRESTORE_CATALOG_WRITER_FROZEN, the ONE generic freeze message (identical whether or not the supplier exists, and
// carrying no supplier id/name/version), and nothing written -- no supplier document (or an existing one byte-for-byte
// unchanged), no audit event, which is also this machinery's idempotency record. The adapter-only behaviour that
// runs BEFORE the command (unauthenticated, non-object) is unchanged. Capability RESOLUTION for inventory.catalog.*
// stays proven at the governed access boundary (governedBusinessRoles.test.mjs via resolveEffectivePermission;
// trustedWriterCommands.test.mjs wiring via resolveEffectiveAccess); supplier validation stays proven in
// supplierMasterCommands.test.mjs through the pure validators. Nothing here reopens a writer or replaces the guard.
// Prerequisite: npm run build; Firestore emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const c = await import("../lib/supplierMaster/supplierMasterCallables.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const sid = (p) => `${p}_${now}_${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined });

// Seed an actor with a REAL governed role (allRoles() is what the callable's command resolves against).
// roleId null -> a signed-in user with no capability.
async function seedActor(roleId) {
  const u = uid("actor");
  await db.collection("users").doc(u).set({ accessVersion: 1 });
  if (roleId) {
    const id = uid("asg");
    await db.collection("roleAssignments").doc(id).set({ id, principalUid: u, roleId, scope: { type: "global" }, grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1 });
  }
  return u;
}
async function assertHttps(promise, expectedCode) {
  try { await promise; assert.fail(`expected HttpsError "${expectedCode}", none thrown`); }
  catch (err) { assert.equal(err.code, expectedCode, `expected "${expectedCode}", got "${err.code}": ${err.message}`); }
}

console.log("supplierMasterCallables.test.mjs");

const manage = await seedActor("inventoryCreateExecutor"); // carries inventory.catalog.manage ONLY
const noCap = await seedActor(null); // signed in, no capability

// ---- auth / shape ----
await check("unauthenticated create -> unauthenticated", async () => {
  await assertHttps(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId: sid("SUP"), name: "Acme" }, undefined)), "unauthenticated");
});
await check("non-object data -> invalid-argument", async () => {
  await assertHttps(c.createSupplierCallable.run(req("nope", manage)), "invalid-argument");
});
// ---- freeze assertions (ruling A) ----
const FROZEN_MESSAGE = "Supplier records are frozen for the catalog cutover.";
async function assertFrozen(promise, ...mustNotDisclose) {
  let err;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, "expected the governed freeze refusal, none thrown");
  assert.equal(err.code, "failed-precondition", `expected failed-precondition, got "${err.code}": ${err.message}`);
  assert.equal(err.details?.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
  assert.deepEqual(Object.keys(err.details), ["code"], "details carry the governed code only");
  assert.equal(err.message, FROZEN_MESSAGE);
  for (const v of mustNotDisclose) assert.ok(!err.message.includes(String(v)), `the refusal must not disclose ${v}`);
  return err;
}
const read = async (id) => (await db.collection("suppliers").doc(id).get());
const auditsFor = async (id) => (await db.collection("auditEvents").where("targetId", "==", id).get()).size;
async function assertNothingWritten(id) {
  assert.equal((await read(id)).exists, false, `suppliers/${id} must not exist`);
  assert.equal(await auditsFor(id), 0, "no audit / idempotency record");
}
async function assertUnchanged(id, before) {
  assert.deepEqual((await read(id)).data(), before, `suppliers/${id} must be byte-for-byte unchanged`);
  assert.equal(await auditsFor(id), 0, "no audit / idempotency record");
}
// A governed supplier in exactly the stored shape createSupplier staged (the real supplierToFirestore).
const { supplierToFirestore } = await import("../lib/supplierMaster/supplierMasterRepository.js");
const { normalizeSupplierName } = await import("../lib/supplierMaster/supplierMasterValidation.js");
const AT = admin.firestore.Timestamp.fromDate(new Date(1750000000000));
async function seedSupplier(id, name, extra = {}) {
  await db.collection("suppliers").doc(id).set(supplierToFirestore({ id, name, normalizedKey: normalizeSupplierName(name), status: "ACTIVE", version: 1, createdAt: AT, createdBy: manage, updatedAt: AT, updatedBy: manage, ...extra }));
  return (await read(id)).data();
}

// SPECIFIC RULING: the guard precedes capability resolution, so a no-capability actor gets the governed freeze
// refusal -- not permission-denied -- with no write and no disclosure.
await check("no-capability actor create -> failed-precondition FIRESTORE_CATALOG_WRITER_FROZEN, generic message, nothing written", async () => {
  const supplierId = sid("SUP");
  await assertFrozen(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId, name: "Acme" }, noCap)), supplierId, "Acme");
  await assertNothingWritten(supplierId);
});

await check("manage actor create (spoofed data.actorUid) -> FROZEN, nothing written", async () => {
  const supplierId = sid("SUP");
  await assertFrozen(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId, name: "Acme Supply", vendorNumber: "V-1", actorUid: "SPOOFED-should-be-ignored" }, manage)), supplierId, "Acme Supply", "V-1", "SPOOFED");
  await assertNothingWritten(supplierId);
});
let created;
await check("create over an EXISTING supplier -> the SAME frozen refusal as a new id (no existence disclosure); record unchanged", async () => {
  created = sid("SUP");
  const before = await seedSupplier(created, "Acme Supply");
  const onExisting = await assertFrozen(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId: created, name: "Acme Supply" }, manage)), created, "Acme Supply");
  const fresh = sid("SUP");
  const onMissing = await assertFrozen(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId: fresh, name: "Acme Supply" }, manage)), fresh);
  assert.equal(onExisting.message, onMissing.message);
  assert.deepEqual(onExisting.details, onMissing.details);
  await assertUnchanged(created, before);
  await assertNothingWritten(fresh);
});
await check("idempotency: same key+input retried -> FROZEN both times, no idempotency record", async () => {
  const supplierId = sid("SUP");
  const k = key("c");
  for (let i = 0; i < 2; i += 1) await assertFrozen(c.createSupplierCallable.run(req({ idempotencyKey: k, supplierId, name: "Replay Co" }, manage)), supplierId);
  await assertNothingWritten(supplierId);
});
await check("bad field -> FROZEN (the guard answers before validation; validation is proven in supplierMasterCommands)", async () => {
  await assertFrozen(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId: "bad id!", name: "X" }, manage)), "bad id!");
});

// ---- update mapping ----
await check("update wrong version / missing / valid -> FROZEN, identical refusal; existing record unchanged", async () => {
  const before = (await read(created)).data();
  const missing = sid("SUP");
  const a = await assertFrozen(c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: created, expectedVersion: 9, changes: { name: "Z" } }, manage)), created);
  const b = await assertFrozen(c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: missing, expectedVersion: 1, changes: { name: "Z" } }, manage)), missing);
  await assertFrozen(c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: created, expectedVersion: 1, changes: { name: "Acme Supply Intl", phone: "555" } }, manage)), created, "555");
  assert.equal(a.message, b.message, "a stale version and a missing supplier are indistinguishable");
  await assertUnchanged(created, before);
  await assertNothingWritten(missing);
});
await check("update non-updatable field -> FROZEN, unchanged", async () => {
  const before = (await read(created)).data();
  await assertFrozen(c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: created, expectedVersion: 1, changes: { status: "INACTIVE" } }, manage)), created);
  await assertUnchanged(created, before);
});

// ---- activate/deactivate ----
await check("activate/deactivate (manage-only or no-capability actor) -> FROZEN, status unchanged", async () => {
  const before = (await read(created)).data();
  for (const actor of [manage, noCap]) {
    await assertFrozen(c.activateSupplierCallable.run(req({ idempotencyKey: key("a"), supplierId: created, expectedVersion: 1 }, actor)), created);
    await assertFrozen(c.deactivateSupplierCallable.run(req({ idempotencyKey: key("d"), supplierId: created, expectedVersion: 1 }, actor)), created);
  }
  await assertUnchanged(created, before);
  assert.equal(before.status, "ACTIVE");
});
await check("activate/deactivate unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.activateSupplierCallable.run(req({ idempotencyKey: key("a"), supplierId: created, expectedVersion: 2 }, undefined)), "unauthenticated");
  await assertHttps(c.deactivateSupplierCallable.run(req({ idempotencyKey: key("d"), supplierId: created, expectedVersion: 2 }, undefined)), "unauthenticated");
});

console.log(`\nsupplierMasterCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
