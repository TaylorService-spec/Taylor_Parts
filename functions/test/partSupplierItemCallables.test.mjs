// Part↔Supplier procurement-term callables -- onCall adapter tests (partMasterCallables conventions).
// Invoke each v2 onCall via `.run(request)` against the Firestore emulator. Proves: unauth/non-object
// rejection; capability enforced INSIDE the command (no-capability -> permission-denied); actorUid from
// request.auth.uid only; sanitized error mapping; idempotency replay; changeStatus needs the DISTINCT
// inventory.catalog.activate; and the ATOMIC ≤1-ACTIVE-preferred invariant via setPreferredSupplier.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const c = await import("../lib/partMaster/partSupplierItemCallables.js");
const pm = await import("../lib/partMaster/partMasterCallables.js");

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
const item = async (id) => (await db.collection("part_supplier_items").doc(id).get()).data();

console.log("partSupplierItemCallables.test.mjs");

const manage = await seedActor("inventoryCreateExecutor"); // inventory.catalog.manage ONLY
const noCap = await seedActor(null);
// Prerequisite: a governed Part (createPartSupplierItem requires the part to exist).
const part = pid("P");
await check("prerequisite: create the Part via createPart callable", async () => {
  const r = await pm.createPartCallable.run(req({ idempotencyKey: key("p"), part: partInput(part) }, manage));
  assert.equal(r.version, 1);
});

await check("unauthenticated create -> unauthenticated", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS }, undefined)), "unauthenticated");
});
await check("non-object data -> invalid-argument", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req("nope", manage)), "invalid-argument");
});
await check("no-capability actor create -> permission-denied", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS }, noCap)), "permission-denied");
});
await check("missing part -> not-found", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: "P-NONE-9", supplierId: "SUP-A", ...TERMS }, manage)), "not-found");
});

let itemA;
await check("manage create -> applied; itemId = part__supplier; actorUid from AUTH", async () => {
  const r = await c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS, actorUid: "SPOOFED" }, manage));
  assert.equal(r.outcome, "applied");
  assert.equal(r.itemId, `${part}__SUP-A`);
  const doc = await item(r.itemId);
  assert.equal(doc.createdBy, manage);
  assert.notEqual(doc.createdBy, "SPOOFED");
  itemA = r.itemId;
});
await check("duplicate create -> already-exists", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-A", ...TERMS }, manage)), "already-exists");
});
await check("idempotency: same key+input -> replayed", async () => {
  const k = key("c");
  const first = await c.createPartSupplierItemCallable.run(req({ idempotencyKey: k, partId: part, supplierId: "SUP-C", ...TERMS }, manage));
  const second = await c.createPartSupplierItemCallable.run(req({ idempotencyKey: k, partId: part, supplierId: "SUP-C", ...TERMS }, manage));
  assert.equal(second.outcome, "replayed");
});
await check("bad terms -> invalid-argument", async () => {
  await assertHttps(c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-D", ...TERMS, currency: "usd" }, manage)), "invalid-argument");
});
await check("update wrong version -> aborted; valid -> applied v2", async () => {
  await assertHttps(c.updatePartSupplierItemCallable.run(req({ idempotencyKey: key("u"), itemId: itemA, expectedVersion: 9, changes: { cost: "13.00" } }, manage)), "aborted");
  const r = await c.updatePartSupplierItemCallable.run(req({ idempotencyKey: key("u"), itemId: itemA, expectedVersion: 1, changes: { cost: "13.00", leadTimeDays: 10 } }, manage));
  assert.equal(r.version, 2);
});
await check("changePartSupplierItemStatus with .manage-only -> permission-denied (distinct .activate)", async () => {
  await assertHttps(c.changePartSupplierItemStatusCallable.run(req({ idempotencyKey: key("s"), itemId: itemA, expectedVersion: 2, newStatus: "INACTIVE" }, manage)), "permission-denied");
});

await check("setPreferredSupplier: atomic <=1 ACTIVE preferred per part (handover clears the prior)", async () => {
  await c.createPartSupplierItemCallable.run(req({ idempotencyKey: key("c"), partId: part, supplierId: "SUP-B", ...TERMS, supplierSku: "B-1" }, manage));
  await c.setPreferredSupplierCallable.run(req({ idempotencyKey: key("pref"), partId: part, supplierId: "SUP-A", expectedVersion: 2 }, manage));
  const r = await c.setPreferredSupplierCallable.run(req({ idempotencyKey: key("pref"), partId: part, supplierId: "SUP-B", expectedVersion: 1 }, manage));
  assert.equal(r.outcome, "applied");
  assert.equal((await item(`${part}__SUP-A`)).preferred, false); // prior preferred cleared
  assert.equal((await item(`${part}__SUP-B`)).preferred, true);
});
await check("setPreferredSupplier unauthenticated -> unauthenticated", async () => {
  await assertHttps(c.setPreferredSupplierCallable.run(req({ idempotencyKey: key("pref"), partId: part, supplierId: "SUP-A", expectedVersion: 3 }, undefined)), "unauthenticated");
});

console.log(`\npartSupplierItemCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
