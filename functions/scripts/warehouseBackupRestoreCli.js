// EI Phase-2 Receiving -- Gate E2-V: LOSSLESS `warehouses` backup/restore OPERATOR CLI. Repository-only.
// INERT on import (only main() under `require.main === module` acts; firebase-admin is lazy-required inside
// a production-deps closure) -- importing this file performs NO Firestore read/write and touches no
// production. All orchestration is injected-deps so it is unit-testable offline.
//
// BACKUP (default, zero writes): read the COMPLETE live `warehouses` set, encode every value into the
// lossless typed envelope (Timestamps preserved; fails closed on any non-round-trippable value), and write
// snapshot.json + snapshot.sha256 into an access-controlled rollback dir. This is the pre-migration
// rollback artifact; it is NOT sanitized evidence and is NEVER packaged into the evidence tarball.
//
// RESTORE (production write; rollback only): requires --restore, --acknowledge-production-write, an explicit
// --owner-rollback-authorization token, the snapshot path AND its Owner-recorded --snapshot-sha256, and the
// project/commit pins. It re-hashes the exact snapshot bytes and fails closed on mismatch; re-reads the live
// set THROUGH a transaction and fails closed on identity-set drift (any id added/deleted since capture);
// writes the decoded typed documents back in ONE transaction (all-or-nothing); then re-reads and verifies
// byte/semantic parity before reporting success.
"use strict";

const path = require("node:path");
const crypto = require("node:crypto");

function sha256Hex(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function normalizeHash(h) { return typeof h === "string" ? h.trim().toLowerCase() : ""; }
function isHex64(h) { return /^[0-9a-f]{64}$/.test(h); }

const lib = () => require("../lib/warehouseGovernance/warehouseBackupCodec.js");

function parseArgs(argv) {
  const args = { restore: false, acknowledgeProductionWrite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--restore") args.restore = true;
    else if (a === "--acknowledge-production-write") args.acknowledgeProductionWrite = true;
    else if (a === "--project") args.projectId = argv[++i];
    else if (a === "--commit") args.governedCommit = argv[++i];
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a === "--snapshot") args.snapshotPath = argv[++i];
    else if (a === "--snapshot-sha256") args.snapshotSha256 = argv[++i];
    else if (a === "--expected-live-sha256") args.expectedLiveSha256 = argv[++i];
    else if (a === "--owner-rollback-authorization") args.ownerRollbackAuthorization = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.projectId !== "taylor-parts") throw new Error("--project must be taylor-parts");
  if (!/^[0-9a-f]{40}$/.test(args.governedCommit || "")) throw new Error("--commit must be a 40-hex governed commit");
  if (args.restore) {
    if (!args.acknowledgeProductionWrite) throw new Error("--restore requires --acknowledge-production-write");
    if (!args.snapshotPath) throw new Error("--restore requires --snapshot");
    if (!isHex64(normalizeHash(args.snapshotSha256))) throw new Error("--restore requires --snapshot-sha256 (the Owner-recorded pre-migration snapshot hash)");
    if (!isHex64(normalizeHash(args.expectedLiveSha256))) throw new Error("--restore requires --expected-live-sha256 (the Owner-approved post-migration live-state content hash)");
    if (!args.ownerRollbackAuthorization || String(args.ownerRollbackAuthorization).trim() === "") throw new Error("--restore requires --owner-rollback-authorization");
  } else if (!args.outDir) {
    throw new Error("backup requires --out-dir");
  }
  return args;
}

