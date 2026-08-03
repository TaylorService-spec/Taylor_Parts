// Receiving Location Authority -- I-LA2: Firestore-emulator tests for the trusted warehouse-status
// writer (functions/src/warehouseGovernance/warehouseStatusWriter.ts). Requires the Firestore emulator
// (127.0.0.1:8080). Imports the compiled ../lib output. The server-derived actor is TRUSTED command
// context (deps.actor), never in the untrusted request. Authorization + audit are injected seams.
// Never touches production. Prerequisite: npm run build; emulator running (npm run test:warehouseStatusWriter).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const w = await import("../lib/warehouseGovernance/warehouseStatusWriter.js");
const {
  createWarehouse,
  setWarehouseStatus,
  UnauthorizedWarehouseWriteError,
  InvalidWarehouseRequestError,
  WarehouseAlreadyExistsError,
  WarehouseNotFoundError,
  MalformedWarehouseRecordError,
  WarehouseVersionConflictError,
} = w;
const { validateGovernedWarehouse } = await import("../lib/warehouseGovernance/governedWarehouseValidation.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);
const LATER = new Date(1_700_000_900_000);

const GRANTS = "warehouse_writer_grants";
async function seedActor({ grant = true } = {}) {
  const actorId = nextId("actor");
  if (grant) await db.collection(GRANTS).doc(actorId).set({ granted: true });
  return actorId;
}
function makeDeps(actorId, over = {}) {
  const audits = [];
  const deps = {
    db,
    actor: { kind: "USER", id: actorId },
    authorize: async (txn, id) => { const s = await txn.get(db.collection(GRANTS).doc(id)); return s.exists && s.data().granted === true; },
    stageAudit: (txn, audit) => { audits.push(audit); txn.create(db.collection("warehouse_audit_test").doc(nextId("aud")), { ...audit, at: FieldValue.serverTimestamp() }); },
    now: () => NOW,
    ...over,
  };
  return { deps, audits };
}
const read = async (id) => (await db.collection("warehouses").doc(id).get()).data();
// A SEPARATE Firestore connection used to mutate a grant mid-transaction (commit-time revocation).
const revoker = admin.initializeApp({ projectId: "taylor-parts" }, "revoker").firestore();
const auditCount = async (id) => (await db.collection("warehouse_audit_test").where("warehouseId", "==", id).get()).size;

// ---- CREATE ---------------------------------------------------------------------------------------
await check("create: governed NATIVE record (v1, ACTIVE, provenance, server metadata, NO active) + audit", async () => {
  const actorId = await seedActor();
  const id = nextId("wh");
  const { deps, audits } = makeDeps(actorId);
  const out = await createWarehouse({ warehouseId: id, name: "Main", location: "Dallas" }, deps);
  assert.deepEqual(out, { outcome: "created", warehouseId: id, version: 1 });
  const doc = await read(id);
  assert.equal(doc.status, "ACTIVE");
  assert.equal(doc.version, 1);
  assert.equal(doc.provenance, "NATIVE");
  assert.equal(doc.createdBy, actorId);
  assert.equal(doc.updatedBy, actorId);
  assert.ok(doc.createdAt instanceof Timestamp && doc.updatedAt instanceof Timestamp);
  assert.ok(!Object.prototype.hasOwnProperty.call(doc, "active"), "no legacy active field");
  assert.ok(!Object.prototype.hasOwnProperty.call(doc, "governanceInitializedAt"), "NATIVE has no governanceInitialized*");
  // the persisted record passes the shared §3A validator bound to its id
  assert.equal(validateGovernedWarehouse(doc, id).valid, true);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { action: "createWarehouse", actorId, warehouseId: id, fromStatus: null, toStatus: "ACTIVE", version: 1 });
});

await check("create: duplicate id fails ALREADY_EXISTS, does not overwrite", async () => {
  const actorId = await seedActor();
  const id = nextId("wh");
  const { deps } = makeDeps(actorId);
  await createWarehouse({ warehouseId: id, name: "A", location: "L" }, deps);
  await assert.rejects(createWarehouse({ warehouseId: id, name: "B", location: "M" }, deps), WarehouseAlreadyExistsError);
  assert.equal((await read(id)).name, "A");
});

await check("create: invalid request -> INVALID_REQUEST", async () => {
  const actorId = await seedActor();
  const { deps } = makeDeps(actorId);
  for (const bad of [null, {}, { warehouseId: "", name: "n", location: "l" }, { warehouseId: "x", name: "  ", location: "l" }, { warehouseId: "x", name: "n", location: 7 }]) {
    await assert.rejects(createWarehouse(bad, deps), InvalidWarehouseRequestError);
  }
});

await check("create: unauthorized -> PERMISSION_DENIED, nothing written", async () => {
  const actorId = await seedActor({ grant: false });
  const id = nextId("wh");
  const { deps, audits } = makeDeps(actorId);
  await assert.rejects(createWarehouse({ warehouseId: id, name: "n", location: "l" }, deps), UnauthorizedWarehouseWriteError);
  assert.equal(await read(id), undefined);
  assert.equal(audits.length, 0);
});

