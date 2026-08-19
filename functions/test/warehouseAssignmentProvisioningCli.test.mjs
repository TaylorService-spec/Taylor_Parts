// X-WAREHOUSE-ASSIGNMENT-PROVISIONING -- offline unit tests for functions/scripts/warehouseAssignmentProvisioningCli.js.
// PURE: no Firebase app, no emulator, no network. Every "refusal" check below asserts the rejection happens
// inside parseArgs()/assertSandboxTarget() -- i.e. BEFORE main() ever calls buildProductionDeps() (the only
// place firebase-admin is required and admin.initializeApp() is ever called). getApps() from firebase-admin/app
// reads the SAME global app registry buildProductionDeps() would register into, so "getApps().length === 0
// after a rejected call" is a direct, executable proof that firebase-admin was never initialized -- not an
// inference from the error message alone.
import assert from "node:assert/strict";
import { getApps } from "firebase-admin/app";

const cliMod = await import("../scripts/warehouseAssignmentProvisioningCli.js");
const cli = cliMod.default ?? cliMod;

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.stack || err}`); }
}
async function acheck(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.stack || err}`); }
}

const SANDBOX_PROJECT_ID = cli.resolveSandboxProjectId(cli.loadEnvironmentRegistry());
const base = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "test"];

check("resolveSandboxProjectId: resolves to exactly one project id from config/environments.json", () => {
  assert.equal(typeof SANDBOX_PROJECT_ID, "string");
  assert.ok(SANDBOX_PROJECT_ID.length > 0);
});

check("parseArgs: --environment is required", () => {
  const argv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--environment is required/);
});

check("parseArgs: --environment production/prod/typo are all refused", () => {
  for (const bad of ["production", "prod", "Sandbox", "sandbox "]) {
    const argv = [...base.slice(0, base.indexOf("--environment")), "--environment", bad, ...base.slice(base.indexOf("--environment") + 2)];
    assert.throws(() => cli.parseArgs(argv), /--environment must be exactly "sandbox"/, `expected '${bad}' to be rejected`);
  }
});

check("parseArgs: an explicitly empty --environment value is falsy, so it hits the 'required' branch (still a hard rejection)", () => {
  const argv = [...base.slice(0, base.indexOf("--environment")), "--environment", "", ...base.slice(base.indexOf("--environment") + 2)];
  assert.throws(() => cli.parseArgs(argv), /--environment is required/);
});

check("parseArgs: --project taylor-parts (or any near-miss) is refused under --environment sandbox", () => {
  for (const nearMiss of ["taylor-parts", `${SANDBOX_PROJECT_ID} `, `${SANDBOX_PROJECT_ID}-alias`, `x-${SANDBOX_PROJECT_ID}`]) {
    const argv = ["--project", nearMiss, "--confirm-project", nearMiss, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
    assert.throws(() => cli.parseArgs(argv), /only accepts --project/);
  }
});

check("parseArgs: --project is required even under --environment sandbox (no implicit default)", () => {
  const argv = ["--confirm-project", SANDBOX_PROJECT_ID, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--project is required/);
});

check("parseArgs: mismatched --confirm-project is rejected", () => {
  const argv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", "not-the-same", "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--confirm-project does not match/);
});

check("parseArgs: dry-run requires --manifest", () => {
  assert.throws(() => cli.parseArgs(base), /dry-run requires --manifest/);
});

check("parseArgs: --execute requires --acknowledge-production-write", () => {
  const argv = [...base, "--execute", "--plan", "/p", "--plan-sha256", "a".repeat(64)];
  assert.throws(() => cli.parseArgs(argv), /--execute requires --acknowledge-production-write/);
});

check("parseArgs: --execute requires --plan and --plan-sha256", () => {
  const argv = [...base, "--execute", "--acknowledge-production-write"];
  assert.throws(() => cli.parseArgs(argv), /--execute requires --plan/);
});

check("parseArgs: --rollback requires --acknowledge-production-write and --execution-result", () => {
  assert.throws(() => cli.parseArgs([...base, "--rollback"]), /--rollback requires --acknowledge-production-write/);
  assert.throws(() => cli.parseArgs([...base, "--rollback", "--acknowledge-production-write"]), /--rollback requires --execution-result/);
});

check("parseArgs: --execute and --rollback are mutually exclusive", () => {
  const argv = [...base, "--execute", "--rollback", "--acknowledge-production-write", "--plan", "/p", "--plan-sha256", "a".repeat(64), "--execution-result", "/e"];
  assert.throws(() => cli.parseArgs(argv), /mutually exclusive/);
});

// ---- proof: every rejection above happens BEFORE firebase-admin is ever initialized ----
await acheck("main(): a rejected --environment value never reaches buildProductionDeps -- no Firebase app registered", async () => {
  assert.equal(getApps().length, 0, "precondition: no app registered yet from an earlier test");
  const argv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t", "--manifest", "/m"];
  await assert.rejects(cli.main(argv), /--environment must be exactly "sandbox"/);
  assert.equal(getApps().length, 0, "buildProductionDeps() must never have run -- no Firebase app should exist");
});