async function runBackup(deps, args) {
  const codec = lib();
  const live = await deps.readLiveWarehouses();
  const snapshot = codec.encodeSnapshot(live, { projectId: args.projectId, governedCommit: args.governedCommit });
  const bytes = JSON.stringify(snapshot, null, 2) + "\n";
  // Fail closed NOW if this set could not be restored in one transaction -- never persist an
  // un-restorable rollback artifact.
  codec.assertRestorableSnapshot(snapshot, Buffer.byteLength(bytes, "utf8"));
  const hash = sha256Hex(bytes);
  const contentHash = codec.liveSetContentHash(live); // the expected-current-state hash for a later restore
  // Write to an access-controlled rollback dir (0700/0600) via EXCLUSIVE creation (fail if it exists).
  deps.fs.mkdirpSecure(args.outDir);
  const snapPath = path.join(args.outDir, "snapshot.json");
  deps.fs.writeFileExclusive(snapPath, bytes);
  deps.fs.writeFileExclusive(path.join(args.outDir, "snapshot.sha256"), `${hash}  snapshot.json\n`);
  deps.fs.writeFileExclusive(path.join(args.outDir, "content.sha256"), `${contentHash}  live-set-content\n`);
  return { mode: "backup", capturedCount: snapshot.capturedCount, snapshotSha256: hash, liveContentSha256: contentHash, snapshotPath: snapPath };
}

async function runRestore(deps, args) {
  const codec = lib();
  // (1) Hash-bind the EXACT snapshot bytes before parsing; fail closed on mismatch (zero writes).
  const rawSnapshot = await deps.readSnapshotRaw(args.snapshotPath);
  const expected = normalizeHash(args.snapshotSha256);
  const actualHash = sha256Hex(rawSnapshot);
  if (actualHash !== expected) throw new Error("snapshot hash mismatch: refusing to restore (no writes)");
  const snapshot = codec.validateSnapshotShape(JSON.parse(rawSnapshot));
  if (snapshot.projectId !== args.projectId) throw new Error("snapshot projectId != --project");
  if (snapshot.governedCommit !== args.governedCommit) throw new Error("snapshot governedCommit != --commit");
  const decoded = codec.decodeSnapshot(snapshot); // real Firestore-typed docs (fails closed if corrupt)

  // (2) Restore in ONE transaction: re-read the live set THROUGH the txn, fail closed on identity drift
  //     AND on ANY content difference from the Owner-approved expected post-migration live-state hash
  //     (so a document changed since migration is never silently overwritten), overwrite exactly the
  //     captured docs, then verify parity after commit.
  const expectedLiveSha256 = normalizeHash(args.expectedLiveSha256);
  const result = await deps.runRestoreTxn({ snapshot, decoded, expectedLiveSha256 });
  const after = await deps.readLiveWarehouses();
  const parity = codec.planRestore(snapshot, after, { projectId: args.projectId, governedCommit: args.governedCommit });
  // After a faithful restore, live == snapshot: bounded set (ok) AND zero content changes.
  if (!parity.ok) throw new Error(`post-restore parity failed: ${parity.reason}`);
  if (parity.changedCount !== 0) throw new Error(`post-restore parity failed: ${parity.changedCount} docs still differ from the snapshot`);
  return { mode: "restore", restoredCount: result.restoredCount, snapshotSha256: actualHash, parity: { ok: true, changedCount: 0 } };
}

async function run(deps, argv) {
  const args = parseArgs(argv);
  return args.restore ? runRestore(deps, args) : runBackup(deps, args);
}

