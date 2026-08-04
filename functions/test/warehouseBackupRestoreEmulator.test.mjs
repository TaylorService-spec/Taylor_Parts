// EI Phase-2 Receiving -- Gate E2-V: Firestore-emulator proof that the lossless warehouse backup/restore
// round-trips through REAL Firestore -- seed -> backup -> mutate (migration-like) -> restore -> byte/
// semantic parity, with Timestamps preserved exactly. Also proves the restore transaction FAILS CLOSED on
// identity-set drift. Requires the Firestore emulator (127.0.0.1:8080). Never touches production.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
const require = createRequire(import.meta.url);
const cli = require("../scripts/warehouseBackupRestoreCli.js");
const codec = require("../lib/warehouseGovernance/warehouseBackupCodec.js");

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const COMMIT = "a".repeat(40);
const PINS = { projectId: "taylor-parts", governedCommit: COMMIT };
const WH = "warehouses";

let passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed += 1; console.log(`PASS: ${name}`); } catch (e) { failed += 1; console.error(`FAIL: ${name}`); console.error(e); } }

// In-memory fs shim so runBackup writes the snapshot artifact without touching disk (exclusive-create).
function memFs() { const files = new Map(); return { _files: files, mkdirpSecure: () => {}, exists: (p) => files.has(p), writeFileExclusive: (p, c) => { if (files.has(p)) throw new Error(`EEXIST ${p}`); files.set(p, c); } }; }

// Real emulator-backed deps for the CLI (the same closures buildProductionDeps wires, pointed at the emulator).
function emuDeps(fs, snapshotBytesRef) {
  return {
    async readLiveWarehouses() { const s = await db.collection(WH).get(); return s.docs.map((d) => ({ warehouseId: d.id, data: d.data() })); },
    async readSnapshotRaw() { return snapshotBytesRef.value; },
    fs,
    async runRestoreTxn({ snapshot, decoded, expectedLiveSha256 }) {
      return db.runTransaction(async (txn) => {
        const liveSnap = await txn.get(db.collection(WH));
        const liveNow = liveSnap.docs.map((d) => ({ warehouseId: d.id, data: d.data() }));
        const plan = codec.planRestore(snapshot, liveNow, PINS);
        if (!plan.ok) throw new Error(`restore drift: ${plan.reason}`);
        // Content gate: current live must match the Owner-approved expected post-migration state exactly.
        if (codec.liveSetContentHash(liveNow) !== expectedLiveSha256) throw new Error("live-state content changed since the approved post-migration state");
        for (const d of decoded) txn.set(db.collection(WH).doc(d.warehouseId), d.data);
        return { restoredCount: decoded.length };
      });
    },
  };
}

async function seed(docs) { const b = db.batch(); for (const [id, data] of Object.entries(docs)) b.set(db.collection(WH).doc(id), data); await b.commit(); }
async function clearWarehouses() { const s = await db.collection(WH).get(); const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }

const TS_A = Timestamp.fromMillis(1_700_000_123_456);
const TS_B = Timestamp.fromMillis(1_699_000_000_001);
const legacy = (over = {}) => ({ id: "seed", name: "Legacy WH", location: "Dock 1", active: true, createdAt: TS_A, ...over });

await check("round-trip: seed -> backup -> migrate-mutate -> restore -> exact parity (Timestamps preserved)", async () => {
  await clearWarehouses();
  await seed({
    w1: legacy({ id: "w1", name: "Alpha", active: true, createdAt: TS_A, updatedAt: TS_B }),
    w2: legacy({ id: "w2", name: "Beta", active: false, createdAt: TS_B }),
  });
  // Backup (default) via the CLI.
  const fs = memFs();
  const backup = await cli.runBackup(emuDeps(fs, { value: null }), cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "roll"]));
  const snapshotBytes = [...fs._files.entries()].find(([k]) => k.includes("snapshot.json"))[1];
  assert.equal(backup.capturedCount, 2);

  // Migration-like mutation: overwrite w1/w2 with governed §3A records (legacy `active` removed, status set).
  await db.collection(WH).doc("w1").set({ id: "w1", name: "Alpha", location: "Dock 1", status: "ACTIVE", version: 1, updatedAt: Timestamp.now(), updatedBy: "mig", provenance: "MIGRATED", createdAt: TS_A, createdBy: "sys", governanceInitializedAt: Timestamp.now(), governanceInitializedBy: "mig" });
  await db.collection(WH).doc("w2").set({ id: "w2", name: "Beta", location: "", status: "INACTIVE", version: 1, updatedAt: Timestamp.now(), updatedBy: "mig", provenance: "MIGRATED" });

  // Capture the Owner-approved expected post-migration live-state hash, then restore from the snapshot.
  const postMig = (await db.collection(WH).get()).docs.map((d) => ({ warehouseId: d.id, data: d.data() }));
  const expectedLive = codec.liveSetContentHash(postMig);
  const ref = { value: snapshotBytes };
  const restoreArgs = cli.parseArgs(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "roll/snapshot.json", "--acknowledge-production-write", "--snapshot-sha256", backup.snapshotSha256, "--expected-live-sha256", expectedLive, "--owner-rollback-authorization", "OWNER-ROLLBACK-OK"]);
  const r = await cli.runRestore(emuDeps(memFs(), ref), restoreArgs);
  assert.equal(r.restoredCount, 2); assert.equal(r.parity.changedCount, 0);

  // Prove the live docs are byte/semantically identical to the pre-migration originals, Timestamps intact.
  const w1 = (await db.collection(WH).doc("w1").get()).data();
  assert.equal(w1.active, true); assert.equal(w1.status, undefined); // legacy shape fully restored
  assert.ok(w1.createdAt instanceof Timestamp && w1.createdAt.toMillis() === TS_A.toMillis());
  assert.ok(w1.updatedAt instanceof Timestamp && w1.updatedAt.toMillis() === TS_B.toMillis());
  const w2 = (await db.collection(WH).doc("w2").get()).data();
  assert.equal(w2.active, false); assert.ok(w2.createdAt.toMillis() === TS_B.toMillis());
});

