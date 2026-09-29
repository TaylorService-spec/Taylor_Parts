// INV-1 Phase 1 PR 1.4 -- part_supplier_items tests (conventions of
// partAliasCommands.test.mjs: emulator + deps.roles seam; no production).
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, FROZEN/INACTIVE). createPartSupplierItem /
// updatePartSupplierItem / changePartSupplierItemStatus / setPreferredSupplier (and createPart, which the old setup
// used) are legacy Firestore catalog writers and are FROZEN: each refuses FIRST with FirestoreCatalogWriterClosedError
// (FIRESTORE_CATALOG_WRITER_FROZEN), before validation, capability resolution and the transaction. So:
//   A. the superseded WRITER contract (create/replay/update/status/preferred handover) asserts the governed refusal
//      carrying the writer's own id AND that nothing was written: no item document (or an existing one byte-for-byte
//      unchanged), and no audit event -- which is also this machinery's idempotency record;
//   B. still-valid domain proof moves to the existing lower boundary: the pure term validator
//      (validateSupplierItemTerms: bad terms, the update allow-list), buildSupplierItemId, and the stored-shape
//      adapters over Parts and items seeded DIRECTLY in exactly the shape the frozen writers staged.
// Nothing here reopens a writer or replaces the guard.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { createPartSupplierItem, updatePartSupplierItem, changePartSupplierItemStatus, setPreferredSupplier, supplierItemFromFirestore, supplierItemToFirestore, buildSupplierItemId, validateSupplierItemTerms } =
  await import("../lib/partMaster/partSupplierItems.js");
