// Receiving Location Authority -- I-LA3: GOVERNED warehouse-governance migration + verifier OPERATOR CLI.
// Repository-only. INERT on import: it does NOT run merely because it is required (only main() under
// `require.main === module` does anything), and it lazy-requires firebase-admin inside a production-deps
// closure -- so importing this file performs NO Firestore read/write and touches no production. All
// orchestration is injected-deps so it is unit-testable offline.
//
// DRY-RUN is the DEFAULT (zero writes): classify the live set + emit sanitized dry-run evidence listing the
// ambiguous ids/fingerprints the Owner must resolve. EXECUTE requires BOTH --execute and
// --acknowledge-production-write plus a --manifest; it re-reads live state, recomputes fingerprints, stages
// the governed §3A MIGRATED records in ONE transaction (all-or-nothing), then runs the read-only verifier
// and publishes evidence ATOMICALLY -- only after a passing verification (no report directory on failure).
"use strict";

const path = require("node:path");
const crypto = require("node:crypto");

function sha256Hex(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function normalizeHash(h) { return typeof h === "string" ? h.trim().toLowerCase() : ""; }
function isHex64(h) { return /^[0-9a-f]{64}$/.test(h); }

const lib = () => ({
  migration: require("../lib/warehouseGovernance/warehouseGovernanceMigration.js"),
  verifier: require("../lib/warehouseGovernance/warehouseGovernanceVerifier.js"),
  evidence: require("../lib/warehouseGovernance/warehouseGovernanceEvidence.js"),
});

function parseArgs(argv) {
  const args = { execute: false, acknowledgeProductionWrite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--execute") args.execute = true;
    else if (a === "--acknowledge-production-write") args.acknowledgeProductionWrite = true;
    else if (a === "--project") args.projectId = argv[++i];
    else if (a === "--commit") args.governedCommit = argv[++i];
    else if (a === "--manifest") args.manifestPath = argv[++i];
    else if (a === "--manifest-sha256") args.manifestSha256 = argv[++i];
    else if (a === "--evidence-dir") args.evidenceDir = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.projectId) throw new Error("--project is required");
  if (!args.governedCommit) throw new Error("--commit is required");
  if (!args.evidenceDir) throw new Error("--evidence-dir is required");
  if (args.execute) {
    if (!args.acknowledgeProductionWrite) throw new Error("--execute requires --acknowledge-production-write");
    if (!args.manifestPath) throw new Error("--execute requires --manifest");
    if (!args.manifestSha256) throw new Error("--execute requires --manifest-sha256 (the Owner-approved manifest hash)");
  }
  return args;
}

// Atomic evidence publish: write to a sibling temp dir, secret-scan every file, and only on a clean scan
// rename it into place. On ANY failure the temp dir is removed and NO final directory is left behind.
function publishEvidenceAtomically(fsDeps, finalDir, files) {
  const { evidence } = lib();
  const tmpDir = `${finalDir}.tmp-${fsDeps.stamp}`;
  fsDeps.rmrf(tmpDir);
  fsDeps.mkdirp(tmpDir);
  try {
    const checksums = [];
    for (const f of files) {
      const found = evidence.scanForSecrets(f.content);
      if (found.length > 0) throw new Error(`refusing to publish: evidence file ${f.name} contains secret-like content`);
      fsDeps.writeFile(path.join(tmpDir, f.name), f.content);
      checksums.push(`${require("node:crypto").createHash("sha256").update(f.content).digest("hex")}  ${f.name}`);
    }
    fsDeps.writeFile(path.join(tmpDir, "checksums.sha256"), checksums.join("\n") + "\n");
    if (fsDeps.exists(finalDir)) throw new Error(`refusing to overwrite existing evidence dir ${finalDir}`);
    fsDeps.rename(tmpDir, finalDir);
    return finalDir;
  } catch (err) {
    fsDeps.rmrf(tmpDir);
    throw err;
  }
}

async function runDryRun(deps, args) {
  const { migration, evidence } = lib();
  const live = await deps.readLiveWarehouses();
  const plan = migration.planMigration(live, { projectId: args.projectId, governedCommit: args.governedCommit });
  const ev = evidence.buildDryRunEvidence(plan);
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [{ name: "dry-run.json", content: evidence.serializeEvidence(ev) }]);
  return { mode: "dry-run", plan, evidenceDir: dir, ambiguousCount: plan.counts.ambiguous };
}