// Lazily build the real production deps -- firebase-admin required ONLY here, never at import time.
// X-TARGETING-GUARD: every gate above (--project == "taylor-parts", the 40-hex --commit, snapshot-sha256 /
// expected-live-sha256 pins, --owner-rollback-authorization) validates the STRING the operator typed -- it
// does nothing unless the Admin SDK actually binds to that same project. Passing `projectId` through to
// `initializeApp({ projectId })`, then asserting the SDK's OWN resolved projectId matches it, closes that
// gap: bare `admin.initializeApp()` lets ambient credentials (GOOGLE_APPLICATION_CREDENTIALS / gcloud ADC /
// GCLOUD_PROJECT) pick the target, which can silently diverge from the confirmed --project. Mirrors
// scripts/_sandboxDeployGuard.mjs's "assert the resolved identity, don't trust the input string" shape.
function buildProductionDeps(projectId) {
  // eslint-disable-next-line global-require
  const admin = require("firebase-admin");
  const fs = require("node:fs");
  const codec = lib();
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const resolvedProjectId = admin.app().options.projectId;
  if (resolvedProjectId !== projectId) {
    throw new Error(
      `firebase-admin resolved projectId '${resolvedProjectId}' does not match the confirmed --project ` +
        `'${projectId}': refusing to proceed (ambient credentials must not silently pick a different target)`,
    );
  }
  const db = admin.firestore();
  const WAREHOUSES = "warehouses";
  return {
    async readLiveWarehouses() {
      const snap = await db.collection(WAREHOUSES).get();
      return snap.docs.map((d) => ({ warehouseId: d.id, data: d.data() }));
    },
    async readSnapshotRaw(p) { return fs.readFileSync(p, "utf8"); },
    async runRestoreTxn({ snapshot, decoded, expectedLiveSha256 }) {
      return db.runTransaction(async (txn) => {
        // Re-read the COMPLETE collection through the txn (locks it; a concurrent add/change/delete conflicts).
        const liveSnap = await txn.get(db.collection(WAREHOUSES));
        const live = liveSnap.docs.map((d) => ({ warehouseId: d.id, data: d.data() }));
        const plan = codec.planRestore(snapshot, live, { projectId: snapshot.projectId, governedCommit: snapshot.governedCommit });
        if (!plan.ok) throw new Error(`restore drift/precondition failed: ${plan.reason} (added=${plan.added.length} deleted=${plan.deleted.length})`);
        // Content gate: the live set must match the Owner-approved expected post-migration state EXACTLY.
        const actualLiveHash = codec.liveSetContentHash(live);
        if (actualLiveHash !== expectedLiveSha256) throw new Error("live-state content changed since the approved post-migration state: refusing to restore (no writes)");
        for (const d of decoded) txn.set(db.collection(WAREHOUSES).doc(d.warehouseId), d.data);
        return { restoredCount: decoded.length };
      });
    },
    fs: {
      mkdirpSecure: (d) => { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); try { fs.chmodSync(d, 0o700); } catch { /* win32: mode bits limited */ } },
      exists: (p) => fs.existsSync(p),
      // Exclusive create (O_EXCL): fails if the path already exists -- no TOCTOU overwrite window.
      writeFileExclusive: (p, c) => { fs.writeFileSync(p, c, { flag: "wx", mode: 0o600 }); const st = fs.statSync(p); if (process.platform !== "win32" && (st.mode & 0o077)) throw new Error(`rollback file ${p} has group/other permissions`); },
    },
  };
}

// Full entrypoint composition, extracted from the require.main IIFE so tests can invoke the SAME
// argv -> parseArgs -> buildProductionDeps -> run() chain a real CLI invocation uses, and prove that a
// rejected configuration fails BEFORE buildProductionDeps() (and therefore before firebase-admin is ever
// required and before any Firestore connection, read, or write) runs. Previously `run(buildProductionDeps(), ...)`
// evaluated buildProductionDeps() as a call argument BEFORE run() parsed argv at all -- so firebase-admin
// initialized (with no projectId, letting ambient credentials pick the target) even for an invocation that
// parseArgs would go on to reject. parseArgs() must run first.
async function main(argv) {
  const args = parseArgs(argv);
  return run(buildProductionDeps(args.projectId), argv);
}

module.exports = { parseArgs, runBackup, runRestore, run, buildProductionDeps, main };

if (require.main === module) {
  main(process.argv.slice(2))
    .then((r) => { console.log(JSON.stringify({ ok: true, ...r }, null, 2)); process.exitCode = 0; })
    .catch((err) => { console.error(`WAREHOUSE BACKUP/RESTORE CLI FAILURE: ${err.message}`); process.exitCode = 2; });
}