// ---- TRANSITIONS ----------------------------------------------------------------------------------
async function seedGoverned(actorId, over = {}) {
  const id = nextId("wh");
  const { deps } = makeDeps(actorId);
  await createWarehouse({ warehouseId: id, name: "N", location: "L" }, deps);
  if (Object.keys(over).length) await db.collection("warehouses").doc(id).update(over);
  return id;
}

await check("transition ACTIVE->INACTIVE: version +1 exactly, updated refreshed, created/provenance preserved, audit", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const before = await read(id);
  const { deps, audits } = makeDeps(actorId, { now: () => LATER });
  const out = await setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "INACTIVE" }, deps);
  assert.deepEqual(out, { outcome: "transitioned", warehouseId: id, version: 2 });
  const after = await read(id);
  assert.equal(after.status, "INACTIVE");
  assert.equal(after.version, 2);
  assert.equal(after.updatedBy, actorId);
  assert.equal(after.updatedAt.toMillis(), LATER.getTime());
  assert.equal(after.createdAt.toMillis(), before.createdAt.toMillis(), "createdAt preserved");
  assert.equal(after.provenance, "NATIVE");
  assert.deepEqual(audits[0], { action: "setWarehouseStatus", actorId, warehouseId: id, fromStatus: "ACTIVE", toStatus: "INACTIVE", version: 2 });
  assert.equal(validateGovernedWarehouse(after, id).valid, true);
});

await check("transition INACTIVE->ACTIVE reinstate advances version once", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const { deps } = makeDeps(actorId);
  await setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "INACTIVE" }, deps);
  const out = await setWarehouseStatus({ warehouseId: id, expectedVersion: 2, targetStatus: "ACTIVE" }, deps);
  assert.deepEqual(out, { outcome: "transitioned", warehouseId: id, version: 3 });
  assert.equal((await read(id)).status, "ACTIVE");
});

await check("idempotent no-op: same target status -> no version bump, no write, no audit", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const { deps, audits } = makeDeps(actorId, { now: () => LATER });
  const out = await setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "ACTIVE" }, deps);
  assert.deepEqual(out, { outcome: "noop", warehouseId: id, version: 1 });
  const after = await read(id);
  assert.equal(after.version, 1);
  assert.equal(after.updatedAt.toMillis(), NOW.getTime(), "updatedAt NOT refreshed on no-op");
  assert.equal(audits.length, 0);
});

await check("stale expectedVersion -> VERSION_CONFLICT, nothing written", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const { deps, audits } = makeDeps(actorId);
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 99, targetStatus: "INACTIVE" }, deps), WarehouseVersionConflictError);
  assert.equal((await read(id)).version, 1);
  assert.equal(audits.length, 0);
});

await check("invalid targetStatus / expectedVersion -> INVALID_REQUEST", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const { deps } = makeDeps(actorId);
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "RETIRED" }, deps), InvalidWarehouseRequestError);
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 0, targetStatus: "INACTIVE" }, deps), InvalidWarehouseRequestError);
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 1.5, targetStatus: "INACTIVE" }, deps), InvalidWarehouseRequestError);
});

await check("transition on missing warehouse -> NOT_FOUND", async () => {
  const actorId = await seedActor();
  const { deps } = makeDeps(actorId);
  await assert.rejects(setWarehouseStatus({ warehouseId: nextId("nope"), expectedVersion: 1, targetStatus: "INACTIVE" }, deps), WarehouseNotFoundError);
});

await check("transition on UNGOVERNED/legacy record -> MALFORMED_RECORD (writer never initializes history)", async () => {
  const actorId = await seedActor();
  // legacy doc written directly (bypassing the writer): no version/provenance, carries active
  const id = nextId("wh");
  await db.collection("warehouses").doc(id).set({ id, name: "Legacy", location: "L", active: true });
  const { deps, audits } = makeDeps(actorId);
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "INACTIVE" }, deps), MalformedWarehouseRecordError);
  // unchanged
  assert.equal((await read(id)).active, true);
  assert.equal(audits.length, 0);
});

await check("transition unauthorized -> PERMISSION_DENIED, nothing written", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  // revoke the grant, then attempt
  await db.collection(GRANTS).doc(actorId).delete();
  const { deps, audits } = makeDeps(actorId);
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "INACTIVE" }, deps), UnauthorizedWarehouseWriteError);
  assert.equal((await read(id)).status, "ACTIVE");
  assert.equal(audits.length, 0);
});

// ---- ATOMICITY / ROLLBACK -------------------------------------------------------------------------
await check("rollback: a throwing stageAudit aborts the whole transaction (no create)", async () => {
  const actorId = await seedActor();
  const id = nextId("wh");
  const { deps } = makeDeps(actorId, { stageAudit: () => { throw new Error("boom-audit"); } });
  await assert.rejects(createWarehouse({ warehouseId: id, name: "n", location: "l" }, deps), /boom-audit/);
  assert.equal(await read(id), undefined, "no partial create");
});

await check("rollback: a throwing stageAudit aborts a transition (status/version unchanged)", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const { deps } = makeDeps(actorId, { stageAudit: () => { throw new Error("boom-audit-2"); } });
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "INACTIVE" }, deps), /boom-audit-2/);
  const after = await read(id);
  assert.equal(after.status, "ACTIVE");
  assert.equal(after.version, 1);
});