async function runExecute(deps, args) {
  const { migration, verifier, evidence } = lib();
  // (P1-2) Bind execution to the Owner-approved manifest content hash. Hash the EXACT manifest bytes
  // BEFORE parsing; require an exact normalized 64-hex match; fail closed (zero writes) on mismatch.
  const rawManifest = await deps.readManifestRaw(args.manifestPath);
  const expected = normalizeHash(args.manifestSha256);
  if (!isHex64(expected)) throw new Error("expected manifest sha256 must be a normalized 64-hex value");
  const actualHash = sha256Hex(rawManifest);
  if (actualHash !== expected) throw new Error("manifest hash mismatch: refusing to execute (no writes)");
  const manifest = JSON.parse(rawManifest);

  const live = await deps.readLiveWarehouses();
  const plan = migration.planMigration(live, { projectId: args.projectId, governedCommit: args.governedCommit });
  // Stage the whole migration in ONE transaction (all-or-nothing). deps.runMigrationTxn re-reads the
  // COMPLETE live set through the txn and stages writes; it fails closed on set/pre-state drift.
  const result = await deps.runMigrationTxn({ plan, manifest });
  // Read-only verification AFTER staging. Evidence is published only if it passes.
  const after = await deps.readLiveWarehouses();
  const verification = verifier.verifyWarehouseGovernance(after.map((w) => ({ warehouseId: w.warehouseId, data: w.data })));
  if (!verification.pass) throw new Error("post-migration verification failed: not publishing evidence");
  // The verified manifest hash is recorded in the sanitized execution evidence.
  const evObj = { ...evidence.buildVerifierEvidence(verification), verifiedManifestSha256: actualHash };
  const dir = publishEvidenceAtomically(deps.fs, args.evidenceDir, [
    { name: "verification.json", content: evidence.serializeEvidence(evObj) },
  ]);
  return { mode: "execute", result, verification, verifiedManifestSha256: actualHash, evidenceDir: dir };
}

async function run(deps, argv) {
  const args = parseArgs(argv);
  return args.execute ? runExecute(deps, args) : runDryRun(deps, args);
}

// Lazily build the real production deps -- firebase-admin is required ONLY here, never at import time.
function buildProductionDeps() {
  // eslint-disable-next-line global-require
  const admin = require("firebase-admin");
  const fs = require("node:fs");
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const WAREHOUSES = "warehouses";
  return {
    async readLiveWarehouses() {
      const snap = await db.collection(WAREHOUSES).get();
      return snap.docs.map((d) => ({ warehouseId: d.id, data: d.data() }));
    },
    async readManifestRaw(p) { return fs.readFileSync(p, "utf8"); },
    async runMigrationTxn({ plan, manifest }) {
      const { migration } = lib();
      return db.runTransaction(async (txn) => {
        const staged = [];
        const store = {
          // Read the COMPLETE collection through the txn (locks it; a concurrent add/change/delete conflicts).
          async readAll() { const snap = await txn.get(db.collection(WAREHOUSES)); return snap.docs.map((d) => ({ warehouseId: d.id, data: d.data() })); },
          stage(id, record) { staged.push({ id, record }); },
        };
        const result = await migration.executeMigration({ plan, manifest, store, actorId: "tool:warehouse-governance-migration", now: () => new Date() });
        for (const s of staged) txn.set(db.collection(WAREHOUSES).doc(s.id), s.record);
        return result;
      });
    },
    fs: {
      stamp: String(process.pid),
      mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
      rmrf: (d) => fs.rmSync(d, { recursive: true, force: true }),
      writeFile: (p, c) => fs.writeFileSync(p, c, "utf8"),
      exists: (p) => fs.existsSync(p),
      rename: (a, b) => fs.renameSync(a, b),
    },
  };
}

module.exports = { parseArgs, publishEvidenceAtomically, runDryRun, runExecute, run, buildProductionDeps };

if (require.main === module) {
  run(buildProductionDeps(), process.argv.slice(2))
    .then((r) => { console.log(JSON.stringify({ ok: true, mode: r.mode, evidenceDir: r.evidenceDir }, null, 2)); process.exitCode = 0; })
    .catch((err) => { console.error(`WAREHOUSE MIGRATION CLI FAILURE: ${err.message}`); process.exitCode = 2; });
}