const { MalformedStoredRecordError, partToFirestore } = await import("../lib/partMaster/partMasterRepository.js");
const { validatePart } = await import("../lib/partMaster/validation.js");
const { FirestoreCatalogWriterClosedError } = await import("../lib/catalogMaster/catalogWriterState.js");

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
  await db.collection("roleAssignments").doc(id).set({ id, principalUid: actorUid, roleId, scope: { type: "global" }, grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1 });
  return actorUid;
}
const DEPS = { roles: TEST_ROLES, now: () => new Date(1750000000000) };
const granted = await seedActor("pmFull");
const ungranted = await seedActor("noGrant");
const AT = DEPS.now();
// ---- stored-shape fixtures (ruling B): exactly what createPart / createPartSupplierItem / setPreferredSupplier staged ----
async function newPart() {
  const pid = uid("P");
  const v = validatePart({ partId: pid, internalPartNumber: pid, name: "P", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" });
  assert.equal(v.valid, true);
  await db.collection("parts").doc(pid).set(partToFirestore({ part: v.value, version: 1, createdAt: AT, createdBy: granted, updatedAt: AT, updatedBy: granted }));
  return pid;
}
async function seedItem(partId, supplierId, terms = TERMS, { preferred = false, status = "ACTIVE", version = 1 } = {}) {
  const v = validateSupplierItemTerms(terms, true);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const itemId = buildSupplierItemId(partId, supplierId);
  await db.collection("part_supplier_items").doc(itemId).set(supplierItemToFirestore({
    itemId, partId, supplierId, ...v.value, availability: v.value.availability ?? "UNKNOWN", preferred, status, version,
    createdAt: AT, createdBy: granted, updatedAt: AT, updatedBy: granted,
  }));
  return itemId;
}
const TERMS = { supplierSku: "SKU-1", cost: "12.50", currency: "USD", leadTimeDays: 7 };
// ---- freeze helpers (ruling A) ----
const frozen = (writer) => (err) => {
  assert.ok(err instanceof FirestoreCatalogWriterClosedError, `expected the governed freeze refusal, got ${err?.name}: ${err?.message}`);
  assert.equal(err.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
  assert.equal(err.writer, writer);
  return true;
};
const itemDoc = async (id) => (await db.collection("part_supplier_items").doc(id).get());
const auditsFor = async (id) => (await db.collection("auditEvents").where("targetId", "==", id).get()).size;
async function assertNothingWritten(itemId) {
  assert.equal((await itemDoc(itemId)).exists, false, `part_supplier_items/${itemId} must not exist`);
  assert.equal(await auditsFor(itemId), 0, "no audit / idempotency record");
}
async function snapshotItems(partId) {
  const q = await db.collection("part_supplier_items").where("partId", "==", partId).get();
  return Object.fromEntries(q.docs.map((d) => [d.id, d.data()]));
}
async function assertItemsUnchanged(partId, before) {
  assert.deepEqual(await snapshotItems(partId), before, "every item of the part must be byte-for-byte unchanged");
  for (const id of Object.keys(before)) assert.equal(await auditsFor(id), 0, `no audit / idempotency record for ${id}`);
}

console.log("partSupplierItems.test.mjs");

await check("create: authorized -> FROZEN; no item, no audit; the Part core is untouched", async () => {
  const pid = await newPart();
  const partBefore = (await db.collection("parts").doc(pid).get()).data();
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS, minOrderQty: "5", orderMultiple: "5", purchaseUnit: "CASE", conversionToStockingUnit: { numerator: 24, denominator: 1 }, contractStart: "2026-01-01", contractEnd: "2026-12-31", availability: "AVAILABLE" }, DEPS), frozen("partSupplierItem.create"));
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-B", ...TERMS, supplierSku: "OTHER-9" }, DEPS), frozen("partSupplierItem.create"));
  for (const sup of ["SUP-A", "SUP-B"]) await assertNothingWritten(buildSupplierItemId(pid, sup));
  assert.deepEqual((await db.collection("parts").doc(pid).get()).data(), partBefore);
  // Ruling B: the deterministic identity the writer used, and that cost lives outside the Part core.
  assert.equal(buildSupplierItemId(pid, "SUP-A"), `${pid}__SUP-A`);
  assert.ok(!("cost" in partBefore) && !("supplierId" in partBefore));
});
await check("create: unauthorized / missing part / duplicate / bad terms -> FROZEN; bad terms rejected by validateSupplierItemTerms", async () => {
  const pid = await newPart();
  await assert.rejects(createPartSupplierItem({ actorUid: ungranted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS), frozen("partSupplierItem.create"));
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: "P-NONE-9", supplierId: "SUP-A", ...TERMS }, DEPS), frozen("partSupplierItem.create"));
  await assertNothingWritten(buildSupplierItemId(pid, "SUP-A"));
  await assertNothingWritten(buildSupplierItemId("P-NONE-9", "SUP-A"));
  await seedItem(pid, "SUP-A");
  const before = await snapshotItems(pid);
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s2"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS), frozen("partSupplierItem.create"));
  for (const bad of [{ cost: "12.505x" }, { currency: "usd" }, { leadTimeDays: -1 }, { minOrderQty: "0" }, { contractStart: "2026-02-01", contractEnd: "2026-01-01" }, { availability: "MAYBE" }, { purchaseUnit: "CASE" } /* factor missing */]) {
    assert.equal(validateSupplierItemTerms({ ...TERMS, ...bad }, true).valid, false, JSON.stringify(bad));
    await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-C", ...TERMS, ...bad }, DEPS), frozen("partSupplierItem.create"));
  }
  assert.equal(validateSupplierItemTerms(TERMS, true).valid, true);
  await assertItemsUnchanged(pid, before);
  await assertNothingWritten(buildSupplierItemId(pid, "SUP-C"));
});
await check("idempotency: same-key retry / conflicting retry / abort-after-stage -> FROZEN, nothing recorded", async () => {
  const pid = await newPart();
  const k = key("s");
  for (const cost of ["12.50", "12.50", "99.99"]) {
    await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: k, partId: pid, supplierId: "SUP-A", ...TERMS, cost }, DEPS), frozen("partSupplierItem.create"));
  }
  await assertNothingWritten(buildSupplierItemId(pid, "SUP-A"));
  const id2 = buildSupplierItemId(pid, "SUP-Z");
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-Z", ...TERMS }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }), frozen("partSupplierItem.create"));
  await assertNothingWritten(id2);
});
await check("update: FROZEN for every change; the allow-list (identity/preferred are not terms) lives in validateSupplierItemTerms", async () => {
  const pid = await newPart();
  const itemId = await seedItem(pid, "SUP-A");
  const before = await snapshotItems(pid);
  for (const [expectedVersion, changes] of [[9, { cost: "13.00" }], [1, { partId: "P-X" }], [1, { preferred: true }], [1, { cost: "13.00", leadTimeDays: 10, lastVerifiedAt: new Date(1750000000000) }]]) {
    await assert.rejects(updatePartSupplierItem({ actorUid: granted, idempotencyKey: key("u"), itemId, expectedVersion, changes }, DEPS), frozen("partSupplierItem.update"));
  }
  await assertItemsUnchanged(pid, before);
  for (const k of ["partId", "preferred", "supplierId", "status"]) {
    assert.equal(validateSupplierItemTerms({ [k]: "x" }, false).valid, false, `${k} must not be an updatable term`);
  }
  assert.equal(validateSupplierItemTerms({ cost: "13.00", leadTimeDays: 10, lastVerifiedAt: new Date(1750000000000) }, false).valid, true);
});
await check("status: FROZEN; a preferred ACTIVE item stays preferred and ACTIVE (no delete path either)", async () => {
  const pid = await newPart();
  const itemId = await seedItem(pid, "SUP-A", TERMS, { preferred: true, version: 2 });
  const before = await snapshotItems(pid);
  await assert.rejects(changePartSupplierItemStatus({ actorUid: granted, idempotencyKey: key("st"), itemId, expectedVersion: 2, newStatus: "INACTIVE" }, DEPS), frozen("partSupplierItem.changeStatus"));
  await assertItemsUnchanged(pid, before);
  assert.equal(before[itemId].status, "ACTIVE");
  assert.equal(before[itemId].preferred, true);
});
await check("preferred: setPreferredSupplier FROZEN -- no handover, no re-set; every item unchanged", async () => {
  const pid = await newPart();
  await seedItem(pid, "SUP-A", TERMS, { preferred: true, version: 2 });
  await seedItem(pid, "SUP-B", { ...TERMS, supplierSku: "B-1" });
  const before = await snapshotItems(pid);
  await assert.rejects(setPreferredSupplier({ actorUid: granted, idempotencyKey: key("p"), partId: pid, supplierId: "SUP-B", expectedVersion: 1 }, DEPS), frozen("partSupplierItem.setPreferred"));
  await assert.rejects(setPreferredSupplier({ actorUid: granted, idempotencyKey: key("p"), partId: pid, supplierId: "SUP-A", expectedVersion: 2 }, DEPS), frozen("partSupplierItem.setPreferred"));
  await assertItemsUnchanged(pid, before);
  assert.equal(Object.values(before).filter((d) => d.preferred === true).length, 1);
});
await check("serialization: round trip, id/identity integrity, malformed surfaced, no forbidden fields", async () => {
  const pid = await newPart();
  const itemId = await seedItem(pid, "SUP-A");
  const snap = await itemDoc(itemId);
  const stored = supplierItemFromFirestore(snap.id, snap.data());
  assert.equal(stored.partId, pid);
  assert.equal(stored.cost, "12.50");
  assert.equal(stored.preferred, false);
  assert.throws(() => supplierItemFromFirestore("WRONG", snap.data()), MalformedStoredRecordError);
  assert.throws(() => supplierItemFromFirestore(snap.id, { ...snap.data(), status: "GONE" }), MalformedStoredRecordError);
  assert.throws(() => supplierItemFromFirestore(snap.id, { ...snap.data(), supplierId: "OTHER" }), MalformedStoredRecordError);
  const doc = supplierItemToFirestore(stored);
  for (const k of ["onHand", "reserved", "tenantId", "companyId", "aiRecommendation"]) assert.ok(!(k in doc), k);
});

console.log(`\npartSupplierItems: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