await check("restore FAILS CLOSED on identity-set drift (a warehouse added since capture)", async () => {
  await clearWarehouses();
  await seed({ w1: legacy({ id: "w1" }) });
  const fs = memFs();
  const backup = await cli.runBackup(emuDeps(fs, { value: null }), cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "roll2"]));
  const snapshotBytes = [...fs._files.entries()].find(([k]) => k.includes("snapshot.json"))[1];
  // Someone adds w-new after capture -> live identity set drifts -> restore must fail closed (no writes).
  await db.collection(WH).doc("w-new").set(legacy({ id: "w-new" }));
  const expectedLive = codec.liveSetContentHash((await db.collection(WH).get()).docs.map((d) => ({ warehouseId: d.id, data: d.data() })));
  const restoreArgs = cli.parseArgs(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "roll2/snapshot.json", "--acknowledge-production-write", "--snapshot-sha256", backup.snapshotSha256, "--expected-live-sha256", expectedLive, "--owner-rollback-authorization", "OWNER-ROLLBACK-OK"]);
  await assert.rejects(cli.runRestore(emuDeps(memFs(), { value: snapshotBytes }), restoreArgs), /drift|parity/i);
  // w-new is still present (restore wrote nothing).
  assert.equal((await db.collection(WH).doc("w-new").get()).exists, true);
});

await check("restore FAILS CLOSED on a same-ID content change since the approved post-migration state (P1-1)", async () => {
  await clearWarehouses();
  await seed({ w1: legacy({ id: "w1", name: "Alpha" }), w2: legacy({ id: "w2", name: "Beta" }) });
  const fs = memFs();
  const backup = await cli.runBackup(emuDeps(fs, { value: null }), cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "roll3"]));
  const snapshotBytes = [...fs._files.entries()].find(([k]) => k.includes("snapshot.json"))[1];
  // Migration mutates both docs; the Owner approves THIS post-migration live-state hash.
  await db.collection(WH).doc("w1").set({ id: "w1", name: "Alpha", location: "Dock 1", status: "ACTIVE", version: 1, updatedAt: Timestamp.now(), updatedBy: "mig", provenance: "MIGRATED" });
  await db.collection(WH).doc("w2").set({ id: "w2", name: "Beta", location: "", status: "INACTIVE", version: 1, updatedAt: Timestamp.now(), updatedBy: "mig", provenance: "MIGRATED" });
  const approvedExpected = codec.liveSetContentHash((await db.collection(WH).get()).docs.map((d) => ({ warehouseId: d.id, data: d.data() })));
  // AFTER approval, a same-ID content change slips in (w2 flipped back to ACTIVE) -> live != approved.
  await db.collection(WH).doc("w2").update({ status: "ACTIVE" });
  const restoreArgs = cli.parseArgs(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "roll3/snapshot.json", "--acknowledge-production-write", "--snapshot-sha256", backup.snapshotSha256, "--expected-live-sha256", approvedExpected, "--owner-rollback-authorization", "OWNER-ROLLBACK-OK"]);
  await assert.rejects(cli.runRestore(emuDeps(memFs(), { value: snapshotBytes }), restoreArgs), /content changed/);
  // The pre-migration legacy state was NOT written back (restore wrote nothing) -> w1 still MIGRATED.
  assert.equal((await db.collection(WH).doc("w1").get()).data().provenance, "MIGRATED");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
