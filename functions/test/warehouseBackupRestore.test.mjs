// EI Phase-2 Receiving -- Gate E2-V: OFFLINE proof of the backup/restore OPERATOR CLI (parseArgs guards +
// injected-deps backup/restore orchestration + fail-closed hash/drift). No firebase-admin, no production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Timestamp } from "firebase-admin/firestore";
import { getApps } from "firebase-admin/app";
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
  return {
    _files: files, mkdirpSecure: () => {}, exists: (p) => files.has(p),
    writeFileExclusive: (p, c) => { if (files.has(p)) throw new Error(`EEXIST ${p}`); files.set(p, c); },
  };
}
const EXP = (set) => { const crypto = require("node:crypto"); return codec.liveSetContentHash(set); };

await check("parseArgs: backup requires --out-dir; project/commit pinned", () => {
  assert.throws(() => cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT]));           // no --out-dir
  assert.throws(() => cli.parseArgs(["--project", "other", "--commit", COMMIT, "--out-dir", "d"])); // wrong project
  assert.throws(() => cli.parseArgs(["--project", "taylor-parts", "--commit", "short", "--out-dir", "d"]));
  const a = cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "d"]);
  assert.equal(a.restore, false); assert.equal(a.outDir, "d");
});

await check("parseArgs: restore requires ack + snapshot + sha256 + expected-live-sha256 + owner authorization", () => {
  const base = ["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "s.json"];
  assert.throws(() => cli.parseArgs(base));                                                 // no ack
  assert.throws(() => cli.parseArgs([...base, "--acknowledge-production-write"]));          // no sha256
  assert.throws(() => cli.parseArgs([...base, "--acknowledge-production-write", "--snapshot-sha256", "a".repeat(64)])); // no expected-live
  assert.throws(() => cli.parseArgs([...base, "--acknowledge-production-write", "--snapshot-sha256", "a".repeat(64), "--expected-live-sha256", "b".repeat(64)])); // no owner auth
  const ok = cli.parseArgs([...base, "--acknowledge-production-write", "--snapshot-sha256", "a".repeat(64), "--expected-live-sha256", "b".repeat(64), "--owner-rollback-authorization", "OWNER-OK"]);
  assert.equal(ok.restore, true);
});

await check("runBackup FAILS CLOSED when the captured set exceeds the single-transaction limit", async () => {
  const many = []; for (let i = 0; i < 501; i += 1) many.push(live(`w${i}`, gov(`w${i}`)));
  const deps = { readLiveWarehouses: async () => many, fs: memFs() };
  const args = cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "roll"]);
  await assert.rejects(cli.runBackup(deps, args), /UNRESTORABLE|exceeds/);
});

await check("runBackup: encodes + writes snapshot + sha256; refuses to overwrite", async () => {
  const fs = memFs();
  const deps = { readLiveWarehouses: async () => [live("w1", gov("w1")), live("w2", gov("w2", { status: "INACTIVE" }))], fs };
  const args = cli.parseArgs(["--project", "taylor-parts", "--commit", COMMIT, "--out-dir", "roll"]);
  const r = await cli.runBackup(deps, args);
  assert.equal(r.mode, "backup"); assert.equal(r.capturedCount, 2);
  assert.match(r.snapshotSha256, /^[0-9a-f]{64}$/);
  assert.equal([...fs._files.keys()].filter((k) => k.includes("snapshot.json")).length, 1);
  // second backup into the same dir refuses via EXCLUSIVE creation (snapshot.json already exists).
  await assert.rejects(cli.runBackup(deps, args), /EEXIST|refusing to overwrite/);
});

// Build a valid snapshot artifact the way runBackup would (bytes + hash) for restore tests.
function makeSnapshotArtifact(set) {
  const snapshot = codec.encodeSnapshot(set, { projectId: "taylor-parts", governedCommit: COMMIT });
  const bytes = JSON.stringify(snapshot, null, 2) + "\n";
  const crypto = require("node:crypto");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  return { snapshot, bytes, hash };
}

const restoreArgs = (over = {}) => cli.parseArgs(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "s.json", "--acknowledge-production-write", "--snapshot-sha256", over.snap || "a".repeat(64), "--expected-live-sha256", over.exp || "b".repeat(64), "--owner-rollback-authorization", "OWNER-OK"]);

await check("runRestore: snapshot hash mismatch fails closed (zero writes)", async () => {
  const { bytes } = makeSnapshotArtifact([live("w1", gov("w1"))]);
  let wrote = false;
  const deps = { readSnapshotRaw: async () => bytes, readLiveWarehouses: async () => [live("w1", gov("w1"))], runRestoreTxn: async () => { wrote = true; return { restoredCount: 1 }; } };
  await assert.rejects(cli.runRestore(deps, restoreArgs({ snap: "b".repeat(64) })), /snapshot hash mismatch/);
  assert.equal(wrote, false);
});

