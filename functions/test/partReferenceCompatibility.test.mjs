// INV-1 Phase 1 PR 1.6 -- compatibility resolver + parity tests.
// Emulator + deps.roles seam (Part creation); flag exercised ONLY via the
// test-only override -- the environment gate stays OFF.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { createPart, changePartStatus } = await import("../lib/partMaster/partMasterCommands.js");
const { resolvePartReference, comparePartReferenceParity, isPartMasterReferenceEnabled } =
  await import("../lib/partMaster/partReferenceCompatibility.js");
const { getCatalogItem } = await import("../lib/data/partsCatalog.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const TEST_ROLES = Object.freeze({ pmFull: { id: "pmFull", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] } });
const actorUid = uid("actor");
await db.collection("users").doc(actorUid).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(uid("asg")).set({ id: "a", principalUid: actorUid, roleId: "pmFull", scope: { type: "global" }, grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1 });
const DEPS = { roles: TEST_ROLES, now: () => new Date(1750000000000) };
const ON = { ...DEPS, __flagOverride: true };
const OFF = { ...DEPS, __flagOverride: false };

console.log("partReferenceCompatibility.test.mjs");

await check("flag defaults OFF via environment gate", () => {
  delete process.env.PART_MASTER_REFERENCE;
  assert.equal(isPartMasterReferenceEnabled(), false);
  process.env.PART_MASTER_REFERENCE = "enabled";
  assert.equal(isPartMasterReferenceEnabled(), true);
  delete process.env.PART_MASTER_REFERENCE;
  assert.equal(isPartMasterReferenceEnabled(), false);
});
await check("OFF path identical to current static-catalog behavior (catalog + unknown ids)", async () => {
  const r = await resolvePartReference("TST-1001", OFF);
  assert.equal(r.source, "STATIC_CATALOG");
  assert.equal(r.fallbackReason, "FLAG_DISABLED");
  assert.deepEqual(r.catalogItem, getCatalogItem("TST-1001"));
  assert.equal(r.warehouseQtyBaseline, getCatalogItem("TST-1001").warehouseQty);
  const missing = await resolvePartReference("NOT-A-PART", OFF);
  assert.equal(missing.catalogItem, null);
  assert.equal(missing.warehouseQtyBaseline, 0); // exact current fallback (?? 0)
});
await check("ON + missing Part record falls back safely with identical availability output", async () => {
  const r = await resolvePartReference("TST-1002", ON);
  assert.equal(r.source, "STATIC_CATALOG");
  assert.equal(r.fallbackReason, "PART_NOT_FOUND");
  assert.equal(r.warehouseQtyBaseline, getCatalogItem("TST-1002").warehouseQty);
});
await check("ON + ACTIVE Part resolves through Part Master; baseline parity by construction", async () => {
  const pid = uid("P");
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "Compat Part", category: "Test", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
  const r = await resolvePartReference(pid, ON);
  assert.equal(r.source, "PART_MASTER");
  assert.equal(r.part.name, "Compat Part");
  assert.equal(r.part.stockingUnit, "EACH");
  // No catalog row for this id -> baseline 0 on BOTH paths:
  assert.equal(r.warehouseQtyBaseline, (await resolvePartReference(pid, OFF)).warehouseQtyBaseline);
  assert.equal(r.partId, pid); // canonical id preserved
});
await check("ON + non-ACTIVE Part falls back (PART_INACTIVE)", async () => {
  const pid = uid("P");
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "Draft Part", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  const r = await resolvePartReference(pid, ON);
  assert.equal(r.source, "STATIC_CATALOG");
  assert.equal(r.fallbackReason, "PART_INACTIVE");
});
await check("ON + malformed stored Part falls back (MALFORMED_RECORD), never throws", async () => {
  const pid = uid("P");
  await db.collection("parts").doc(pid).set({ partId: pid, name: 1234, status: "NOPE" });
  const r = await resolvePartReference(pid, ON);
  assert.equal(r.source, "STATIC_CATALOG");
  assert.equal(r.fallbackReason, "MALFORMED_RECORD");
});
await check("ON + read error falls back (READ_ERROR), never throws", async () => {
  const broken = { collection: () => { throw new Error("db down"); } };
  const r = await resolvePartReference("TST-1003", { ...ON, db: broken });
  assert.equal(r.source, "STATIC_CATALOG");
  assert.equal(r.fallbackReason, "READ_ERROR");
  assert.equal(r.warehouseQtyBaseline, getCatalogItem("TST-1003").warehouseQty);
});
await check("invalid part id shape falls back (INVALID_PART_ID)", async () => {
  const r = await resolvePartReference("has spaces!", ON);
  assert.equal(r.fallbackReason, "INVALID_PART_ID");
});
await check("parity comparator: explicit divergence surfacing, no silent drift", async () => {
  // Part Master record whose name deliberately differs from the catalog row:
  const catalogSku = "TST-1005";
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: catalogSku, internalPartNumber: catalogSku, name: "Deliberately Different", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS).catch(() => {});
  await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: catalogSku, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS).catch(() => {});
  const div = await comparePartReferenceParity([catalogSku, "TST-1006"], DEPS);
  assert.ok(div.some((d) => d.partId === catalogSku && d.field === "name"), "name divergence must be explicit");
  assert.ok(div.some((d) => d.partId === "TST-1006" && d.field === "presence"), "catalog-only rows surface as presence divergence");
});
await check("parity: equivalent records produce zero divergence", async () => {
  const sku = "TST-1010";
  const item = getCatalogItem(sku);
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: sku, internalPartNumber: sku, name: item.name, category: item.category, status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS).catch(() => {});
  await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: sku, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS).catch(() => {});
  const div = await comparePartReferenceParity([sku], DEPS);
  assert.deepEqual(div, []);
});

console.log(`\npartReferenceCompatibility: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
