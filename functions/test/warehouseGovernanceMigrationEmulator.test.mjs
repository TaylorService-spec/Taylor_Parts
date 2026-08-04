// Receiving Location Authority -- I-LA3: Firestore-emulator tests for the migration STAGING seam
// (executeMigration over a real transaction, bound to the COMPLETE live warehouse set). Requires the
// Firestore emulator (127.0.0.1:8080). Proves the governed MIGRATED write, all-or-nothing staging,
// complete-set binding (added/deleted/changed records fail closed), stale-pre-state, idempotency, and
// atomic rollback. Never touches production. Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { planMigration, executeMigration } = await import("../lib/warehouseGovernance/warehouseGovernanceMigration.js");
const { validateGovernedWarehouse } = await import("../lib/warehouseGovernance/governedWarehouseValidation.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const PINS = { projectId: "taylor-parts", governedCommit: "c".repeat(40) };
const NOW = () => new Date(1_700_000_000_000);
const COL = () => db.collection("warehouses");
const read = async (id) => (await COL().doc(id).get()).data();

// Whole-collection migration: each test starts from a clean collection so readAll() == the seeded set.
async function clearWarehouses() {
  const snap = await COL().get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
async function planAll() {
  const snap = await COL().get();
  return planMigration(snap.docs.map((d) => ({ warehouseId: d.id, data: d.data() })), PINS);
}
// Mirror the CLI's transaction: executeMigration re-reads the COMPLETE set THROUGH the txn and buffers
// writes; we flush them with txn.set at the end (all-or-nothing). afterStageHook lets a test abort post-stage.
async function runMigrationTxn(plan, manifest, { afterStageHook } = {}) {
  return db.runTransaction(async (txn) => {
    const staged = [];
    const store = {
      async readAll() { const s = await txn.get(COL()); return s.docs.map((d) => ({ warehouseId: d.id, data: d.data() })); },
      stage(id, record) { staged.push({ id, record }); },
    };
    const result = await executeMigration({ plan, manifest, store, actorId: "tool:migration", now: NOW });
    for (const s of staged) txn.set(COL().doc(s.id), s.record);
    if (afterStageHook) await afterStageHook(staged);
    return result;
  });
}

await check("execute: legacy records become governed MIGRATED §3A records; active removed; created preserved", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L", active: false, createdAt: Timestamp.fromMillis(111), createdBy: "legacy" });
  await COL().doc("b").set({ id: "b", name: "B", location: "L" });
  const res = await runMigrationTxn(await planAll(), {});
  assert.deepEqual(res.counts, { migrated: 2, skippedGoverned: 0 });
  const da = await read("a");
  assert.equal(da.provenance, "MIGRATED");
  assert.equal(da.version, 1);
  assert.equal(da.status, "INACTIVE");
  assert.ok(da.governanceInitializedAt instanceof Timestamp && da.governanceInitializedBy === "tool:migration");
  assert.equal(da.createdBy, "legacy");
  assert.ok(!Object.prototype.hasOwnProperty.call(da, "active"), "legacy active removed");
  assert.equal(validateGovernedWarehouse(da, "a").valid, true);
  assert.equal((await read("b")).status, "ACTIVE");
});

await check("execute: idempotent rerun stages nothing (already governed, byte-stable)", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L", active: true });
  await runMigrationTxn(await planAll(), {});
  const afterFirst = await read("a");
  const res2 = await runMigrationTxn(await planAll(), {});
  assert.deepEqual(res2.counts, { migrated: 0, skippedGoverned: 1 });
  assert.deepEqual(await read("a"), afterFirst, "byte-stable on rerun");
});

await check("execute: a planned record CHANGED after dry-run -> zero writes", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L" });
  const plan = await planAll();
  await COL().doc("a").update({ name: "A-CHANGED" }); // drift after dry-run
  const before = await read("a");
  await assert.rejects(runMigrationTxn(plan, {}), (e) => e.code === "STALE_PRESTATE");
  assert.deepEqual(await read("a"), before, "no write under stale pre-state");
});

await check("execute: a GOVERNED record changed after dry-run -> zero writes (governed re-checked)", async () => {
  await clearWarehouses();
  await COL().doc("g").set({ id: "g", name: "G", location: "L", status: "ACTIVE", version: 1, updatedAt: Timestamp.fromMillis(5), updatedBy: "u", provenance: "NATIVE", createdAt: Timestamp.fromMillis(5), createdBy: "u" });
  const plan = await planAll();
  assert.equal(plan.counts.governed, 1);
  await COL().doc("g").update({ name: "G-CHANGED" });
  const before = await read("g");
  await assert.rejects(runMigrationTxn(plan, {}), (e) => e.code === "STALE_PRESTATE");
  assert.deepEqual(await read("g"), before);
});

await check("execute: a record DELETED after dry-run -> zero writes (LIVE_SET_DRIFT)", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L" });
  await COL().doc("b").set({ id: "b", name: "B", location: "L" });
  const plan = await planAll();
  await COL().doc("b").delete(); // one planned record removed
  const before = await read("a");
  await assert.rejects(runMigrationTxn(plan, {}), (e) => e.code === "LIVE_SET_DRIFT");
  assert.deepEqual(await read("a"), before, "no partial migration of the surviving record");
});

await check("execute: a NEW warehouse added after dry-run -> zero writes (LIVE_SET_DRIFT)", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L" });
  const plan = await planAll();
  await COL().doc("newbie").set({ id: "newbie", name: "N", location: "L" }); // absent from the plan
  const before = await read("a");
  await assert.rejects(runMigrationTxn(plan, {}), (e) => e.code === "LIVE_SET_DRIFT");
  assert.deepEqual(await read("a"), before);
});

await check("execute: the SECOND of multiple records drifts -> zero writes", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L" });
  await COL().doc("b").set({ id: "b", name: "B", location: "L" });
  const plan = await planAll();
  await COL().doc("b").update({ name: "B-CHANGED" });
  const beforeA = await read("a");
  await assert.rejects(runMigrationTxn(plan, {}), (e) => e.code === "STALE_PRESTATE");
  assert.deepEqual(await read("a"), beforeA, "first record not migrated either");
});

await check("execute: ambiguous without manifest -> zero writes (whole-set validation before staging)", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L" });
  await COL().doc("b").set({ id: "b", name: "B", location: "L", status: "ACTIVE", active: false }); // ambiguous
  const plan = await planAll();
  const beforeA = await read("a"); const beforeB = await read("b");
  await assert.rejects(runMigrationTxn(plan, { projectId: PINS.projectId, governedCommit: PINS.governedCommit, entries: [] }), (e) => e.code === "MANIFEST_INVALID");
  assert.deepEqual(await read("a"), beforeA);
  assert.deepEqual(await read("b"), beforeB);
});

await check("execute: atomic rollback -- a failure after staging aborts the whole transaction", async () => {
  await clearWarehouses();
  await COL().doc("a").set({ id: "a", name: "A", location: "L", active: false });
  const before = await read("a");
  await assert.rejects(runMigrationTxn(await planAll(), {}, { afterStageHook: () => { throw new Error("boom-after-stage"); } }), /boom-after-stage/);
  assert.deepEqual(await read("a"), before, "transaction rolled back; no migration persisted");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
