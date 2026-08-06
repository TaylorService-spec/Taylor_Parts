// Supplier Master -- onCall adapter tests. Conventions of truckRegistryCallables.test.mjs / accessCommandCallables.test.js:
// invoke each v2 onCall via `.run(request)` (no HTTP layer), against the Firestore emulator, importing the
// compiled ../lib. Proves: unauthenticated rejection; non-object rejection; capability enforced INSIDE the
// command (no-capability actor -> permission-denied) against REAL governed roles; actorUid derived ONLY from
// request.auth.uid (never request.data); the sanitized error->HttpsError mapping; idempotency replay; and that
// activate/deactivate require the DISTINCT inventory.catalog.activate (a .manage-only actor is denied) -- which
// no standing role carries today, so they fail closed until a deferred protected grant.
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
await check("no-capability actor create -> permission-denied (enforced inside command)", async () => {
  await assertHttps(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId: sid("SUP"), name: "Acme" }, noCap)), "permission-denied");
});

// ---- create success + actor identity from auth ----
let created;
await check("manage actor create -> applied v1; actorUid from AUTH not data", async () => {
  const supplierId = sid("SUP");
  const r = await c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId, name: "Acme Supply", vendorNumber: "V-1", actorUid: "SPOOFED-should-be-ignored" }, manage));
  assert.equal(r.outcome, "applied");
  assert.equal(r.version, 1);
  assert.equal(r.supplierId, supplierId);
  assert.deepEqual(r.suspectedDuplicateOf, []);
  const doc = (await db.collection("suppliers").doc(supplierId).get()).data();
  assert.equal(doc.createdBy, manage); // from request.auth.uid
  assert.notEqual(doc.createdBy, "SPOOFED-should-be-ignored"); // data.actorUid ignored
  assert.equal(doc.vendorNumber, "V-1");
  created = supplierId;
});
await check("duplicate create -> already-exists", async () => {
  await assertHttps(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId: created, name: "Acme Supply" }, manage)), "already-exists");
});
await check("idempotency: same key+input -> replayed", async () => {
  const supplierId = sid("SUP");
  const k = key("c");
  const first = await c.createSupplierCallable.run(req({ idempotencyKey: k, supplierId, name: "Replay Co" }, manage));
  assert.equal(first.outcome, "applied");
  const second = await c.createSupplierCallable.run(req({ idempotencyKey: k, supplierId, name: "Replay Co" }, manage));
  assert.equal(second.outcome, "replayed");
});
await check("bad field -> invalid-argument", async () => {
  await assertHttps(c.createSupplierCallable.run(req({ idempotencyKey: key("c"), supplierId: "bad id!", name: "X" }, manage)), "invalid-argument");
});

// ---- update mapping ----
await check("update wrong version -> aborted; missing -> not-found; valid -> applied v2", async () => {
  await assertHttps(c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: created, expectedVersion: 9, changes: { name: "Z" } }, manage)), "aborted");
  await assertHttps(c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: sid("SUP"), expectedVersion: 1, changes: { name: "Z" } }, manage)), "not-found");
  const r = await c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: created, expectedVersion: 1, changes: { name: "Acme Supply Intl", phone: "555" } }, manage));
  assert.equal(r.version, 2);
});
await check("update non-updatable field -> invalid-argument", async () => {
  await assertHttps(c.updateSupplierCallable.run(req({ idempotencyKey: key("u"), supplierId: created, expectedVersion: 2, changes: { status: "INACTIVE" } }, manage)), "invalid-argument");
});

// ---- activate/deactivate require the DISTINCT inventory.catalog.activate (no standing role has it) ----
await check("activate/deactivate with .manage-only actor -> permission-denied (distinct capability)", async () => {
  await assertHttps(c.activateSupplierCallable.run(req({ idempotencyKey: key("a"), supplierId: created, expectedVersion: 2 }, manage)), "permission-denied");
  await assertHttps(c.deactivateSupplierCallable.run(req({ idempotencyKey: key("d"), supplierId: created, expectedVersion: 2 }, manage)), "permission-denied");
});
await check("activate/deactivate unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.activateSupplierCallable.run(req({ idempotencyKey: key("a"), supplierId: created, expectedVersion: 2 }, undefined)), "unauthenticated");
  await assertHttps(c.deactivateSupplierCallable.run(req({ idempotencyKey: key("d"), supplierId: created, expectedVersion: 2 }, undefined)), "unauthenticated");
});

console.log(`\nsupplierMasterCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
