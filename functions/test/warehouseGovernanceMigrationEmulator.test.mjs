// Receiving Location Authority -- I-LA3: Firestore-emulator tests for the migration STAGING seam
// (executeMigration over a real transaction). Requires the Firestore emulator (127.0.0.1:8080). Proves
// the governed MIGRATED write, all-or-nothing staging, stale-pre-state fail-closed, idempotency, and
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
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const PINS = { projectId: "taylor-parts", governedCommit: "c".repeat(40) };
const NOW = () => new Date(1_700_000_000_000);
const read = async (id) => (await db.collection("warehouses").doc(id).get()).data();

async function planFor(ids) {
  const live = [];
  for (const id of ids) { const d = await read(id); live.push({ warehouseId: id, data: d }); }
  return planMigration(live, PINS);
}
// Mirror the CLI's transaction: executeMigration re-reads THROUGH the txn and buffers writes; we flush
// them with txn.set at the end (all-or-nothing). An optional afterStageHook lets a test abort post-stage.
async function runMigrationTxn(plan, manifest, { afterStageHook } = {}) {
  return db.runTransaction(async (txn) => {
    const staged = [];
    const store = {
      async reRead(id) { const s = await txn.get(db.collection("warehouses").doc(id)); return s.exists ? s.data() : null; },
      stage(id, record) { staged.push({ id, record }); },
    };
    const result = await executeMigration({ plan, manifest, store, actorId: "tool:migration", now: NOW });
    for (const s of staged) txn.set(db.collection("warehouses").doc(s.id), s.record);
    if (afterStageHook) await afterStageHook(staged);
    return result;
  });
}

await check("execute: legacy records become governed MIGRATED §3A records; active removed; created preserved", async () => {
  const a = nextId("wh"); const b = nextId("wh");
  await db.collection("warehouses").doc(a).set({ id: a, name: "A", location: "L", active: false, createdAt: Timestamp.fromMillis(111), createdBy: "legacy" });
  await db.collection("warehouses").doc(b).set({ id: b, name: "B", location: "L" }); // missing status + no active
  const plan = await planFor([a, b]);
  const res = await runMigrationTxn(plan, {});
  assert.deepEqual(res.counts, { migrated: 2, skippedGoverned: 0 });
  const da = await read(a);
  assert.equal(da.provenance, "MIGRATED");
  assert.equal(da.version, 1);
  assert.equal(da.status, "INACTIVE"); // active:false -> INACTIVE
  assert.ok(da.governanceInitializedAt instanceof Timestamp && da.governanceInitializedBy === "tool:migration");
  assert.equal(da.createdBy, "legacy"); // authentic pair preserved
  assert.ok(!Object.prototype.hasOwnProperty.call(da, "active"), "legacy active removed");
  assert.equal(validateGovernedWarehouse(da, a).valid, true);
  assert.equal((await read(b)).status, "ACTIVE");
});

await check("execute: idempotent rerun stages nothing (already governed)", async () => {
  const a = nextId("wh");
  await db.collection("warehouses").doc(a).set({ id: a, name: "A", location: "L", active: true });
  await runMigrationTxn(await planFor([a]), {});
  const afterFirst = await read(a);
  // rerun: plan now sees a governed record -> GOVERNED no-op
  const res2 = await runMigrationTxn(await planFor([a]), {});
  assert.deepEqual(res2.counts, { migrated: 0, skippedGoverned: 1 });
  assert.deepEqual(await read(a), afterFirst, "byte-stable on rerun");
});

await check("execute: stale pre-state (doc changed after dry-run) -> zero writes", async () => {
  const a = nextId("wh");
  await db.collection("warehouses").doc(a).set({ id: a, name: "A", location: "L" });
  const plan = await planFor([a]); // fingerprint captured
  await db.collection("warehouses").doc(a).update({ name: "A-CHANGED" }); // drift after dry-run
  const before = await read(a);
  await assert.rejects(runMigrationTxn(plan, {}), (e) => e.code === "STALE_PRESTATE");
  assert.deepEqual(await read(a), before, "no write under stale pre-state");
});

await check("execute: ambiguous without manifest -> zero writes (whole-set validation before staging)", async () => {
  const a = nextId("wh"); const b = nextId("wh");
  await db.collection("warehouses").doc(a).set({ id: a, name: "A", location: "L" });                              // derive
  await db.collection("warehouses").doc(b).set({ id: b, name: "B", location: "L", status: "ACTIVE", active: false }); // ambiguous
  const plan = await planFor([a, b]);
  const beforeA = await read(a); const beforeB = await read(b);
  await assert.rejects(runMigrationTxn(plan, { projectId: PINS.projectId, governedCommit: PINS.governedCommit, entries: [] }), (e) => e.code === "MANIFEST_INVALID");
  assert.deepEqual(await read(a), beforeA, "no partial migration of the derivable record");
  assert.deepEqual(await read(b), beforeB);
});

await check("execute: atomic rollback -- a failure after staging aborts the whole transaction", async () => {
  const a = nextId("wh");
  await db.collection("warehouses").doc(a).set({ id: a, name: "A", location: "L", active: false });
  const before = await read(a);
  await assert.rejects(runMigrationTxn(await planFor([a]), {}, { afterStageHook: () => { throw new Error("boom-after-stage"); } }), /boom-after-stage/);
  assert.deepEqual(await read(a), before, "transaction rolled back; no migration persisted");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
