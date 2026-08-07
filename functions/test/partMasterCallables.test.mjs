// Part Master -- onCall adapter tests. Conventions of supplierMasterCallables.test.mjs /
// truckRegistryCallables.test.mjs: invoke each v2 onCall via `.run(request)` (no HTTP layer), against the
// Firestore emulator, importing the compiled ../lib. Proves: unauthenticated rejection; non-object
// rejection; capability enforced INSIDE the command (no-capability actor -> permission-denied) against
// REAL governed roles; actorUid derived ONLY from request.auth.uid (never request.data); sanitized
// error->HttpsError mapping; idempotency replay; and that changePartStatus requires the DISTINCT
// inventory.catalog.activate (a .manage-only actor is denied) -- which no standing role carries today.
// Prerequisite: npm run build; Firestore emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const c = await import("../lib/partMaster/partMasterCallables.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const pid = (p) => `${p}-${now}-${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined });
const partInput = (id, over = {}) => ({ partId: id, internalPartNumber: id, name: "Widget", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", ...over });

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

console.log("partMasterCallables.test.mjs");

const manage = await seedActor("inventoryCreateExecutor"); // carries inventory.catalog.manage ONLY
const noCap = await seedActor(null); // signed in, no capability

await check("unauthenticated create -> unauthenticated", async () => {
  await assertHttps(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(pid("P")) }, undefined)), "unauthenticated");
});
await check("non-object data -> invalid-argument", async () => {
  await assertHttps(c.createPartCallable.run(req("nope", manage)), "invalid-argument");
});
await check("no-capability actor create -> permission-denied (enforced inside command)", async () => {
  await assertHttps(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(pid("P")) }, noCap)), "permission-denied");
});

let created;
await check("manage actor create -> applied v1; actorUid from AUTH not data", async () => {
  const partId = pid("P");
  const r = await c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(partId), actorUid: "SPOOFED-should-be-ignored" }, manage));
  assert.equal(r.outcome, "applied");
  assert.equal(r.version, 1);
  const doc = (await db.collection("parts").doc(partId).get()).data();
  assert.equal(doc.createdBy, manage); // from request.auth.uid
  assert.notEqual(doc.createdBy, "SPOOFED-should-be-ignored");
  created = partId;
});
await check("duplicate create -> already-exists", async () => {
  await assertHttps(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(created) }, manage)), "already-exists");
});
await check("idempotency: same key+input -> replayed", async () => {
  const partId = pid("P");
  const k = key("c");
  const first = await c.createPartCallable.run(req({ idempotencyKey: k, part: partInput(partId) }, manage));
  assert.equal(first.outcome, "applied");
  const second = await c.createPartCallable.run(req({ idempotencyKey: k, part: partInput(partId) }, manage));
  assert.equal(second.outcome, "replayed");
});
await check("invalid part -> invalid-argument", async () => {
  await assertHttps(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: { partId: "bad id!", name: "X" } }, manage)), "invalid-argument");
});

await check("update wrong version -> aborted; missing -> not-found; valid -> applied v2", async () => {
  await assertHttps(c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: created, expectedVersion: 9, changes: { name: "Z" } }, manage)), "aborted");
  await assertHttps(c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: pid("P"), expectedVersion: 1, changes: { name: "Z" } }, manage)), "not-found");
  const r = await c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: created, expectedVersion: 1, changes: { name: "Widget v2", description: "updated" } }, manage));
  assert.equal(r.version, 2);
});
await check("update non-updatable field (status) -> invalid-argument", async () => {
  await assertHttps(c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: created, expectedVersion: 2, changes: { status: "ACTIVE" } }, manage)), "invalid-argument");
});

await check("changePartStatus with .manage-only actor -> permission-denied (distinct .activate)", async () => {
  await assertHttps(c.changePartStatusCallable.run(req({ idempotencyKey: key("s"), partId: created, expectedVersion: 2, newStatus: "ACTIVE" }, manage)), "permission-denied");
});
await check("changePartStatus unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.changePartStatusCallable.run(req({ idempotencyKey: key("s"), partId: created, expectedVersion: 2, newStatus: "ACTIVE" }, undefined)), "unauthenticated");
});

console.log(`\npartMasterCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