await acheck("main(): a rejected sandbox-project mismatch also never reaches buildProductionDeps -- no app registered", async () => {
  const argv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t", "--manifest", "/m"];
  await assert.rejects(cli.main(argv), /only accepts --project/);
  assert.equal(getApps().length, 0);
});

await acheck("main(): a missing --manifest on dry-run never reaches buildProductionDeps -- no app registered", async () => {
  await assert.rejects(cli.main(base), /dry-run requires --manifest/);
  assert.equal(getApps().length, 0);
});

// ---- manifest shape validation (pure) ----
check("validateManifestShape: rejects a non-object / missing entries array", () => {
  assert.throws(() => cli.validateManifestShape(null), /must be a JSON object/);
  assert.throws(() => cli.validateManifestShape({}), /must be a JSON object/);
});
check("validateManifestShape: rejects empty entries", () => {
  assert.throws(() => cli.validateManifestShape({ entries: [] }), /must not be empty/);
});
check("validateManifestShape: requires employeeId, warehouseId, and a non-empty rationale on every entry", () => {
  assert.throws(() => cli.validateManifestShape({ entries: [{ warehouseId: "w1", rationale: "x" }] }), /employeeId must be a non-empty string/);
  assert.throws(() => cli.validateManifestShape({ entries: [{ employeeId: "e1", rationale: "x" }] }), /warehouseId must be a non-empty string/);
  assert.throws(() => cli.validateManifestShape({ entries: [{ employeeId: "e1", warehouseId: "w1" }] }), /rationale must be a non-empty string/);
  assert.throws(() => cli.validateManifestShape({ entries: [{ employeeId: "e1", warehouseId: "w1", rationale: "  " }] }), /rationale must be a non-empty string/);
});
check("validateManifestShape: rejects duplicate employeeId across entries", () => {
  const manifest = { entries: [
    { employeeId: "e1", warehouseId: "w1", rationale: "a" },
    { employeeId: "e1", warehouseId: "w2", rationale: "b" },
  ] };
  assert.throws(() => cli.validateManifestShape(manifest), /duplicate employeeId/);
});
check("validateManifestShape: accepts a well-formed manifest and returns its entries", () => {
  const manifest = { entries: [{ employeeId: "e1", warehouseId: "w1", rationale: "only warehouse the employee's role qualifies for" }] };
  const entries = cli.validateManifestShape(manifest);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].employeeId, "e1");
});

// ---- dry-run / execute / rollback orchestration against injected fake deps (no Firebase, pure logic) ----
function fakeFsDeps() {
  const files = new Map();
  const dirs = new Set();
  return {
    stamp: "test",
    mkdirp: (d) => dirs.add(d),
    rmrf: (d) => { dirs.delete(d); for (const k of [...files.keys()]) if (k.startsWith(`${d}/`)) files.delete(k); },
    writeFile: (p, c) => files.set(p, c),
    exists: (p) => dirs.has(p) || files.has(p),
    rename: (a, b) => {
      dirs.delete(a); dirs.add(b);
      for (const [k, v] of [...files.entries()]) {
        if (k.startsWith(`${a}/`)) { files.set(`${b}/${k.slice(a.length + 1)}`, v); files.delete(k); }
      }
    },
    _files: files,
  };
}

await acheck("runDryRun: an already-non-empty employee is refused, never included in assignments", async () => {
  const fsDeps = fakeFsDeps();
  const deps = {
    now: () => new Date(0),
    readManifestRaw: async () => JSON.stringify({ entries: [{ employeeId: "e-full", warehouseId: "w1", rationale: "r" }] }),
    readEmployee: async () => ({ exists: true, operationalRoles: ["PARTS_ASSOCIATE"], assignedWarehouseIds: ["already-set"], updateTimeMillis: 1 }),
    readWarehouse: async () => ({ exists: true, status: "ACTIVE", name: "Main" }),
    fs: fsDeps,
  };
  const result = await cli.runDryRun(deps, { projectId: "p", governedCommit: "c", evidenceDir: "/ev" });
  assert.equal(result.planEvidence.assignments.length, 0);
  assert.equal(result.planEvidence.refused.length, 1);
  assert.equal(result.planEvidence.refused[0].reason, "ALREADY_ASSIGNED_NON_EMPTY");
});

await acheck("runDryRun: a missing warehouse is refused", async () => {
  const fsDeps = fakeFsDeps();
  const deps = {
    now: () => new Date(0),
    readManifestRaw: async () => JSON.stringify({ entries: [{ employeeId: "e1", warehouseId: "w-missing", rationale: "r" }] }),
    readEmployee: async () => ({ exists: true, operationalRoles: [], assignedWarehouseIds: [], updateTimeMillis: 1 }),
    readWarehouse: async () => ({ exists: false }),
    fs: fsDeps,
  };
  const result = await cli.runDryRun(deps, { projectId: "p", governedCommit: "c", evidenceDir: "/ev" });
  assert.equal(result.planEvidence.refused[0].reason, "WAREHOUSE_NOT_FOUND");
});

