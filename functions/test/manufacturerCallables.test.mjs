// Manufacturer -- onCall adapter tests. Conventions of partMasterCallables.test.mjs: invoke each v2
// onCall via `.run(request)` against the Firestore emulator, importing the compiled ../lib. Proves:
// unauthenticated / non-object rejection; capability enforced INSIDE the command (no-capability actor ->
// permission-denied) against REAL governed roles; actorUid derived ONLY from request.auth.uid (never
// request.data); sanitized error->HttpsError mapping; idempotency replay; and that
// changeManufacturerStatus requires the DISTINCT inventory.catalog.activate (a .manage-only actor is denied).
// Prerequisite: npm run build; Firestore emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const c = await import("../lib/partMaster/manufacturerCallables.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const mid = (p) => `${p}-${now}-${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined });

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

console.log("manufacturerCallables.test.mjs");

const manage = await seedActor("inventoryCreateExecutor"); // carries inventory.catalog.manage ONLY
const noCap = await seedActor(null);

await check("unauthenticated create -> unauthenticated", async () => {
  await assertHttps(c.createManufacturerCallable.run(req({ idempotencyKey: key("c"), manufacturerId: mid("MFR"), name: "Acme Mfg" }, undefined)), "unauthenticated");
});
await check("non-object data -> invalid-argument", async () => {
  await assertHttps(c.createManufacturerCallable.run(req("nope", manage)), "invalid-argument");
});
await check("no-capability actor create -> permission-denied (enforced inside command)", async () => {
  await assertHttps(c.createManufacturerCallable.run(req({ idempotencyKey: key("c"), manufacturerId: mid("MFR"), name: "Acme Mfg" }, noCap)), "permission-denied");
});

let created;
await check("manage actor create -> applied v1 (ACTIVE); actorUid from AUTH not data", async () => {
  const manufacturerId = mid("MFR");
  const r = await c.createManufacturerCallable.run(req({ idempotencyKey: key("c"), manufacturerId, name: "Acme Manufacturing", actorUid: "SPOOFED-should-be-ignored" }, manage));
  assert.equal(r.outcome, "applied");
  assert.equal(r.version, 1);
  const doc = (await db.collection("manufacturers").doc(manufacturerId).get()).data();
  assert.equal(doc.createdBy, manage);
  assert.notEqual(doc.createdBy, "SPOOFED-should-be-ignored");
  assert.equal(doc.status, "ACTIVE");
  created = manufacturerId;
});
await check("duplicate create -> already-exists", async () => {
  await assertHttps(c.createManufacturerCallable.run(req({ idempotencyKey: key("c"), manufacturerId: created, name: "Acme Manufacturing" }, manage)), "already-exists");
});
await check("idempotency: same key+input -> replayed", async () => {
  const manufacturerId = mid("MFR");
  const k = key("c");
  const first = await c.createManufacturerCallable.run(req({ idempotencyKey: k, manufacturerId, name: "Replay Mfg" }, manage));
  assert.equal(first.outcome, "applied");
  const second = await c.createManufacturerCallable.run(req({ idempotencyKey: k, manufacturerId, name: "Replay Mfg" }, manage));
  assert.equal(second.outcome, "replayed");
});
await check("invalid input (bad id) -> invalid-argument", async () => {
  await assertHttps(c.createManufacturerCallable.run(req({ idempotencyKey: key("c"), manufacturerId: "bad id!", name: "X" }, manage)), "invalid-argument");
});

await check("update wrong version -> aborted; missing -> not-found; valid -> applied v2", async () => {
  await assertHttps(c.updateManufacturerCallable.run(req({ idempotencyKey: key("u"), manufacturerId: created, expectedVersion: 9, name: "Z" }, manage)), "aborted");
  await assertHttps(c.updateManufacturerCallable.run(req({ idempotencyKey: key("u"), manufacturerId: mid("MFR"), expectedVersion: 1, name: "Z" }, manage)), "not-found");
  const r = await c.updateManufacturerCallable.run(req({ idempotencyKey: key("u"), manufacturerId: created, expectedVersion: 1, name: "Acme Manufacturing Intl" }, manage));
  assert.equal(r.version, 2);
});

await check("changeManufacturerStatus with .manage-only actor -> permission-denied (distinct .activate)", async () => {
  await assertHttps(c.changeManufacturerStatusCallable.run(req({ idempotencyKey: key("s"), manufacturerId: created, expectedVersion: 2, newStatus: "INACTIVE" }, manage)), "permission-denied");
});
await check("changeManufacturerStatus unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.changeManufacturerStatusCallable.run(req({ idempotencyKey: key("s"), manufacturerId: created, expectedVersion: 2, newStatus: "INACTIVE" }, undefined)), "unauthenticated");
});

console.log(`\nmanufacturerCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
