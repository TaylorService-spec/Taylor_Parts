// INV-1 Phase 1 PR 1.4 -- part_supplier_items tests (conventions of
// partAliasCommands.test.mjs: emulator + deps.roles seam; no production).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { createPart, InvalidInputError, UnauthorizedActorError, NotFoundError, AlreadyExistsError, VersionConflictError, IdempotencyConflictError } =
  await import("../lib/partMaster/partMasterCommands.js");
const { createPartSupplierItem, updatePartSupplierItem, changePartSupplierItemStatus, setPreferredSupplier, supplierItemFromFirestore, supplierItemToFirestore, buildSupplierItemId } =
  await import("../lib/partMaster/partSupplierItems.js");
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
async function newPart() {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "P", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  return pid;
}
const TERMS = { supplierSku: "SKU-1", cost: "12.50", currency: "USD", leadTimeDays: 7 };

console.log("partSupplierItems.test.mjs");

await check("create: authorized, deterministic id, v1, audit; multi-supplier per part; cost outside Part core", async () => {
  const pid = await newPart();
  const r = await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS, minOrderQty: "5", orderMultiple: "5", purchaseUnit: "CASE", conversionToStockingUnit: { numerator: 24, denominator: 1 }, contractStart: "2026-01-01", contractEnd: "2026-12-31", availability: "AVAILABLE" }, DEPS);
  assert.equal(r.itemId, `${pid}__SUP-A`);
  assert.equal(r.version, 1);
  const r2 = await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-B", ...TERMS, supplierSku: "OTHER-9" }, DEPS);
  assert.equal(r2.itemId, `${pid}__SUP-B`);
  const part = (await db.collection("parts").doc(pid).get()).data();
  assert.ok(!("cost" in part) && !("supplierId" in part));
  const audits = await db.collection("auditEvents").where("targetId", "==", r.itemId).get();
  assert.equal(audits.size, 1);
  assert.equal(part.partId, pid); // supplier additions never touch canonical identity
});
await check("create: unauthorized rejected; missing part rejected; duplicate identity conflicts; bad terms rejected", async () => {
  const pid = await newPart();
  await assert.rejects(createPartSupplierItem({ actorUid: ungranted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS), UnauthorizedActorError);
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: "P-NONE-9", supplierId: "SUP-A", ...TERMS }, DEPS), NotFoundError);
  await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS);
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s2"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS), AlreadyExistsError);
  for (const bad of [{ cost: "12.505x" }, { currency: "usd" }, { leadTimeDays: -1 }, { minOrderQty: "0" }, { contractStart: "2026-02-01", contractEnd: "2026-01-01" }, { availability: "MAYBE" }, { purchaseUnit: "CASE" } /* factor missing */]) {
    await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-C", ...TERMS, ...bad }, DEPS), InvalidInputError);
  }
});
await check("idempotency: exact replay no dup; conflicting replay rejected; abort leaves nothing", async () => {
  const pid = await newPart();
  const k = key("s");
  const r1 = await createPartSupplierItem({ actorUid: granted, idempotencyKey: k, partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS);
  const r2 = await createPartSupplierItem({ actorUid: granted, idempotencyKey: k, partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS);
  assert.equal(r2.outcome, "replayed");
  assert.equal((await db.collection("auditEvents").where("targetId", "==", r1.itemId).get()).size, 1);
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: k, partId: pid, supplierId: "SUP-A", ...TERMS, cost: "99.99" }, DEPS), IdempotencyConflictError);
  const id2 = buildSupplierItemId(pid, "SUP-Z");
  await assert.rejects(createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-Z", ...TERMS }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }));
  assert.equal((await db.collection("part_supplier_items").doc(id2).get()).exists, false);
});
await check("update: allowlisted terms only, versioned, identity/preferred immutable via update", async () => {
  const pid = await newPart();
  const r = await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS);
  await assert.rejects(updatePartSupplierItem({ actorUid: granted, idempotencyKey: key("u"), itemId: r.itemId, expectedVersion: 9, changes: { cost: "13.00" } }, DEPS), VersionConflictError);
  await assert.rejects(updatePartSupplierItem({ actorUid: granted, idempotencyKey: key("u"), itemId: r.itemId, expectedVersion: 1, changes: { partId: "P-X" } }, DEPS), InvalidInputError);
  await assert.rejects(updatePartSupplierItem({ actorUid: granted, idempotencyKey: key("u"), itemId: r.itemId, expectedVersion: 1, changes: { preferred: true } }, DEPS), InvalidInputError);
  const u = await updatePartSupplierItem({ actorUid: granted, idempotencyKey: key("u"), itemId: r.itemId, expectedVersion: 1, changes: { cost: "13.00", leadTimeDays: 10, lastVerifiedAt: new Date(1750000000000) } }, DEPS);
  assert.equal(u.version, 2);
  const doc = (await db.collection("part_supplier_items").doc(r.itemId).get()).data();
  assert.equal(doc.cost, "13.00");
  assert.equal(doc.supplierId, "SUP-A");
});
await check("status: versioned change; deactivating preferred clears preference; no delete path", async () => {
  const pid = await newPart();
  const r = await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS);
  await setPreferredSupplier({ actorUid: granted, idempotencyKey: key("p"), partId: pid, supplierId: "SUP-A", expectedVersion: 1 }, DEPS);
  const st = await changePartSupplierItemStatus({ actorUid: granted, idempotencyKey: key("st"), itemId: r.itemId, expectedVersion: 2, newStatus: "INACTIVE" }, DEPS);
  assert.equal(st.version, 3);
  const doc = (await db.collection("part_supplier_items").doc(r.itemId).get()).data();
  assert.equal(doc.status, "INACTIVE");
  assert.equal(doc.preferred, false); // cleared on deactivation
});
await check("preferred: exactly one per part, atomic handover, idempotent re-set, ACTIVE-only", async () => {
  const pid = await newPart();
  await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS);
  await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-B", ...TERMS, supplierSku: "B-1" }, DEPS);
  await setPreferredSupplier({ actorUid: granted, idempotencyKey: key("p"), partId: pid, supplierId: "SUP-A", expectedVersion: 1 }, DEPS);
  const hand = await setPreferredSupplier({ actorUid: granted, idempotencyKey: key("p"), partId: pid, supplierId: "SUP-B", expectedVersion: 1 }, DEPS);
  assert.equal(hand.version, 2);
  const a = (await db.collection("part_supplier_items").doc(`${pid}__SUP-A`).get()).data();
  const b = (await db.collection("part_supplier_items").doc(`${pid}__SUP-B`).get()).data();
  assert.equal(a.preferred, false);
  assert.equal(b.preferred, true);
  const again = await setPreferredSupplier({ actorUid: granted, idempotencyKey: key("p"), partId: pid, supplierId: "SUP-B", expectedVersion: 2 }, DEPS);
  assert.equal(again.outcome, "replayed"); // already preferred
  const stI = await changePartSupplierItemStatus({ actorUid: granted, idempotencyKey: key("st"), itemId: `${pid}__SUP-A`, expectedVersion: 3, newStatus: "INACTIVE" }, DEPS);
  await assert.rejects(setPreferredSupplier({ actorUid: granted, idempotencyKey: key("p"), partId: pid, supplierId: "SUP-A", expectedVersion: stI.version }, DEPS), InvalidInputError);
});
await check("serialization: round trip, id/identity integrity, malformed surfaced, no forbidden fields", async () => {
  const pid = await newPart();
  const r = await createPartSupplierItem({ actorUid: granted, idempotencyKey: key("s"), partId: pid, supplierId: "SUP-A", ...TERMS }, DEPS);
  const snap = await db.collection("part_supplier_items").doc(r.itemId).get();
  const stored = supplierItemFromFirestore(snap.id, snap.data());
  assert.equal(stored.partId, pid);
  assert.throws(() => supplierItemFromFirestore("WRONG", snap.data()), MalformedStoredRecordError);
  assert.throws(() => supplierItemFromFirestore(snap.id, { ...snap.data(), status: "GONE" }), MalformedStoredRecordError);
  assert.throws(() => supplierItemFromFirestore(snap.id, { ...snap.data(), supplierId: "OTHER" }), MalformedStoredRecordError);
  const doc = supplierItemToFirestore(stored);
  for (const k of ["onHand", "reserved", "tenantId", "companyId", "aiRecommendation"]) assert.ok(!(k in doc), k);
});

console.log(`\npartSupplierItems: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
