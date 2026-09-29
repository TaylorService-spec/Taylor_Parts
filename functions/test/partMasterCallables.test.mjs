// Part Master -- onCall adapter tests. Conventions of supplierMasterCallables.test.mjs /
// truckRegistryCallables.test.mjs: invoke each v2 onCall via `.run(request)` (no HTTP layer), against the
// Firestore emulator, importing the compiled ../lib. Proves: unauthenticated rejection; non-object
// rejection; capability enforced INSIDE the command (no-capability actor -> permission-denied) against
// REAL governed roles; actorUid derived ONLY from request.auth.uid (never request.data); sanitized
// error->HttpsError mapping; idempotency replay; and that changePartStatus requires the DISTINCT
// inventory.catalog.activate (a .manage-only actor is denied) -- which no standing role carries today.
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, FROZEN/INACTIVE). createPart / updatePart /
// changePartStatus are FROZEN legacy Firestore catalog writers whose guard is their FIRST statement (before
// capability resolution). So every authenticated, well-shaped call is now the governed refusal (ruling A):
// failed-precondition, details.code FIRESTORE_CATALOG_WRITER_FROZEN, the ONE generic freeze message (identical for an
// existing and a missing Part, carrying no Part data), and nothing written -- no Part document (or an existing one
// byte-for-byte unchanged), no audit / idempotency record. Adapter-only behaviour before the command (unauthenticated,
// non-object) is unchanged. Part validation and the status matrix stay proven in partMasterCommands.test.mjs (pure
// validatePart / PART_STATUS_TRANSITIONS); capability RESOLUTION for inventory.catalog.* at the governed access
// boundary (governedBusinessRoles.test.mjs, trustedWriterCommands.test.mjs). Nothing here reopens a writer.
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
// ---- freeze assertions (ruling A) ----
const FROZEN_MESSAGE = "Part records are frozen for the catalog cutover.";
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
const partDoc = async (id) => (await db.collection("parts").doc(id).get());
const auditsFor = async (id) => (await db.collection("auditEvents").where("targetId", "==", id).get()).size;
async function assertNothingWritten(id) {
  assert.equal((await partDoc(id)).exists, false, `parts/${id} must not exist`);
  assert.equal(await auditsFor(id), 0, "no audit / idempotency record");
}
async function assertUnchanged(id, before) {
  assert.deepEqual((await partDoc(id)).data(), before, `parts/${id} must be byte-for-byte unchanged`);
  assert.equal(await auditsFor(id), 0, "no audit / idempotency record");
}
// A Part in exactly the stored shape createPart staged (the real validatePart + partToFirestore).
const { partToFirestore } = await import("../lib/partMaster/partMasterRepository.js");
const { validatePart } = await import("../lib/partMaster/validation.js");
const AT = new Date(1750000000000);
async function seedPart(id) {
  const v = validatePart(partInput(id));
  assert.equal(v.valid, true);
  await db.collection("parts").doc(id).set(partToFirestore({ part: v.value, version: 1, createdAt: AT, createdBy: manage, updatedAt: AT, updatedBy: manage }));
  return (await partDoc(id)).data();
}

await check("no-capability actor create -> failed-precondition FIRESTORE_CATALOG_WRITER_FROZEN (guard precedes capability), nothing written", async () => {
  const partId = pid("P");
  await assertFrozen(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(partId) }, noCap)), partId);
  await assertNothingWritten(partId);
});

let created;
await check("manage actor create (spoofed data.actorUid) -> FROZEN, nothing written", async () => {
  const partId = pid("P");
  await assertFrozen(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(partId), actorUid: "SPOOFED-should-be-ignored" }, manage)), partId, "SPOOFED");
  await assertNothingWritten(partId);
});
await check("create over an EXISTING part -> the SAME frozen refusal as a new id (no existence disclosure); record unchanged", async () => {
  created = pid("P");
  const before = await seedPart(created);
  const onExisting = await assertFrozen(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(created) }, manage)), created);
  const fresh = pid("P");
  const onMissing = await assertFrozen(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: partInput(fresh) }, manage)), fresh);
  assert.equal(onExisting.message, onMissing.message);
  assert.deepEqual(onExisting.details, onMissing.details);
  await assertUnchanged(created, before);
  await assertNothingWritten(fresh);
});
await check("idempotency: same key+input retried -> FROZEN both times, no idempotency record", async () => {
  const partId = pid("P");
  const k = key("c");
  for (let i = 0; i < 2; i += 1) await assertFrozen(c.createPartCallable.run(req({ idempotencyKey: k, part: partInput(partId) }, manage)), partId);
  await assertNothingWritten(partId);
});
await check("invalid part -> FROZEN (the guard answers before validation; validatePart is proven in partMasterCommands)", async () => {
  await assertFrozen(c.createPartCallable.run(req({ idempotencyKey: key("c"), part: { partId: "bad id!", name: "X" } }, manage)), "bad id!");
});

await check("update wrong version / missing / valid -> FROZEN, identical refusal; existing record unchanged", async () => {
  const before = (await partDoc(created)).data();
  const missing = pid("P");
  const a = await assertFrozen(c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: created, expectedVersion: 9, changes: { name: "Z" } }, manage)), created);
  const b = await assertFrozen(c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: missing, expectedVersion: 1, changes: { name: "Z" } }, manage)), missing);
  await assertFrozen(c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: created, expectedVersion: 1, changes: { name: "Widget v2", description: "updated" } }, manage)), created);
  assert.equal(a.message, b.message, "a stale version and a missing part are indistinguishable");
  await assertUnchanged(created, before);
  await assertNothingWritten(missing);
});
await check("update non-updatable field (status) -> FROZEN, unchanged", async () => {
  const before = (await partDoc(created)).data();
  await assertFrozen(c.updatePartCallable.run(req({ idempotencyKey: key("u"), partId: created, expectedVersion: 1, changes: { status: "ACTIVE" } }, manage)), created);
  await assertUnchanged(created, before);
});

await check("changePartStatus (manage-only or no-capability actor) -> FROZEN, status unchanged", async () => {
  const before = (await partDoc(created)).data();
  for (const actor of [manage, noCap]) {
    await assertFrozen(c.changePartStatusCallable.run(req({ idempotencyKey: key("s"), partId: created, expectedVersion: 1, newStatus: "ACTIVE" }, actor)), created);
  }
  await assertUnchanged(created, before);
  assert.equal(before.status, "DRAFT");
});
await check("changePartStatus unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.changePartStatusCallable.run(req({ idempotencyKey: key("s"), partId: created, expectedVersion: 2, newStatus: "ACTIVE" }, undefined)), "unauthenticated");
});

console.log(`\npartMasterCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
