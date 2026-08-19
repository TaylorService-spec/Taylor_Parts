// X-PHANTOM-SALES-ORDER-LINK-REPAIR -- offline unit tests for the repair core
// (functions/src/repair/phantomSalesOrderLinkRepair.ts, phantomSalesOrderLinkRepairEvidence.ts) + operator CLI
// orchestration (functions/scripts/phantomSalesOrderLinkRepairCli.js). PURE: no Firebase app, no emulator, no
// network. Prerequisite: npm run build. Mirrors functions/test/salesOrderNumberBackfill.test.mjs's structure.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getApps } from "firebase-admin/app";
import {
  REPAIR_FIELD_NAMES,
  recordFingerprint,
  classifyRecord,
  planRepair,
  executeRepair,
  PhantomSalesOrderLinkRepairError,
} from "../lib/repair/phantomSalesOrderLinkRepair.js";
import { buildPlanEvidence, buildExecutionEvidence, scanForSecrets, serializeEvidence } from "../lib/repair/phantomSalesOrderLinkRepairEvidence.js";
const cliMod = await import("../scripts/phantomSalesOrderLinkRepairCli.js");
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

const NOW = () => new Date(1_700_000_000_000);
const PHANTOM_ID = "so-harbor-c713";
const REASON = "test reason";
const PACKAGE_ID = "pkg-1";
const CTX = { phantomSalesOrderId: PHANTOM_ID, reason: REASON, repairPackageId: PACKAGE_ID };

const wo = (id, over = {}) => ({
  workOrderId: id,
  salesOrderId: PHANTOM_ID,
  status: "COMPLETED",
  inventorySnapshot: [{ sku: "PRT-1002", partId: "PRT-1002", qtyUsed: 1 }],
  salesOrderLinkStatus: undefined,
  ...over,
});

// ---- fingerprint ----
check("recordFingerprint: deterministic + key-order independent + drift-sensitive", () => {
  const a = { salesOrderId: PHANTOM_ID, status: "COMPLETED", inventorySnapshot: [{ a: 1 }], salesOrderLinkStatus: undefined };
  const b = { inventorySnapshot: [{ a: 1 }], salesOrderLinkStatus: undefined, status: "COMPLETED", salesOrderId: PHANTOM_ID };
  assert.equal(recordFingerprint(a), recordFingerprint(b));
  assert.notEqual(recordFingerprint(a), recordFingerprint({ ...a, status: "CANCELLED" }));
  assert.notEqual(recordFingerprint(a), recordFingerprint({ ...a, salesOrderLinkStatus: "ORPHANED" }));
  assert.notEqual(recordFingerprint(a), recordFingerprint({ ...a, inventorySnapshot: [{ a: 2 }] }));
});

// ---- classification ----
check("classifyRecord: matching phantom salesOrderId, no prior repair -> NEEDS_REPAIR", () => {
  assert.equal(classifyRecord(wo("wo-1"), PHANTOM_ID).category, "NEEDS_REPAIR");
});
check("classifyRecord: matching phantom salesOrderId, already tombstoned -> ALREADY_REPAIRED, never touched again", () => {
  const c = classifyRecord(wo("wo-1", { salesOrderLinkStatus: "ORPHANED" }), PHANTOM_ID);
  assert.equal(c.category, "ALREADY_REPAIRED");
});
check("classifyRecord: different or absent salesOrderId -> NOT_TARGET (never in scope)", () => {
  assert.equal(classifyRecord(wo("wo-1", { salesOrderId: "so-real-001" }), PHANTOM_ID).category, "NOT_TARGET");
  assert.equal(classifyRecord(wo("wo-1", { salesOrderId: undefined }), PHANTOM_ID).category, "NOT_TARGET");
});
check("classifyRecord: blank-string salesOrderLinkStatus does NOT count as already-repaired", () => {
  assert.equal(classifyRecord(wo("wo-1", { salesOrderLinkStatus: "" }), PHANTOM_ID).category, "NEEDS_REPAIR");
  assert.equal(classifyRecord(wo("wo-1", { salesOrderLinkStatus: "   " }), PHANTOM_ID).category, "NEEDS_REPAIR");
});

