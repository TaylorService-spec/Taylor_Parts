// Part↔Supplier procurement-term callables -- onCall adapter tests (partMasterCallables conventions).
// Invoke each v2 onCall via `.run(request)` against the Firestore emulator. Proves: unauth/non-object
// rejection; capability enforced INSIDE the command (no-capability -> permission-denied); actorUid from
// request.auth.uid only; sanitized error mapping; idempotency replay; changeStatus needs the DISTINCT
// inventory.catalog.activate; and the ATOMIC ≤1-ACTIVE-preferred invariant via setPreferredSupplier.
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, FROZEN/INACTIVE). createPartSupplierItem /
// updatePartSupplierItem / changePartSupplierItemStatus / setPreferredSupplier (and createPart, which the old
// prerequisite used) are FROZEN legacy Firestore catalog writers whose guard is their FIRST statement (before
// capability resolution). So the prerequisite Part and items are seeded DIRECTLY in exactly the stored shape the
// frozen writers produced (ruling B), and every authenticated, well-shaped call is the governed refusal (ruling A):
// failed-precondition, details.code FIRESTORE_CATALOG_WRITER_FROZEN, the ONE generic freeze message (identical for an
// existing and a missing Part/item, carrying no terms, ids or cost), and nothing written -- no item (or existing items
// byte-for-byte unchanged), no audit / idempotency record. Adapter-only behaviour before the command (unauthenticated,
// non-object) is unchanged. Term validation, the deterministic id and the stored shape stay proven in
// partSupplierItems.test.mjs; capability RESOLUTION at the governed access boundary (governedBusinessRoles.test.mjs,
// trustedWriterCommands.test.mjs). Nothing here reopens a writer or replaces the guard.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const c = await import("../lib/partMaster/partSupplierItemCallables.js");
const { partToFirestore } = await import("../lib/partMaster/partMasterRepository.js");
const { validatePart } = await import("../lib/partMaster/validation.js");
const { supplierItemToFirestore, buildSupplierItemId, validateSupplierItemTerms } = await import("../lib/partMaster/partSupplierItems.js");

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
const TERMS = { supplierSku: "SKU-1", cost: "12.50", currency: "USD", leadTimeDays: 7 };
const partInput = (id) => ({ partId: id, internalPartNumber: id, name: "Widget", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" });

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
  try { await promise; assert.fail(`expected "${expectedCode}", none thrown`); }
  catch (err) { assert.equal(err.code, expectedCode, `expected "${expectedCode}", got "${err.code}": ${err.message}`); }
}


// ---- freeze assertions (ruling A) ----
const FROZEN_MESSAGE = "Part-supplier terms are frozen for the catalog cutover.";
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
const auditsFor = async (id) => (await db.collection("auditEvents").where("targetId", "==", id).get()).size;
async function snapshotItems(partId) {
  const q = await db.collection("part_supplier_items").where("partId", "==", partId).get();
  return Object.fromEntries(q.docs.map((d) => [d.id, d.data()]));
}
async function assertItemsUnchanged(partId, before) {
  assert.deepEqual(await snapshotItems(partId), before, "every item of the part must be byte-for-byte unchanged");
  for (const id of Object.keys(before)) assert.equal(await auditsFor(id), 0, `no audit / idempotency record for ${id}`);
}
async function assertNoItem(itemId) {
  assert.equal((await db.collection("part_supplier_items").doc(itemId).get()).exists, false, `${itemId} must not exist`);
  assert.equal(await auditsFor(itemId), 0, "no audit / idempotency record");
}

console.log("partSupplierItemCallables.test.mjs");

const manage = await seedActor("inventoryCreateExecutor"); // inventory.catalog.manage ONLY
const noCap = await seedActor(null);
// ---- stored-shape fixtures (ruling B) ----
const AT = new Date(1750000000000);
const part = pid("P");
await check("prerequisite: the governed Part, seeded in exactly the shape createPart wrote", async () => {
  const v = validatePart(partInput(part));
  assert.equal(v.valid, true);
  await db.collection("parts").doc(part).set(partToFirestore({ part: v.value, version: 1, createdAt: AT, createdBy: manage, updatedAt: AT, updatedBy: manage }));
  assert.equal((await db.collection("parts").doc(part).get()).data().version, 1);
});
async function seedItem(supplierId, terms = TERMS, { preferred = false, version = 1 } = {}) {
  const v = validateSupplierItemTerms(terms, true);
  assert.equal(v.valid, true);
  const itemId = buildSupplierItemId(part, supplierId);
  await db.collection("part_supplier_items").doc(itemId).set(supplierItemToFirestore({
    itemId, partId: part, supplierId, ...v.value, availability: v.value.availability ?? "UNKNOWN", preferred, status: "ACTIVE", version,
    createdAt: AT, createdBy: manage, updatedAt: AT, updatedBy: manage,
  }));
  return itemId;
}

await check("unauthenticated create -> unauthenticated", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS }, undefined)), "unauthenticated");
});
await check("non-object data -> invalid-argument", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req("nope", manage)), "invalid-argument");
});
await check("no-capability actor create -> failed-precondition FIRESTORE_CATALOG_WRITER_FROZEN (guard precedes capability), nothing written", async () => {
  await assertFrozen(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS }, noCap)), part, "SUP-A", "12.50");
  await assertNoItem(buildSupplierItemId(part, "SUP-A"));
});
await check("missing part -> the SAME frozen refusal as an existing part (no existence disclosure), nothing written", async () => {
  const onMissing = await assertFrozen(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: "P-NONE-9", supplierId: "SUP-A", ...TERMS }, manage)), "P-NONE-9");
  const onExisting = await assertFrozen(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS }, manage)), part);
  assert.equal(onMissing.message, onExisting.message);
  assert.deepEqual(onMissing.details, onExisting.details);
  await assertNoItem(buildSupplierItemId("P-NONE-9", "SUP-A"));
  await assertNoItem(buildSupplierItemId(part, "SUP-A"));
});