await check("runRestore: passes expected-live hash to the txn; SUCCESS path restores + parity holds", async () => {
  const set = [live("w1", gov("w1")), live("w2", gov("w2"))];
  const { bytes, hash } = makeSnapshotArtifact(set);
  const expLive = EXP(set);
  let seenExpected = null, restored = null;
  const deps = {
    readSnapshotRaw: async () => bytes,
    readLiveWarehouses: async () => set, // post-restore parity read == snapshot
    runRestoreTxn: async ({ decoded, expectedLiveSha256 }) => { seenExpected = expectedLiveSha256; restored = decoded; return { restoredCount: decoded.length }; },
  };
  const r = await cli.runRestore(deps, restoreArgs({ snap: hash, exp: expLive }));
  assert.equal(seenExpected, expLive); // the content gate hash reached the txn
  assert.equal(r.restoredCount, 2); assert.equal(r.parity.changedCount, 0);
  assert.ok(restored[0].data.updatedAt instanceof Timestamp);
});

await check("runRestore: content-gate rejection inside the txn fails closed (a doc changed since migration)", async () => {
  const set = [live("w1", gov("w1"))];
  const { bytes, hash } = makeSnapshotArtifact(set);
  // A realistic txn dep that enforces the expected-live content hash against the CURRENT live set.
  const enforcingTxn = (currentLive) => async ({ snapshot, decoded, expectedLiveSha256 }) => {
    if (codec.liveSetContentHash(currentLive) !== expectedLiveSha256) throw new Error("live-state content changed since the approved post-migration state");
    return { restoredCount: decoded.length };
  };
  const changedLive = [live("w1", gov("w1", { status: "INACTIVE" }))]; // differs from the approved expected state
  const deps = { readSnapshotRaw: async () => bytes, readLiveWarehouses: async () => set, runRestoreTxn: enforcingTxn(changedLive) };
  // expected-live hash is for the ORIGINAL approved state; current live differs -> reject, zero writes.
  await assert.rejects(cli.runRestore(deps, restoreArgs({ snap: hash, exp: EXP(set) })), /content changed/);
});

await check("runRestore: post-restore parity failure (live still differs) fails closed", async () => {
  const set = [live("w1", gov("w1"))];
  const { bytes, hash } = makeSnapshotArtifact(set);
  const deps = {
    readSnapshotRaw: async () => bytes,
    readLiveWarehouses: async () => [live("w1", gov("w1", { status: "INACTIVE" }))], // never matches snapshot
    runRestoreTxn: async ({ decoded }) => ({ restoredCount: decoded.length }),
  };
  await assert.rejects(cli.runRestore(deps, restoreArgs({ snap: hash, exp: EXP(set) })), /parity failed/);
});

// ---- X-TARGETING-GUARD: cli.main() fails closed BEFORE buildProductionDeps() (and therefore before
// firebase-admin is ever required and before any Firestore connection, read, or write) ----
// `getApps()` (firebase-admin/app) reads the SAME global app registry buildProductionDeps() would register
// into via admin.initializeApp() -- so its length staying 0 after a rejected cli.main() call is direct proof
// the rejection happened before Firebase touched anything. Technique copied from
// functions/test/salesOrderNumberBackfill.test.mjs's environment-guard tests.
assert.equal(getApps().length, 0, "precondition: no Firebase app has been initialized by anything else in this offline test file");
await check("main(): a rejected --project ('taylor-parts' required) never reaches buildProductionDeps -- no Firebase app registered", async () => {
  await assert.rejects(cli.main(["--project", "not-taylor-parts", "--commit", COMMIT, "--out-dir", "d"]), /--project must be taylor-parts/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore admin.initializeApp) must never run when --project is rejected");
});
await check("main(): a malformed --commit never reaches buildProductionDeps -- no Firebase app registered", async () => {
  await assert.rejects(cli.main(["--project", "taylor-parts", "--commit", "not-40-hex", "--out-dir", "d"]), /40-hex/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore admin.initializeApp) must never run when --commit is rejected");
});
await check("main(): --restore without --acknowledge-production-write never reaches buildProductionDeps -- no Firebase app registered", async () => {
  await assert.rejects(
    cli.main(["--restore", "--project", "taylor-parts", "--commit", COMMIT, "--snapshot", "s.json"]),
    /acknowledge-production-write/,
  );
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore admin.initializeApp) must never run when --restore lacks --acknowledge-production-write");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