await acheck("runDryRun: a clean entry becomes a ready assignment with a pre-state fingerprint", async () => {
  const fsDeps = fakeFsDeps();
  const deps = {
    now: () => new Date(0),
    readManifestRaw: async () => JSON.stringify({ entries: [{ employeeId: "e1", warehouseId: "w1", rationale: "r" }] }),
    readEmployee: async () => ({ exists: true, operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: [], updateTimeMillis: 42 }),
    readWarehouse: async () => ({ exists: true, status: "ACTIVE", name: "Main" }),
    fs: fsDeps,
  };
  const result = await cli.runDryRun(deps, { projectId: "p", governedCommit: "c", evidenceDir: "/ev" });
  assert.equal(result.planEvidence.assignments.length, 1);
  assert.ok(result.planEvidence.assignments[0].preStateFingerprint);
  assert.deepEqual(result.planEvidence.assignments[0].after, ["w1"]);
});

await acheck("runExecute: refuses (zero writes) if plan.json contains ANY refused entry", async () => {
  const planEvidence = {
    kind: "warehouse-assignment-provisioning-plan", projectId: "p", governedCommit: "c",
    assignments: [], refused: [{ employeeId: "e1", warehouseId: "w1", reason: "WAREHOUSE_NOT_FOUND" }],
  };
  const planJson = JSON.stringify(planEvidence);
  const hash = cliMod.default ? null : null; // computed below via crypto
  const { createHash } = await import("node:crypto");
  const planSha256 = createHash("sha256").update(planJson, "utf8").digest("hex");
  let batchCalled = false;
  const deps = {
    now: () => new Date(0),
    readPlanRaw: async () => planJson,
    readEmployee: async () => { throw new Error("must not read employee -- refused entries must fail before any live read"); },
    writeAssignmentsBatch: async () => { batchCalled = true; return []; },
    fs: fakeFsDeps(),
  };
  await assert.rejects(
    cli.runExecute(deps, { projectId: "p", governedCommit: "c", planPath: "/p", planSha256, evidenceDir: "/ev" }),
    /refused entr/
  );
  assert.equal(batchCalled, false);
});

await acheck("runExecute: plan hash mismatch refuses with zero writes and zero live reads", async () => {
  let readCalled = false;
  const deps = {
    now: () => new Date(0),
    readPlanRaw: async () => JSON.stringify({ projectId: "p", governedCommit: "c", assignments: [{ employeeId: "e1" }], refused: [] }),
    readEmployee: async () => { readCalled = true; return { exists: true, assignedWarehouseIds: [], updateTimeMillis: 1 }; },
    writeAssignmentsBatch: async () => { throw new Error("must not write"); },
    fs: fakeFsDeps(),
  };
  await assert.rejects(
    cli.runExecute(deps, { projectId: "p", governedCommit: "c", planPath: "/p", planSha256: "b".repeat(64), evidenceDir: "/ev" }),
    /plan hash mismatch/
  );
  assert.equal(readCalled, false);
});

await acheck("runExecute: STALE_PRESTATE when live employee no longer matches the plan's fingerprint", async () => {
  const planEvidence = {
    kind: "warehouse-assignment-provisioning-plan", projectId: "p", governedCommit: "c", refused: [],
    assignments: [{ employeeId: "e1", warehouseId: "w1", before: [], after: ["w1"], preStateFingerprint: "stale", employeeUpdateTimeMillis: 1 }],
  };
  const planJson = JSON.stringify(planEvidence);
  const { createHash } = await import("node:crypto");
  const planSha256 = createHash("sha256").update(planJson, "utf8").digest("hex");
  const deps = {
    now: () => new Date(0),
    readPlanRaw: async () => planJson,
    readEmployee: async () => ({ exists: true, operationalRoles: [], assignedWarehouseIds: [], updateTimeMillis: 1 }),
    writeAssignmentsBatch: async () => { throw new Error("must not write on fingerprint mismatch"); },
    fs: fakeFsDeps(),
  };
  await assert.rejects(
    cli.runExecute(deps, { projectId: "p", governedCommit: "c", planPath: "/p", planSha256, evidenceDir: "/ev" }),
    /fingerprint mismatch/
  );
});

await acheck("runRollback: refuses if the employee drifted since the execution being reversed", async () => {
  const deps = {
    now: () => new Date(0),
    readExecutionResultRaw: async () => JSON.stringify({
      projectId: "p", governedCommit: "c", boundPlanHash: "h",
      assigned: [{ employeeId: "e1", before: [], after: ["w1"], newUpdateTimeMillis: 5 }],
    }),
    readEmployee: async () => ({ exists: true, assignedWarehouseIds: ["w1"], updateTimeMillis: 999 }),
    rollbackAssignmentsBatch: async () => { throw new Error("must not write on rollback drift"); },
    fs: fakeFsDeps(),
  };
  await assert.rejects(
    cli.runRollback(deps, { projectId: "p", governedCommit: "c", executionResultPath: "/e", evidenceDir: "/ev" }),
    /ROLLBACK_STALE/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