let itemA;
await check("manage create (spoofed data.actorUid) -> FROZEN, nothing written", async () => {
  await assertFrozen(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS, actorUid: "SPOOFED" }, manage)), "SPOOFED", "SKU-1");
  await assertNoItem(buildSupplierItemId(part, "SUP-A"));
});
await check("create over an EXISTING item -> FROZEN, the item unchanged", async () => {
  itemA = await seedItem("SUP-A");
  const before = await snapshotItems(part);
  await assertFrozen(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS }, manage)), itemA);
  await assertItemsUnchanged(part, before);
});
await check("idempotency: same key+input retried -> FROZEN both times, no idempotency record", async () => {
  const k = key("c");
  for (let i = 0; i < 2; i += 1) await assertFrozen(c.createPartSupplierItemCallable.run(req({ idempotencyKey: k, partId: part, supplierId: "SUP-C", ...TERMS }, manage)));
  await assertNoItem(buildSupplierItemId(part, "SUP-C"));
});
await check("bad terms -> FROZEN (the guard answers before validation; validateSupplierItemTerms is proven in partSupplierItems)", async () => {
  await assertFrozen(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-D", ...TERMS, currency: "usd" }, manage)), "usd");
  await assertNoItem(buildSupplierItemId(part, "SUP-D"));
});
await check("update wrong version / valid -> FROZEN, the item unchanged", async () => {
  const before = await snapshotItems(part);
  await assertFrozen(c.updatePartSupplierItemCallable.run(req({ idempotencyKey: key("u"), itemId: itemA, expectedVersion: 9, changes: { cost: "13.00" } }, manage)), itemA, "13.00");
  await assertFrozen(c.updatePartSupplierItemCallable.run(req({ idempotencyKey: key("u"), itemId: itemA, expectedVersion: 1, changes: { cost: "13.00", leadTimeDays: 10 } }, manage)), itemA, "13.00");
  await assertItemsUnchanged(part, before);
});
await check("changePartSupplierItemStatus (manage-only or no-capability) -> FROZEN, status unchanged", async () => {
  const before = await snapshotItems(part);
  for (const actor of [manage, noCap]) {
    await assertFrozen(c.changePartSupplierItemStatusCallable.run(req({ idempotencyKey: key("s"), itemId: itemA, expectedVersion: 1, newStatus: "INACTIVE" }, actor)), itemA);
  }
  await assertItemsUnchanged(part, before);
  assert.equal(before[itemA].status, "ACTIVE");
});

await check("setPreferredSupplier: FROZEN -- no handover; exactly one preferred item stays as it was", async () => {
  const itemB = await seedItem("SUP-B", { ...TERMS, supplierSku: "B-1" });
  await db.collection("part_supplier_items").doc(itemA).set(supplierItemToFirestore({
    itemId: itemA, partId: part, supplierId: "SUP-A", ...validateSupplierItemTerms(TERMS, true).value, availability: "UNKNOWN", preferred: true, status: "ACTIVE", version: 2,
    createdAt: AT, createdBy: manage, updatedAt: AT, updatedBy: manage,
  }));
  const before = await snapshotItems(part);
  await assertFrozen(c.setPreferredSupplierCallable.run(req({ idempotencyKey: key("pref"), partId: part, supplierId: "SUP-B", expectedVersion: 1 }, manage)), itemB);
  await assertFrozen(c.setPreferredSupplierCallable.run(req({ idempotencyKey: key("pref"), partId: part, supplierId: "SUP-A", expectedVersion: 2 }, manage)), itemA);
  await assertItemsUnchanged(part, before);
  assert.equal(before[itemA].preferred, true);
  assert.equal(before[itemB].preferred, false);
});
await check("setPreferredSupplier unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.setPreferredSupplierCallable.run(req({ idempotencyKey: key("pref"), partId: part, supplierId: "SUP-A", expectedVersion: 3 }, undefined)), "unauthenticated");
});

console.log(`\npartSupplierItemCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
