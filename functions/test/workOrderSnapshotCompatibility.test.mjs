// INV-1 Phase 1 PR 1.7 -- WO snapshot compatibility tests (emulator +
// deps.roles seam; PR 1.6 flag exercised only via test override).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { createPart, changePartStatus, updatePart } = await import("../lib/partMaster/partMasterCommands.js");
const { enrichSnapshotItem, enrichInventorySnapshot, snapshotItemPartReference } =
  await import("../lib/partMaster/workOrderSnapshotCompatibility.js");

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
async function activePart(pid) {
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "Snap Part", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
}
const ITEM = (sku, extra = {}) => ({ sku, name: "Widget", qtyPlanned: 2, category: "Test", ...extra });

console.log("workOrderSnapshotCompatibility.test.mjs");

await check("flag OFF + no aliases: byte-identical passthrough (current behavior)", async () => {
  const item = ITEM("TST-1001", { notes: "keep me", qtyUsed: 1 });
  const r = await enrichSnapshotItem(item, OFF);
  assert.equal(r.outcome, "UNRESOLVED");
  assert.deepEqual(r.item, item); // shape + fields untouched, no partId added
});
await check("canonical grandfathered sku resolves; original fields preserved verbatim", async () => {
  const pid = uid("P");
  await activePart(pid);
  const item = ITEM(pid, { notes: "historic note" });
  const r = await enrichSnapshotItem(item, ON);
  assert.equal(r.outcome, "CANONICAL_PART");
  assert.equal(r.item.partId, pid);
  const { partId, ...rest } = r.item;
  assert.deepEqual(rest, item); // every existing field unchanged
});
await check("renumbered part: historical sku resolves via INTERNAL_PN alias backfill", async () => {
  const pid = uid("P");
  await activePart(pid);
  await updatePart({ actorUid, idempotencyKey: key("u"), partId: pid, expectedVersion: 2, changes: { internalPartNumber: `NEW-${pid}` } }, DEPS);
  // the OLD number (== pid) is now an alias; a snapshot bearing it resolves:
  const r = await enrichSnapshotItem(ITEM(pid), OFF); // alias path is flag-independent
  assert.equal(r.outcome, "ALIAS_INTERNAL_PN");
  assert.equal(r.item.partId, pid);
});
await check("inactive part: falls back to alias path or passthrough, never lifecycle change", async () => {
  const pid = uid("P");
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "Draft", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  const r = await enrichSnapshotItem(ITEM(pid), ON); // DRAFT -> resolver falls back
  assert.equal(r.outcome, "UNRESOLVED");
  assert.ok(!("partId" in r.item));
});
await check("malformed/missing sku and resolver errors: safe passthrough", async () => {
  assert.equal((await enrichSnapshotItem({ name: "no sku" }, ON)).outcome, "UNRESOLVED");
  assert.equal((await enrichSnapshotItem(ITEM("bad sku!!"), ON)).outcome, "UNRESOLVED");
  const broken = { ...ON, db: { collection: () => { throw new Error("down"); } } };
  const r = await enrichSnapshotItem(ITEM("TST-1001"), broken);
  assert.equal(r.outcome, "UNRESOLVED");
  assert.deepEqual(r.item, ITEM("TST-1001"));
});
await check("array enrichment: order preserved, items independent, non-arrays -> []", async () => {
  const pid = uid("P");
  await activePart(pid);
  const out = await enrichInventorySnapshot([ITEM(pid), ITEM("UNKNOWN-1")], ON);
  assert.equal(out.length, 2);
  assert.equal(out[0].outcome, "CANONICAL_PART");
  assert.equal(out[1].outcome, "UNRESOLVED");
  assert.deepEqual(await enrichInventorySnapshot(undefined, ON), []);
});
await check("historical read compatibility: items with and without partId both readable", () => {
  const legacy = snapshotItemPartReference(ITEM("TST-1001"));
  assert.deepEqual(legacy, { partId: null, legacySku: "TST-1001" });
  const modern = snapshotItemPartReference({ ...ITEM("TST-1001"), partId: "TST-1001" });
  assert.deepEqual(modern, { partId: "TST-1001", legacySku: "TST-1001" });
});
await check("parity: enrichment is additive-only -- no field mutated, no quantity touched", async () => {
  const pid = uid("P");
  await activePart(pid);
  const item = ITEM(pid, { qtyPlanned: 7, qtyUsed: 3 });
  const r = await enrichSnapshotItem(item, ON);
  assert.equal(r.item.qtyPlanned, 7);
  assert.equal(r.item.qtyUsed, 3);
  assert.equal(r.item.name, item.name);
});

console.log(`\nworkOrderSnapshotCompatibility: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