// ---- planRepair ----
check("planRepair: only NEEDS_REPAIR records get an assignment; salesOrderId is echoed as UNCHANGED, never proposed to change", () => {
  const records = [
    wo("wo-c713-1"),
    wo("wo-c713-2"),
    wo("wo-c713-3", { status: "CANCELLED", inventorySnapshot: [] }),
    wo("wo-c713-4"),
    wo("wo-c713-5"),
    wo("wo-other", { salesOrderId: "so-real-999" }), // NOT_TARGET
  ];
  const plan = planRepair(records, CTX);
  assert.equal(plan.counts.needsRepair, 5);
  assert.equal(plan.counts.notTarget, 1);
  assert.equal(plan.counts.alreadyRepaired, 0);
  for (const a of plan.assignments) {
    assert.equal(a.proposedChange.salesOrderId, "UNCHANGED");
    assert.equal(a.salesOrderIdBefore, PHANTOM_ID);
    assert.equal(a.proposedChange.salesOrderLinkStatus, "ORPHANED");
    assert.equal(a.proposedChange.salesOrderLinkOrphanedReason, REASON);
    assert.equal(a.proposedChange.salesOrderLinkRepairPackageId, PACKAGE_ID);
  }
  // The manifest carries the FULL pre-repair status + inventorySnapshot per record.
  const wo3 = plan.assignments.find((a) => a.workOrderId === "wo-c713-3");
  assert.equal(wo3.statusBefore, "CANCELLED");
  assert.deepEqual(wo3.inventorySnapshotBefore, []);
});
check("planRepair: deterministic ordering by workOrderId, independent of input order", () => {
  const records = [wo("wo-c713-5"), wo("wo-c713-1"), wo("wo-c713-3")];
  const plan1 = planRepair(records, CTX);
  const plan2 = planRepair([...records].reverse(), CTX);
  assert.deepEqual(plan1.assignments.map((a) => a.workOrderId), plan2.assignments.map((a) => a.workOrderId));
  assert.deepEqual(plan1.assignments.map((a) => a.workOrderId), ["wo-c713-1", "wo-c713-3", "wo-c713-5"]);
});
check("planRepair: duplicate workOrderId in input is refused (INVALID_INPUT)", () => {
  assert.throws(() => planRepair([wo("wo-1"), wo("wo-1")], CTX), (err) => err instanceof PhantomSalesOrderLinkRepairError && err.code === "INVALID_INPUT");
});
check("planRepair: refuses a blank phantomSalesOrderId/reason/repairPackageId", () => {
  assert.throws(() => planRepair([], { ...CTX, phantomSalesOrderId: "" }), /phantomSalesOrderId/);
  assert.throws(() => planRepair([], { ...CTX, reason: "" }), /reason/);
  assert.throws(() => planRepair([], { ...CTX, repairPackageId: "" }), /repairPackageId/);
});

