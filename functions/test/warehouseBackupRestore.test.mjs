// EI Phase-2 Receiving -- Gate E2-V: OFFLINE proof of the backup/restore OPERATOR CLI (parseArgs guards +
// injected-deps backup/restore orchestration + fail-closed hash/drift). No firebase-admin, no production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Timestamp } from "firebase-admin/firestore";
const require = createRequire(import.meta.url);
const cli = require("../scripts/warehouseBackupRestoreCli.js");
const codec = require("../lib/warehouseGovernance/warehouseBackupCodec.js");

let passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed += 1; console.log(`PASS: ${name}`); } catch (e) { failed += 1; console.error(`FAIL: ${name}`); console.error(e); } }
const COMMIT = "a".repeat(40);
const TS = Timestamp.fromMillis(1_700_000_123_456);
const gov = (id, over = {}) => ({ id, name: "N", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "MIGRATED", createdAt: TS, createdBy: "u", ...over });
const live = (id, data) => ({ warehouseId: id, data });

function memFs() {
  const files = new Map();
  return { _files: files, mkdirpSecure: () => {}, exists: (p) => files.has(p), writeFileSecure: (p, c) => files.set(p, c) };
}

await check("parseArgs: backup requires --out-dir; project/commit pinned", () => {
  assert.throws(() => cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT]));           // no --out-dir
  assert.throws(() => cli.parseArgs(["--project", "other", "--commit", COMMIT, "--out-dir", "d"])); // wrong project
  assert.throws(() => cli.parseArgs(["--project", "taylor-parts", "--commit", "short", "--out-dir", "d"]));
  const a = cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "d"]);
  assert.equal(a.restore, false); assert.equal(a.outDir, "d");
});

await check("parseArgs: restore requires ack + snapshot + sha256 + owner authorization", () => {
  const base = ["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "s.json"];
  assert.throws(() => cli.parseArgs(base));                                                 // no ack
  assert.throws(() => cli.parseArgs([...base, "--acknowledge-production-write"]));          // no sha256
  assert.throws(() => cli.parseArgs([...base, "--acknowledge-production-write", "--snapshot-sha256", "z".repeat(64)])); // no owner auth
  const ok = cli.parseArgs([...base, "--acknowledge-production-write", "--snapshot-sha256", "a".repeat(64), "--owner-rollback-authorization", "OWNER-OK"]);
  assert.equal(ok.restore, true);
});

await check("runBackup: encodes + writes snapshot + sha256; refuses to overwrite", async () => {
  const fs = memFs();
  const deps = { readLiveWarehouses: async () => [live("w1", gov("w1")), live("w2", gov("w2", { status: "INACTIVE" }))], fs };
  const args = cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "roll"]);
  const r = await cli.runBackup(deps, args);
  assert.equal(r.mode, "backup"); assert.equal(r.capturedCount, 2);
  assert.match(r.snapshotSha256, /^[0-9a-f]{64}$/);
  assert.equal([...fs._files.keys()].filter((k) => k.includes("snapshot.json")).length, 1);
  // second backup into the same dir refuses (snapshot.json already exists).
  await assert.rejects(cli.runBackup(deps, args), /refusing to overwrite/);
});

// Build a valid snapshot artifact the way runBackup would (bytes + hash) for restore tests.
function makeSnapshotArtifact(set) {
  const snapshot = codec.encodeSnapshot(set, { projectId: "taylor-parts", governedCommit: COMMIT });
  const bytes = JSON.stringify(snapshot, null, 2) + "\n";
  const crypto = require("node:crypto");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  return { snapshot, bytes, hash };
}

await check("runRestore: hash mismatch fails closed (zero writes)", async () => {
  const { bytes } = makeSnapshotArtifact([live("w1", gov("w1"))]);
  let wrote = false;
  const deps = { readSnapshotRaw: async () => bytes, readLiveWarehouses: async () => [live("w1", gov("w1"))], runRestoreTxn: async () => { wrote = true; return { restoredCount: 1 }; } };
  const args = cli.parseArgs(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "s.json", "--acknowledge-production-write", "--snapshot-sha256", "b".repeat(64), "--owner-rollback-authorization", "OWNER-OK"]);
  await assert.rejects(cli.runRestore(deps, args), /snapshot hash mismatch/);
  assert.equal(wrote, false);
});

await check("runRestore: SUCCESS path -> restores + post-restore parity holds", async () => {
  const set = [live("w1", gov("w1")), live("w2", gov("w2"))];
  const { bytes, hash } = makeSnapshotArtifact(set);
  // Simulate: live is currently MIGRATED (differs); restore txn returns; after == snapshot content.
  let restored = null;
  const deps = {
    readSnapshotRaw: async () => bytes,
    // runRestore reads live ONCE, for post-restore parity: after a faithful restore, live == snapshot.
    readLiveWarehouses: async () => set,
    runRestoreTxn: async ({ decoded }) => { restored = decoded; return { restoredCount: decoded.length }; },
  };
  const args = cli.parseArgs(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "s.json", "--acknowledge-production-write", "--snapshot-sha256", hash, "--owner-rollback-authorization", "OWNER-OK"]);
  const r = await cli.runRestore(deps, args);
  assert.equal(r.mode, "restore"); assert.equal(r.restoredCount, 2); assert.equal(r.parity.changedCount, 0);
  assert.ok(restored[0].data.updatedAt instanceof Timestamp); // decoded to real Timestamps for the write
});

await check("runRestore: post-restore parity failure (live still differs) fails closed", async () => {
  const set = [live("w1", gov("w1"))];
  const { bytes, hash } = makeSnapshotArtifact(set);
  const deps = {
    readSnapshotRaw: async () => bytes,
    readLiveWarehouses: async () => [live("w1", gov("w1", { status: "INACTIVE" }))], // never matches snapshot
    runRestoreTxn: async ({ decoded }) => ({ restoredCount: decoded.length }),
  };
  const args = cli.parseArgs(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "s.json", "--acknowledge-production-write", "--snapshot-sha256", hash, "--owner-rollback-authorization", "OWNER-OK"]);
  await assert.rejects(cli.runRestore(deps, args), /parity failed/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