await check("trusted actor context required (missing/invalid actor -> PERMISSION_DENIED)", async () => {
  const { deps } = makeDeps("x");
  const bad = { ...deps, actor: { kind: "USER", id: "" } };
  await assert.rejects(createWarehouse({ warehouseId: nextId("wh"), name: "n", location: "l" }, bad), UnauthorizedWarehouseWriteError);
  const bad2 = { ...deps, actor: { kind: "ROBOT", id: "r" } };
  await assert.rejects(setWarehouseStatus({ warehouseId: "x", expectedVersion: 1, targetStatus: "ACTIVE" }, bad2), UnauthorizedWarehouseWriteError);
});

// ---- P2-1: COMMIT-TIME AUTHORIZATION REVOCATION -------------------------------------------------
// authorize reads the grant THROUGH the txn; a separate connection revokes it after that read but
// before commit. The read doc changed under the txn, so Firestore retries; on retry authorize sees
// the revoked grant and the command fails closed. Either way: ZERO writes commit. The revoke hook is
// one-shot so it never re-mutates on a transaction retry.
await check("commit-time revocation: grant revoked after auth read -> create does not commit (zero writes)", async () => {
  const actorId = await seedActor();
  const id = nextId("wh");
  let revoked = false;
  const { deps } = makeDeps(actorId, {
    __afterAuthReadHook: async () => { if (!revoked) { revoked = true; await revoker.collection(GRANTS).doc(actorId).delete(); } },
  });
  await assert.rejects(createWarehouse({ warehouseId: id, name: "n", location: "l" }, deps));
  assert.equal(await read(id), undefined, "no warehouse created under stale authorization");
  assert.equal(await auditCount(id), 0, "no applied audit under stale authorization");
});

await check("commit-time revocation: grant revoked after auth read -> transition does not commit (unchanged)", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const auditsBefore = await auditCount(id); // the create audit
  let revoked = false;
  const { deps } = makeDeps(actorId, {
    now: () => LATER,
    __afterAuthReadHook: async () => { if (!revoked) { revoked = true; await revoker.collection(GRANTS).doc(actorId).delete(); } },
  });
  await assert.rejects(setWarehouseStatus({ warehouseId: id, expectedVersion: 1, targetStatus: "INACTIVE" }, deps));
  const after = await read(id);
  assert.equal(after.status, "ACTIVE");
  assert.equal(after.version, 1);
  assert.equal(after.updatedAt.toMillis(), NOW.getTime(), "updated metadata unchanged");
  assert.equal(await auditCount(id), auditsBefore, "no transition audit under stale authorization");
});

// ---- P2-2: UNTRUSTED REQUEST ENVELOPES FAIL CLOSED ON UNKNOWN FIELDS -----------------------------
await check("create: embedded actor / server-owned / overrides / arbitrary fields -> INVALID_REQUEST, zero writes", async () => {
  const actorId = await seedActor();
  const { deps } = makeDeps(actorId);
  const id = nextId("wh");
  const base = { warehouseId: id, name: "n", location: "l" };
  const bads = [
    { ...base, actor: { kind: "USER", id: "evil" } },
    { ...base, createdAt: 1, createdBy: "x" },
    { ...base, updatedAt: 1, updatedBy: "x" },
    { ...base, status: "INACTIVE" },
    { ...base, version: 5 },
    { ...base, provenance: "MIGRATED" },
    { ...base, active: false },
    { ...base, governanceInitializedAt: 1, governanceInitializedBy: "x" },
    { ...base, whatever: 1 },
  ];
  for (const bad of bads) {
    await assert.rejects(createWarehouse(bad, deps), InvalidWarehouseRequestError);
  }
  assert.equal(await read(id), undefined, "no warehouse created from a rejected envelope");
  assert.equal(await auditCount(id), 0);
});

await check("setWarehouseStatus: embedded actor / server-owned / overrides / arbitrary fields -> INVALID_REQUEST, zero writes", async () => {
  const actorId = await seedActor();
  const id = await seedGoverned(actorId);
  const auditsBefore = await auditCount(id);
  const { deps } = makeDeps(actorId);
  const base = { warehouseId: id, expectedVersion: 1, targetStatus: "INACTIVE" };
  const bads = [
    { ...base, actor: { kind: "USER", id: "evil" } },
    { ...base, updatedAt: 1, updatedBy: "x" },
    { ...base, version: 9 },
    { ...base, provenance: "NATIVE" },
    { ...base, active: true },
    { ...base, status: "ACTIVE" }, // 'status' is not an allowed key (targetStatus is)
    { ...base, whatever: 1 },
  ];
  for (const bad of bads) {
    await assert.rejects(setWarehouseStatus(bad, deps), InvalidWarehouseRequestError);
  }
  const after = await read(id);
  assert.equal(after.status, "ACTIVE");
  assert.equal(after.version, 1);
  assert.equal(await auditCount(id), auditsBefore, "no transition audit from rejected envelopes");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