// ---- executeRepair ----
function makeStore({ liveRecords, salesOrderExists }) {
  const staged = [];
  return {
    staged,
    async readWorkOrders() { return liveRecords; },
    async readSalesOrderExists() { return salesOrderExists; },
    stageRepair(workOrderId, fields) { staged.push({ workOrderId, fields }); },
  };
}
await acheck("executeRepair: happy path -- phantom still absent, fingerprints match -> all staged", async () => {
  const records = [wo("wo-c713-1"), wo("wo-c713-2")];
  const plan = planRepair(records, CTX);
  const store = makeStore({ liveRecords: records, salesOrderExists: false });
  const result = await executeRepair({ plan, store, actorId: "tester" });
  assert.equal(result.counts.repaired, 2);
  assert.equal(store.staged.length, 2);
  assert.ok(store.staged.every((s) => s.fields.salesOrderLinkStatus === "ORPHANED"));
});
await acheck("executeRepair: phantom Sales Order now exists -> PHANTOM_RESOLVED, zero writes staged", async () => {
  const records = [wo("wo-c713-1")];
  const plan = planRepair(records, CTX);
  const store = makeStore({ liveRecords: records, salesOrderExists: true });
  await assert.rejects(
    executeRepair({ plan, store, actorId: "tester" }),
    (err) => err instanceof PhantomSalesOrderLinkRepairError && err.code === "PHANTOM_RESOLVED"
  );
  assert.equal(store.staged.length, 0);
});
await acheck("executeRepair: a record changed since planning (STALE_PRESTATE) fails the WHOLE batch closed, not just that record", async () => {
  const records = [wo("wo-c713-1"), wo("wo-c713-2")];
  const plan = planRepair(records, CTX);
  const driftedLive = [wo("wo-c713-1", { status: "CANCELLED" }), wo("wo-c713-2")]; // wo-1 drifted
  const store = makeStore({ liveRecords: driftedLive, salesOrderExists: false });
  await assert.rejects(
    executeRepair({ plan, store, actorId: "tester" }),
    (err) => err instanceof PhantomSalesOrderLinkRepairError && err.code === "STALE_PRESTATE"
  );
  assert.equal(store.staged.length, 0, "no partial staging -- all or nothing");
});
await acheck("executeRepair: a planned record missing from live re-read -> LIVE_SET_DRIFT, zero writes", async () => {
  const records = [wo("wo-c713-1"), wo("wo-c713-2")];
  const plan = planRepair(records, CTX);
  const store = makeStore({ liveRecords: [wo("wo-c713-1")], salesOrderExists: false }); // wo-2 vanished
  await assert.rejects(
    executeRepair({ plan, store, actorId: "tester" }),
    (err) => err instanceof PhantomSalesOrderLinkRepairError && err.code === "LIVE_SET_DRIFT"
  );
  assert.equal(store.staged.length, 0);
});
await acheck("executeRepair: empty plan (nothing to repair) is a no-op, never touches readSalesOrderExists", async () => {
  const plan = planRepair([], CTX);
  let existsCalled = false;
  const store = { async readWorkOrders() { return []; }, async readSalesOrderExists() { existsCalled = true; return false; }, stageRepair() { throw new Error("must not stage"); } };
  const result = await executeRepair({ plan, store, actorId: "tester" });
  assert.equal(result.counts.repaired, 0);
  assert.equal(existsCalled, false);
});

// ---- REPAIR_FIELD_NAMES is the single source of truth rollback binds to ----
check("REPAIR_FIELD_NAMES: exactly the four fields this repair ever writes", () => {
  assert.deepEqual([...REPAIR_FIELD_NAMES].sort(), [
    "salesOrderLinkOrphanedReason",
    "salesOrderLinkRepairPackageId",
    "salesOrderLinkRepairedAt",
    "salesOrderLinkStatus",
  ]);
});

// ---- evidence ----
check("buildPlanEvidence / buildExecutionEvidence: planHash stable across regeneration of identical input, changes on drift", () => {
  const plan = planRepair([wo("wo-c713-1")], CTX);
  const e1 = buildPlanEvidence(plan, { projectId: "p", governedCommit: "c", now: NOW });
  const e2 = buildPlanEvidence(plan, { projectId: "p", governedCommit: "c", now: () => new Date(1_800_000_000_000) });
  assert.equal(e1.planHash, e2.planHash, "planHash excludes generatedAt");
  const planDrifted = planRepair([wo("wo-c713-1", { status: "CANCELLED" })], CTX);
  const e3 = buildPlanEvidence(planDrifted, { projectId: "p", governedCommit: "c", now: NOW });
  assert.notEqual(e1.planHash, e3.planHash);
});
check("scanForSecrets: flags secret-like content", () => {
  assert.ok(scanForSecrets('{"password":"x"}').length > 0);
  assert.equal(scanForSecrets('{"workOrderId":"wo-c713-1","status":"COMPLETED"}').length, 0);
});

// ---- CLI: environment guard (shared X-BACKFILL-ENVIRONMENT-GUARD pattern) ----
const SANDBOX_PROJECT_ID = cli.resolveSandboxProjectId(cli.loadEnvironmentRegistry());
check("environment guard: resolves to exactly the expected sandbox project id", () => {
  assert.equal(SANDBOX_PROJECT_ID, "eos-platform-sandbox");
});
const sandboxBase = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "test"];

check("cli.parseArgs: dry-run default; execute requires ack+plan+plan-sha256; rollback requires ack+execution-result", () => {
  assert.equal(cli.parseArgs(sandboxBase).execute, false);
  assert.equal(cli.parseArgs(sandboxBase).rollback, false);
  assert.throws(() => cli.parseArgs(["--commit", "c", "--evidence-dir", "/ev", "--operator", "t"]), /--project/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--execute"]), /acknowledge-production-write/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--execute", "--acknowledge-production-write"]), /--plan\b/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--execute", "--acknowledge-production-write", "--plan", "/p.json"]), /--plan-sha256/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--rollback"]), /acknowledge-production-write/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--rollback", "--acknowledge-production-write"]), /--execution-result/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--execute", "--rollback"]), /mutually exclusive/);
  const full = cli.parseArgs([...sandboxBase, "--execute", "--acknowledge-production-write", "--plan", "/p.json", "--plan-sha256", "a".repeat(64)]);
  assert.equal(full.execute, true);
  const rb = cli.parseArgs([...sandboxBase, "--rollback", "--acknowledge-production-write", "--execution-result", "/e.json"]);
  assert.equal(rb.rollback, true);
});
check("cli.parseArgs: default --phantom-sales-order-id and --reason match the documented so-harbor-c713 repair; overridable", () => {
  const parsed = cli.parseArgs(sandboxBase);
  assert.equal(parsed.phantomSalesOrderId, cli.DEFAULT_PHANTOM_SALES_ORDER_ID);
  assert.equal(parsed.phantomSalesOrderId, "so-harbor-c713");
  assert.equal(parsed.reason, cli.DEFAULT_REASON);
  const overridden = cli.parseArgs([...sandboxBase, "--phantom-sales-order-id", "so-other", "--reason", "custom reason"]);
  assert.equal(overridden.phantomSalesOrderId, "so-other");
  assert.equal(overridden.reason, "custom reason");
});
check("cli.parseArgs: --environment is required -- absent is a hard error", () => {
  const argv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--environment is required/);
});
check("cli.parseArgs: --environment production is rejected", () => {
  const argv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--environment must be exactly "sandbox"/);
});
check("cli.parseArgs: --project taylor-parts is refused under --environment sandbox", () => {
  const argv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /only accepts --project/);
});
check("cli.parseArgs: near-miss sandbox project ids are refused (not fuzzy-matched)", () => {
  for (const nearMiss of [`${SANDBOX_PROJECT_ID}-2`, `${SANDBOX_PROJECT_ID} `, SANDBOX_PROJECT_ID.toUpperCase()]) {
    const argv = ["--project", nearMiss, "--confirm-project", nearMiss, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
    assert.throws(() => cli.parseArgs(argv), /only accepts --project/, `expected near-miss '${nearMiss}' to be rejected`);
  }
});

// ---- CLI: environment guard fires BEFORE Firebase is ever touched (all three modes) ----
assert.equal(getApps().length, 0, "precondition: no Firebase app has been initialized by anything else in this offline test file");
await acheck("environment guard: a rejected --environment never reaches buildProductionDeps in dry-run mode -- no app registered", async () => {
  const rejectedArgv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  await assert.rejects(cli.main(rejectedArgv), /--environment must be exactly "sandbox"/);
  assert.equal(getApps().length, 0);
});
await acheck("environment guard: a rejected --environment never reaches buildProductionDeps in --execute mode -- no app registered", async () => {
  const rejectedArgv = [
    "--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production",
    "--commit", "c", "--evidence-dir", "/ev", "--operator", "t",
    "--execute", "--acknowledge-production-write", "--plan", "/p.json", "--plan-sha256", "a".repeat(64),
  ];
  await assert.rejects(cli.main(rejectedArgv), /--environment must be exactly "sandbox"/);
  assert.equal(getApps().length, 0);
});
await acheck("environment guard: a rejected --environment never reaches buildProductionDeps in --rollback mode -- no app registered", async () => {
  const rejectedArgv = [
    "--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production",
    "--commit", "c", "--evidence-dir", "/ev", "--operator", "t",
    "--rollback", "--acknowledge-production-write", "--execution-result", "/e.json",
  ];
  await assert.rejects(cli.main(rejectedArgv), /--environment must be exactly "sandbox"/);
  assert.equal(getApps().length, 0);
});

// ---- CLI: publishEvidenceAtomically ----
function fakeFs() {
  const files = new Map(); const dirs = new Set();
  return {
    stamp: "T", files, dirs,
    mkdirp: (d) => dirs.add(d),
    rmrf: (d) => { dirs.delete(d); for (const k of [...files.keys()]) if (k.startsWith(d)) files.delete(k); },
    writeFile: (p, c) => files.set(p, c),
    exists: (p) => dirs.has(p),
    rename: (a, b) => { dirs.delete(a); dirs.add(b); for (const [k, v] of [...files]) if (k.startsWith(a)) { files.set(b + k.slice(a.length), v); files.delete(k); } },
  };
}
check("cli.publishEvidenceAtomically: secret-like content blocks publish; NO final dir left behind", () => {
  const fs = fakeFs();
  assert.throws(() => cli.publishEvidenceAtomically(fs, "/ev/run", [{ name: "leak.json", content: '{"password":"hunter2"}' }]), /secret-like/);
  assert.ok(!fs.dirs.has("/ev/run"));
  assert.ok(![...fs.dirs].some((d) => d.includes(".tmp-")));
});

// ---- CLI: runDryRun end-to-end with fake deps ----
await acheck("cli.runDryRun: reads candidates for the phantom id, writes plan.json + plan-report.md", async () => {
  const records = [wo("wo-c713-1"), wo("wo-c713-2"), wo("wo-c713-3", { status: "CANCELLED", inventorySnapshot: [] }), wo("wo-c713-4"), wo("wo-c713-5")];
  const deps = { fs: fakeFs(), now: NOW, readCandidateWorkOrders: async (id) => { assert.equal(id, PHANTOM_ID); return records; } };
  const args = { projectId: "p", governedCommit: "c".repeat(40), evidenceDir: "/ev/dry", phantomSalesOrderId: PHANTOM_ID, reason: REASON };
  const { plan, evidenceDir } = await cli.runDryRun(deps, args);
  assert.equal(evidenceDir, "/ev/dry");
  assert.equal(plan.assignments.length, 5);
  assert.ok([...deps.fs.files.keys()].some((k) => k.endsWith("plan.json")));
  assert.ok([...deps.fs.files.keys()].some((k) => k.endsWith("plan-report.md")));
});

// ---- CLI: runExecute hash-binding ----
await acheck("cli.runExecute: mismatched --plan-sha256 -> zero writes (txn never invoked)", async () => {
  const rawPlan = JSON.stringify({ kind: "phantom-sales-order-link-repair-plan", projectId: "p", governedCommit: "c" });
  let txnCalls = 0;
  const deps = { fs: fakeFs(), now: NOW, readPlanRaw: async () => rawPlan, runExecuteTxn: async () => { txnCalls += 1; return { result: { repaired: [], counts: { repaired: 0, skippedAlreadyRepaired: 0 } }, postRepairUpdateTimes: new Map() }; } };
  const args = { projectId: "p", governedCommit: "c", evidenceDir: "/ev/x", planPath: "/p.json", planSha256: "b".repeat(64) };
  await assert.rejects(cli.runExecute(deps, args), /hash mismatch/);
  assert.equal(txnCalls, 0);
});
await acheck("cli.runExecute: happy path -- valid plan hash binds through to the txn, publishes execution-result.json with postRepairUpdateTimeMillis", async () => {
  const records = [wo("wo-c713-1")];
  const plan = planRepair(records, CTX);
  const planEvidence = buildPlanEvidence(plan, { projectId: "p", governedCommit: "c", now: NOW });
  const rawPlan = serializeEvidence(planEvidence);
  const realHash = createHash("sha256").update(rawPlan, "utf8").digest("hex");
  let boundPlan = null;
  const deps = {
    fs: fakeFs(), now: NOW,
    readPlanRaw: async () => rawPlan,
    runExecuteTxn: async ({ plan: p }) => {
      boundPlan = p;
      const result = { repaired: p.assignments.map((a) => ({ workOrderId: a.workOrderId })), counts: { repaired: p.assignments.length, skippedAlreadyRepaired: 0 } };
      const postRepairUpdateTimes = new Map(p.assignments.map((a) => [a.workOrderId, 1_700_000_000_001]));
      return { result, postRepairUpdateTimes };
    },
  };
  const args = { projectId: "p", governedCommit: "c", evidenceDir: "/ev/exec", planPath: "/p.json", planSha256: realHash };
  const { result, evidenceDir } = await cli.runExecute(deps, args);
  assert.equal(evidenceDir, "/ev/exec");
  assert.equal(result.counts.repaired, 1);
  assert.equal(boundPlan.assignments[0].workOrderId, "wo-c713-1");
  const execKey = [...deps.fs.files.keys()].find((k) => k.endsWith("execution-result.json"));
  const execJson = JSON.parse(deps.fs.files.get(execKey));
  assert.equal(execJson.repaired[0].postRepairUpdateTimeMillis, 1_700_000_000_001);
});

// ---- CLI: runRollback ----
await acheck("cli.runRollback: reads execution-result.json, calls runRollbackBatch, publishes rollback-result.json", async () => {
  const execEvidence = buildExecutionEvidence(
    { repaired: [{ workOrderId: "wo-c713-1" }], counts: { repaired: 1, skippedAlreadyRepaired: 0 } },
    new Map([["wo-c713-1", 1_700_000_000_001]]),
    { projectId: "p", governedCommit: "c", boundPlanHash: "h".repeat(64), now: NOW }
  );
  const rawExec = serializeEvidence(execEvidence);
  let batchArgs = null;
  const deps = {
    fs: fakeFs(), now: NOW,
    readExecutionResultRaw: async () => rawExec,
    runRollbackBatch: async ({ repaired }) => { batchArgs = repaired; return { rolledBack: ["wo-c713-1"], skipped: [] }; },
  };
  const args = { projectId: "p", governedCommit: "c", evidenceDir: "/ev/rb", executionResultPath: "/e.json" };
  const { evidenceDir } = await cli.runRollback(deps, args);
  assert.equal(evidenceDir, "/ev/rb");
  assert.equal(batchArgs.length, 1);
  assert.equal(batchArgs[0].workOrderId, "wo-c713-1");
  const rbKey = [...deps.fs.files.keys()].find((k) => k.endsWith("rollback-result.json"));
  const rbJson = JSON.parse(deps.fs.files.get(rbKey));
  assert.equal(rbJson.rolledBack.length, 1);
});
await acheck("cli.runRollback: rejects an execution-result.json for a different project", async () => {
  const rawExec = JSON.stringify({ kind: "phantom-sales-order-link-repair-execution", projectId: "other-project", repaired: [] });
  const deps = { fs: fakeFs(), now: NOW, readExecutionResultRaw: async () => rawExec, runRollbackBatch: async () => { throw new Error("must not be called"); } };
  const args = { projectId: "p", governedCommit: "c", evidenceDir: "/ev/rb2", executionResultPath: "/e.json" };
  await assert.rejects(cli.runRollback(deps, args), /project does not match/);
});
await acheck("cli.runRollback: rejects a file that is not a phantom-sales-order-link-repair execution-result.json", async () => {
  const rawExec = JSON.stringify({ kind: "sales-order-number-backfill-execution", projectId: "p" });
  const deps = { fs: fakeFs(), now: NOW, readExecutionResultRaw: async () => rawExec, runRollbackBatch: async () => { throw new Error("must not be called"); } };
  const args = { projectId: "p", governedCommit: "c", evidenceDir: "/ev/rb3", executionResultPath: "/e.json" };
  await assert.rejects(cli.runRollback(deps, args), /does not look like/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
