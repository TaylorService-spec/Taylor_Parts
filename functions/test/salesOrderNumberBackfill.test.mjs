// X-SALES-ORDER-NUMBER-BACKFILL -- offline unit tests for the backfill core
// (functions/src/salesOrder/salesOrderNumberBackfill.ts, salesOrderNumberBackfillEvidence.ts) + operator CLI
// orchestration (functions/scripts/salesOrderNumberBackfillCli.js). PURE: no Firebase app, no emulator, no
// network. `Timestamp` is constructed offline. Prerequisite: npm run build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getApps } from "firebase-admin/app";
import {
  UNKNOWN_YEAR_SENTINEL,
  recordFingerprint,
  classifyRecord,
  planBackfill,
  executeBackfill,
  SalesOrderBackfillError,
} from "../lib/salesOrder/salesOrderNumberBackfill.js";
import { formatSalesOrderNumber } from "../lib/salesOrder/salesOrderNumbering.js";
import { buildPlanEvidence, buildExecutionEvidence, scanForSecrets, serializeEvidence } from "../lib/salesOrder/salesOrderNumberBackfillEvidence.js";
const cliMod = await import("../scripts/salesOrderNumberBackfillCli.js");
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
const T2019 = Timestamp.fromDate(new Date(Date.UTC(2019, 5, 15, 0, 0, 0)));
const T2020 = Timestamp.fromDate(new Date(Date.UTC(2020, 2, 1, 0, 0, 0)));
const T2020_LATER = Timestamp.fromDate(new Date(Date.UTC(2020, 2, 2, 0, 0, 0)));

const rec = (id, over = {}) => ({ salesOrderId: id, salesOrderNumber: undefined, createdAt: undefined, ...over });
const zeroCounters = () => 0;

// ---- fingerprint ----
check("recordFingerprint: deterministic + key-order independent + drift-sensitive", () => {
  const a = { salesOrderNumber: undefined, createdAt: T2019 };
  const b = { createdAt: T2019, salesOrderNumber: undefined };
  assert.equal(recordFingerprint(a), recordFingerprint(b));
  assert.notEqual(recordFingerprint(a), recordFingerprint({ salesOrderNumber: "SO-2019-000001", createdAt: T2019 }));
  assert.notEqual(recordFingerprint(a), recordFingerprint({ salesOrderNumber: undefined, createdAt: T2020 }));
});

// ---- classification ----
check("classifyRecord: already-numbered (any non-blank string) -> ALREADY_NUMBERED, never touched", () => {
  const c = classifyRecord(rec("a", { salesOrderNumber: "SO-2024-000007" }));
  assert.equal(c.category, "ALREADY_NUMBERED");
  assert.equal(c.year, null);
});
check("classifyRecord: blank/whitespace salesOrderNumber still counts as unnumbered", () => {
  assert.equal(classifyRecord(rec("a", { salesOrderNumber: "" })).category, "NEEDS_ASSIGNMENT");
  assert.equal(classifyRecord(rec("a", { salesOrderNumber: "   " })).category, "NEEDS_ASSIGNMENT");
  assert.equal(classifyRecord(rec("a", { salesOrderNumber: null })).category, "NEEDS_ASSIGNMENT");
});
check("classifyRecord: valid createdAt Timestamp is authoritative for year (UTC)", () => {
  const c = classifyRecord(rec("a", { createdAt: T2019 }));
  assert.equal(c.category, "NEEDS_ASSIGNMENT");
  assert.equal(c.yearPolicy, "CREATED_AT");
  assert.equal(c.year, 2019);
  assert.equal(c.createdAtMillis, T2019.toMillis());
});
check("classifyRecord: missing/invalid createdAt -> UNKNOWN_YEAR_SENTINEL, explicit non-chronological policy", () => {
  for (const bad of [undefined, null, "2019-06-15", 1_560_000_000_000, {}]) {
    const c = classifyRecord(rec("a", { createdAt: bad }));
    assert.equal(c.category, "NEEDS_ASSIGNMENT");
    assert.equal(c.yearPolicy, "UNKNOWN_SENTINEL");
    assert.equal(c.year, UNKNOWN_YEAR_SENTINEL);
    assert.equal(c.createdAtMillis, null);
  }
});

// ---- planBackfill: determinism ----
check("planBackfill: identical input state produces the identical plan every run", () => {
  const records = [
    rec("so-c", { createdAt: T2020 }),
    rec("so-a", { createdAt: T2020_LATER }),
    rec("so-b", { createdAt: T2019 }),
    rec("so-unk-2", {}),
    rec("so-unk-1", {}),
  ];
  const plan1 = planBackfill(records, zeroCounters);
  const plan2 = planBackfill([...records].reverse(), zeroCounters); // input order should not matter
  const strip = (p) => p.assignments.map((a) => ({ id: a.salesOrderId, n: a.salesOrderNumber, seq: a.sequence }));
  assert.deepEqual(strip(plan1), strip(plan2));
});
check("planBackfill: orders by (year, createdAt millis, id) -- earlier createdAt gets the lower sequence within a year", () => {
  const plan = planBackfill([rec("so-a", { createdAt: T2020_LATER }), rec("so-b", { createdAt: T2020 })], zeroCounters);
  const byId = Object.fromEntries(plan.assignments.map((a) => [a.salesOrderId, a.sequence]));
  assert.ok(byId["so-b"] < byId["so-a"], "earlier createdAt (so-b) must get the lower sequence");
});
check("planBackfill: UNKNOWN_SENTINEL bucket orders by document id only (no invented chronology)", () => {
  const plan = planBackfill([rec("z-later-id"), rec("a-earlier-id")], zeroCounters);
  const byId = Object.fromEntries(plan.assignments.map((a) => [a.salesOrderId, a.sequence]));
  assert.ok(byId["a-earlier-id"] < byId["z-later-id"]);
  assert.ok(plan.assignments.every((a) => a.year === UNKNOWN_YEAR_SENTINEL));
});

// ---- planBackfill: idempotency ----
check("planBackfill: an already-numbered record is NEVER included in assignments, regardless of position", () => {
  const plan = planBackfill([rec("num", { salesOrderNumber: "SO-2019-000005" }), rec("unnum", { createdAt: T2019 })], zeroCounters);
  assert.deepEqual(plan.alreadyNumbered, ["num"]);
  assert.equal(plan.assignments.some((a) => a.salesOrderId === "num"), false);
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].salesOrderId, "unnum");
});
check("planBackfill: a rerun that supplies only the remaining unnumbered records continues the sequence, not restarts it", () => {
  const first = planBackfill([rec("a", { createdAt: T2019 }), rec("b", { createdAt: T2019 })], zeroCounters);
  assert.equal(first.assignments.length, 2);
  // Simulate: "a" got committed (now numbered); rerun sees "a" numbered + "b" still unnumbered, counter
  // advanced by the prior commit.
  const counterAfterFirstCommit = (year) => (year === 2019 ? 1 : 0);
  const second = planBackfill([rec("a", { salesOrderNumber: first.assignments[0].salesOrderNumber }), rec("b", { createdAt: T2019 })], counterAfterFirstCommit);
  assert.deepEqual(second.alreadyNumbered, ["a"]);
  assert.equal(second.assignments.length, 1);
  assert.equal(second.assignments[0].salesOrderId, "b");
  assert.equal(second.assignments[0].sequence, 2, "continues from the advanced counter, not from 1 again");
});

// ---- planBackfill: collision detection ----
check("planBackfill: a candidate that duplicates an existing salesOrderNumber is a COLLISION, excluded from assignments", () => {
  const collidingNumber = formatSalesOrderNumber(2021, 1);
  const plan = planBackfill([rec("legacy", { salesOrderNumber: collidingNumber }), rec("new", { createdAt: Timestamp.fromDate(new Date(Date.UTC(2021, 0, 1))) })], zeroCounters);
  assert.equal(plan.collisions.length, 1);
  assert.equal(plan.collisions[0].salesOrderId, "new");
  assert.equal(plan.collisions[0].candidateSalesOrderNumber, collidingNumber);
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.counts.collisions, 1);
});
check("planBackfill: a collision blocks the REST of that year's records (undecidable sequence), other years unaffected", () => {
  const collidingNumber = formatSalesOrderNumber(2021, 1);
  const t2021a = Timestamp.fromDate(new Date(Date.UTC(2021, 0, 1)));
  const t2021b = Timestamp.fromDate(new Date(Date.UTC(2021, 0, 2)));
  const plan = planBackfill(
    [
      rec("legacy", { salesOrderNumber: collidingNumber }),
      rec("new-1", { createdAt: t2021a }),
      rec("new-2", { createdAt: t2021b }),
      rec("other-year", { createdAt: T2019 }),
    ],
    zeroCounters
  );
  assert.equal(plan.collisions.length, 1);
  assert.equal(plan.collisions[0].salesOrderId, "new-1");
  assert.deepEqual(plan.blocked.map((b) => b.salesOrderId), ["new-2"]);
  assert.equal(plan.assignments.some((a) => a.salesOrderId === "other-year"), true, "an unrelated year must still be assignable");
});

// ---- executeBackfill (fake in-memory store) ----
function fakeStore({ liveRecords, counters }) {
  const stagedCounters = [];
  const stagedAssignments = [];
  return {
    stagedCounters,
    stagedAssignments,
    async readAllSalesOrders(ids) {
      return ids.map((id) => liveRecords.get(id) ?? undefined).filter((r) => r !== undefined);
    },
    async readCounterSequence(year) {
      return counters.get(year) ?? 0;
    },
    stageCounter(year, newSequence) { stagedCounters.push({ year, newSequence }); },
    stageAssignment(salesOrderId, salesOrderNumber) { stagedAssignments.push({ salesOrderId, salesOrderNumber }); },
  };
}

await acheck("executeBackfill: happy path stages exactly the planned assignments + final counter values", async () => {
  const live = new Map([
    ["a", { salesOrderId: "a", salesOrderNumber: undefined, createdAt: T2019 }],
    ["b", { salesOrderId: "b", salesOrderNumber: undefined, createdAt: T2019 }],
  ]);
  const plan = planBackfill([rec("a", { createdAt: T2019 }), rec("b", { createdAt: T2019 })], zeroCounters);
  const store = fakeStore({ liveRecords: live, counters: new Map() });
  const result = await executeBackfill({ plan, store, actorId: "tool" });
  assert.equal(result.counts.assigned, 2);
  assert.deepEqual(store.stagedCounters, [{ year: 2019, newSequence: 2 }]);
  assert.equal(store.stagedAssignments.length, 2);
  assert.ok(store.stagedAssignments.every((a) => a.salesOrderNumber.startsWith("SO-2019-")));
});

await acheck("executeBackfill: refuses ANY writes when the plan contains a collision", async () => {
  const collidingNumber = formatSalesOrderNumber(2021, 1);
  const plan = planBackfill([rec("legacy", { salesOrderNumber: collidingNumber }), rec("new", { createdAt: Timestamp.fromDate(new Date(Date.UTC(2021, 0, 1))) })], zeroCounters);
  const store = fakeStore({ liveRecords: new Map(), counters: new Map() });
  await assert.rejects(executeBackfill({ plan, store, actorId: "tool" }), (e) => e instanceof SalesOrderBackfillError && e.code === "COLLISION_DETECTED");
  assert.equal(store.stagedAssignments.length, 0);
  assert.equal(store.stagedCounters.length, 0);
});

await acheck("executeBackfill: a record that got numbered since the plan was made -> STALE_PRESTATE, zero writes (idempotent rerun safety)", async () => {
  const plan = planBackfill([rec("a", { createdAt: T2019 })], zeroCounters);
  const live = new Map([["a", { salesOrderId: "a", salesOrderNumber: "SO-2019-000001", createdAt: T2019 }]]); // already numbered now
  const store = fakeStore({ liveRecords: live, counters: new Map() });
  await assert.rejects(executeBackfill({ plan, store, actorId: "tool" }), (e) => e.code === "STALE_PRESTATE");
  assert.equal(store.stagedAssignments.length, 0);
});

await acheck("executeBackfill: counter moved since the plan was made -> COUNTER_DRIFT, zero writes", async () => {
  const plan = planBackfill([rec("a", { createdAt: T2019 })], zeroCounters); // plan assumed sequenceBefore=0
  const live = new Map([["a", { salesOrderId: "a", salesOrderNumber: undefined, createdAt: T2019 }]]);
  const store = fakeStore({ liveRecords: live, counters: new Map([[2019, 5]]) }); // now 5 -- something else advanced it
  await assert.rejects(executeBackfill({ plan, store, actorId: "tool" }), (e) => e.code === "COUNTER_DRIFT");
  assert.equal(store.stagedAssignments.length, 0);
});

await acheck("executeBackfill: a planned record deleted since planning -> LIVE_SET_DRIFT, zero writes", async () => {
  const plan = planBackfill([rec("a", { createdAt: T2019 })], zeroCounters);
  const store = fakeStore({ liveRecords: new Map(), counters: new Map() }); // "a" gone
  await assert.rejects(executeBackfill({ plan, store, actorId: "tool" }), (e) => e.code === "LIVE_SET_DRIFT");
  assert.equal(store.stagedAssignments.length, 0);
});

await acheck("executeBackfill: recordId (document identity) is never touched -- only stageAssignment(id, number) is called, id passthrough", async () => {
  const live = new Map([["preserve-me", { salesOrderId: "preserve-me", salesOrderNumber: undefined, createdAt: T2019 }]]);
  const plan = planBackfill([rec("preserve-me", { createdAt: T2019 })], zeroCounters);
  const store = fakeStore({ liveRecords: live, counters: new Map() });
  await executeBackfill({ plan, store, actorId: "tool" });
  assert.equal(store.stagedAssignments[0].salesOrderId, "preserve-me");
});

await acheck("executeBackfill: idempotent no-op when the plan has nothing to assign (all already numbered)", async () => {
  const plan = planBackfill([rec("a", { salesOrderNumber: "SO-2019-000001" })], zeroCounters);
  const store = fakeStore({ liveRecords: new Map(), counters: new Map() });
  const result = await executeBackfill({ plan, store, actorId: "tool" });
  assert.deepEqual(result, { assigned: [], counts: { assigned: 0, skippedAlreadyNumbered: 1 } });
  assert.equal(store.stagedAssignments.length, 0);
  assert.equal(store.stagedCounters.length, 0);
});

// ---- evidence ----
check("evidence: plan hash is stable across re-serialization and excludes generatedAt", () => {
  const plan = planBackfill([rec("a", { createdAt: T2019 })], zeroCounters);
  const e1 = buildPlanEvidence(plan, { projectId: "p", governedCommit: "c", now: NOW });
  const e2 = buildPlanEvidence(plan, { projectId: "p", governedCommit: "c", now: () => new Date(NOW().getTime() + 60_000) });
  assert.equal(e1.planHash, e2.planHash, "planHash must not depend on generatedAt");
  assert.notEqual(e1.generatedAt, e2.generatedAt);
});
check("evidence: no sensitive-value pattern matches plan or execution evidence", () => {
  const plan = planBackfill([rec("a", { createdAt: T2019 })], zeroCounters);
  const planEv = buildPlanEvidence(plan, { projectId: "taylor-parts", governedCommit: "c".repeat(40), now: NOW });
  assert.equal(scanForSecrets(serializeEvidence(planEv)).length, 0);
  const execEv = buildExecutionEvidence({ assigned: [{ salesOrderId: "a", salesOrderNumber: "SO-2019-000001" }], counts: { assigned: 1, skippedAlreadyNumbered: 0 } }, { projectId: "taylor-parts", governedCommit: "c".repeat(40), boundPlanHash: planEv.planHash, now: NOW });
  assert.equal(scanForSecrets(serializeEvidence(execEv)).length, 0);
});

// ---- CLI: environment guard (X-BACKFILL-ENVIRONMENT-GUARD) ----
// The registry-resolved sandbox project id is read through the SAME function the CLI itself uses
// (cli.resolveSandboxProjectId + cli.loadEnvironmentRegistry), so this suite never hardcodes a second
// copy of the id that could silently drift from config/environments.json.
const SANDBOX_PROJECT_ID = cli.resolveSandboxProjectId(cli.loadEnvironmentRegistry());
check("environment guard: resolves to exactly the expected sandbox project id", () => {
  assert.equal(SANDBOX_PROJECT_ID, "eos-platform-sandbox");
});

const sandboxBase = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "test"];

// ---- CLI: parseArgs ----
check("cli.parseArgs: dry-run default; requires project confirm; execute requires ack + plan + plan-sha256", () => {
  assert.equal(cli.parseArgs(sandboxBase).execute, false);
  assert.throws(() => cli.parseArgs(["--commit", "c", "--evidence-dir", "/ev", "--operator", "t"]), /--project/);
  assert.throws(() => cli.parseArgs(["--project", SANDBOX_PROJECT_ID, "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"]), /--confirm-project/);
  assert.throws(() => cli.parseArgs(["--project", SANDBOX_PROJECT_ID, "--confirm-project", "other", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"]), /does not match/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--execute"]), /acknowledge-production-write/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--execute", "--acknowledge-production-write"]), /--plan\b/);
  assert.throws(() => cli.parseArgs([...sandboxBase, "--execute", "--acknowledge-production-write", "--plan", "/p.json"]), /--plan-sha256/);
  const full = cli.parseArgs([...sandboxBase, "--execute", "--acknowledge-production-write", "--plan", "/p.json", "--plan-sha256", "a".repeat(64)]);
  assert.equal(full.execute, true);
});

check("cli.parseArgs: --environment is required -- absent is a hard error", () => {
  const argv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--environment is required/);
});

check("cli.parseArgs: --environment production is rejected", () => {
  const argv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--environment must be exactly "sandbox"/);
});

check("cli.parseArgs: an unknown/typo --environment value is rejected (not just literal 'production')", () => {
  for (const bad of ["prod", "PRODUCTION", "Sandbox", "staging"]) {
    const argv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--environment", bad, "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
    assert.throws(() => cli.parseArgs(argv), /--environment must be exactly "sandbox"/, `expected '${bad}' to be rejected`);
  }
  // An explicitly empty --environment value is falsy, so it is caught by the "required" branch rather than
  // the "must be exactly sandbox" branch -- still a hard rejection, just a different (equally explicit) message.
  const emptyArgv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--environment", "", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(emptyArgv), /--environment is required/, "expected empty --environment to be rejected");
});

check("cli.parseArgs: --project taylor-parts is refused under --environment sandbox, even with a matching --confirm-project", () => {
  const argv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /only accepts --project/);
});

check("cli.parseArgs: --project is required even under --environment sandbox (no implicit default)", () => {
  const argv = ["--confirm-project", SANDBOX_PROJECT_ID, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /--project is required/);
});

check("cli.parseArgs: mismatched --confirm-project is still rejected under --environment sandbox (identity check unchanged)", () => {
  const argv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", "not-the-same", "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  assert.throws(() => cli.parseArgs(argv), /does not match/);
});

check("cli.parseArgs: near-miss sandbox project ids are refused (not fuzzy-matched)", () => {
  for (const nearMiss of [`${SANDBOX_PROJECT_ID}-2`, `${SANDBOX_PROJECT_ID} `, ` ${SANDBOX_PROJECT_ID}`, "eos-platform-sandb0x", SANDBOX_PROJECT_ID.toUpperCase()]) {
    const argv = ["--project", nearMiss, "--confirm-project", nearMiss, "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
    assert.throws(() => cli.parseArgs(argv), /only accepts --project/, `expected near-miss '${nearMiss}' to be rejected`);
  }
});

check("cli.parseArgs: happy path still parses under the guard (guard is not proven only by its refusals)", () => {
  const parsed = cli.parseArgs(sandboxBase);
  assert.equal(parsed.projectId, SANDBOX_PROJECT_ID);
  assert.equal(parsed.confirmProjectId, SANDBOX_PROJECT_ID);
  assert.equal(parsed.environment, "sandbox");
  assert.equal(parsed.execute, false);
});

// ---- CLI: environment guard fires BEFORE Firebase is ever touched ----
// The real safety property is WHEN the rejection happens, not just THAT it happens. `main()` is the exact
// argv -> parseArgs -> buildProductionDeps -> run() chain the real CLI entrypoint uses; buildProductionDeps
// is the ONLY function in this file that calls `admin.initializeApp(...)` (and the only place firebase-admin
// is required and Firestore is ever touched). `getApps()` (firebase-admin/app) reads the SAME global app
// registry `admin.initializeApp` writes to, regardless of whether it's reached via the CJS `require("firebase-
// admin")` this CLI uses or the ESM `firebase-admin/app` this test imports -- so if the guard's rejection
// were ever moved to AFTER buildProductionDeps() runs, `getApps().length` would go from 0 to 1 and this
// assertion would fail, not pass silently.
assert.equal(getApps().length, 0, "precondition: no Firebase app has been initialized by anything else in this offline test file");
await acheck("environment guard: a rejected --environment never reaches buildProductionDeps (fails closed BEFORE Firebase init -- no app registered)", async () => {
  const rejectedArgv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "production", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  await assert.rejects(cli.main(rejectedArgv), /--environment must be exactly "sandbox"/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore admin.initializeApp) must never run when --environment is rejected");
});
await acheck("environment guard: a rejected sandbox-project mismatch also never reaches buildProductionDeps -- no app registered", async () => {
  const rejectedArgv = ["--project", "taylor-parts", "--confirm-project", "taylor-parts", "--environment", "sandbox", "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  await assert.rejects(cli.main(rejectedArgv), /only accepts --project/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore admin.initializeApp) must never run when the sandbox project id is rejected");
});
await acheck("environment guard: missing --environment also never reaches buildProductionDeps -- no app registered", async () => {
  const rejectedArgv = ["--project", SANDBOX_PROJECT_ID, "--confirm-project", SANDBOX_PROJECT_ID, "--commit", "c", "--evidence-dir", "/ev", "--operator", "t"];
  await assert.rejects(cli.main(rejectedArgv), /--environment is required/);
  assert.equal(getApps().length, 0, "buildProductionDeps (and therefore admin.initializeApp) must never run when --environment is missing");
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
check("cli.publishEvidenceAtomically: happy path writes files + checksums to final dir", () => {
  const fs = fakeFs();
  const dir = cli.publishEvidenceAtomically(fs, "/ev/run", [{ name: "plan.json", content: '{"kind":"sales-order-number-backfill-plan"}' }]);
  assert.equal(dir, "/ev/run");
  assert.ok(fs.dirs.has("/ev/run"));
  assert.ok([...fs.files.keys()].some((k) => k.includes("checksums.sha256")));
  assert.ok(![...fs.dirs].some((d) => d.includes(".tmp-")), "temp dir cleaned");
});
check("cli.publishEvidenceAtomically: secret-like content blocks publish; NO final dir left behind", () => {
  const fs = fakeFs();
  assert.throws(() => cli.publishEvidenceAtomically(fs, "/ev/run", [{ name: "leak.json", content: '{"password":"hunter2"}' }]), /secret-like/);
  assert.ok(!fs.dirs.has("/ev/run"));
  assert.ok(![...fs.dirs].some((d) => d.includes(".tmp-")));
});

// ---- CLI: runDryRun end-to-end with fake deps (mutates nothing but in-memory fakes) ----
function dryRunDeps({ records, counters }) {
  const fs = fakeFs();
  return {
    fs,
    now: NOW,
    readAllSalesOrders: async () => records,
    readCounterSequenceSync: (year) => counters.get(year) ?? 0,
  };
}
await acheck("cli.runDryRun: writes plan.json + plan-report.md; touches nothing else", async () => {
  const deps = dryRunDeps({ records: [rec("a", { createdAt: T2019 })], counters: new Map() });
  const args = { projectId: "taylor-parts", governedCommit: "c".repeat(40), evidenceDir: "/ev/dry" };
  const { plan, planEvidence, evidenceDir } = await cli.runDryRun(deps, args);
  assert.equal(evidenceDir, "/ev/dry");
  assert.equal(plan.assignments.length, 1);
  assert.ok([...deps.fs.files.keys()].some((k) => k.endsWith("plan.json")));
  assert.ok([...deps.fs.files.keys()].some((k) => k.endsWith("plan-report.md")));
  assert.equal(planEvidence.counts.toAssign, 1);
});

// The report tells the operator which value to pass to --plan-sha256. runExecute binds the sha256 of the
// plan.json FILE BYTES, not planEvidence.planHash (the narrower operative hash). This asserts the printed
// instruction is the value the execute gate actually accepts -- the report used to print the operative hash
// under that label, which fails closed at execute with a bare "plan hash mismatch".
await acheck("cli.runDryRun: the report's --plan-sha256 value is the sha256 of the published plan.json bytes", async () => {
  const deps = dryRunDeps({ records: [rec("a", { createdAt: T2019 })], counters: new Map() });
  const args = { projectId: "taylor-parts", governedCommit: "c".repeat(40), evidenceDir: "/ev/bind" };
  const { planEvidence, planFileSha256 } = await cli.runDryRun(deps, args);

  const planKey = [...deps.fs.files.keys()].find((k) => k.endsWith("plan.json"));
  const reportKey = [...deps.fs.files.keys()].find((k) => k.endsWith("plan-report.md"));
  const sumsKey = [...deps.fs.files.keys()].find((k) => k.endsWith("checksums.sha256"));
  const planBytes = deps.fs.files.get(planKey);
  const report = deps.fs.files.get(reportKey);

  const expected = createHash("sha256").update(planBytes, "utf8").digest("hex");
  assert.equal(planFileSha256, expected);

  const printed = /--plan-sha256 at execute \(sha256 of plan\.json bytes\): ([0-9a-f]{64})/.exec(report);
  assert.ok(printed, "report must print the bind value under an unambiguous label");
  assert.equal(printed[1], expected);
  assert.notEqual(printed[1], planEvidence.planHash, "the bind value is NOT the operative plan hash");

  // Same value the published checksums line carries, so the two artifacts cannot disagree.
  assert.ok(deps.fs.files.get(sumsKey).includes(`${expected}  plan.json`));

  // And it is the value runExecute accepts: hash-binding passes with it.
  let txnCalls = 0;
  const execDeps = {
    fs: fakeFs(),
    now: NOW,
    readPlanRaw: async () => planBytes,
    runExecuteTxn: async ({ plan }) => { txnCalls += 1; return { assigned: plan.assignments, counts: { assigned: plan.assignments.length, skippedAlreadyNumbered: 0 } }; },
  };
  await cli.runExecute(execDeps, {
    projectId: "taylor-parts", governedCommit: "c".repeat(40), evidenceDir: "/ev/bind-exec",
    planPath: "/p.json", planSha256: expected,
  });
  assert.equal(txnCalls, 1);
});

// ---- CLI: runExecute hash-binding ----
await acheck("cli.runExecute: mismatched --plan-sha256 -> zero writes (txn never invoked)", async () => {
  const rawPlan = JSON.stringify({ kind: "sales-order-number-backfill-plan", projectId: "taylor-parts", governedCommit: "c".repeat(40), planHash: "irrelevant" });
  let txnCalls = 0;
  const deps = {
    fs: fakeFs(),
    now: NOW,
    readPlanRaw: async () => rawPlan,
    runExecuteTxn: async () => { txnCalls += 1; return { assigned: [], counts: { assigned: 0, skippedAlreadyNumbered: 0 } }; },
  };
  const args = { projectId: "taylor-parts", governedCommit: "c".repeat(40), evidenceDir: "/ev/x", planPath: "/p.json", planSha256: "b".repeat(64) };
  await assert.rejects(cli.runExecute(deps, args), /hash mismatch/);
  assert.equal(txnCalls, 0);
});
await acheck("cli.runExecute: hash matches but plan.json's project/commit does not match the invocation -> zero writes", async () => {
  const rawPlanWrongProject = JSON.stringify({ kind: "sales-order-number-backfill-plan", projectId: "some-other-project", governedCommit: "c".repeat(40), planHash: "x" });
  const hashA = createHash("sha256").update(rawPlanWrongProject, "utf8").digest("hex");
  let txnCalls = 0;
  const deps = {
    fs: fakeFs(), now: NOW,
    readPlanRaw: async () => rawPlanWrongProject,
    runExecuteTxn: async () => { txnCalls += 1; return { assigned: [], counts: { assigned: 0, skippedAlreadyNumbered: 0 } }; },
  };
  const argsWrongProject = { projectId: "taylor-parts", governedCommit: "c".repeat(40), evidenceDir: "/ev/x", planPath: "/p.json", planSha256: hashA };
  await assert.rejects(cli.runExecute(deps, argsWrongProject), /project does not match/);
  assert.equal(txnCalls, 0);

  const rawPlanWrongCommit = JSON.stringify({ kind: "sales-order-number-backfill-plan", projectId: "taylor-parts", governedCommit: "d".repeat(40), planHash: "x" });
  const hashB = createHash("sha256").update(rawPlanWrongCommit, "utf8").digest("hex");
  const depsB = { ...deps, readPlanRaw: async () => rawPlanWrongCommit };
  const argsWrongCommit = { projectId: "taylor-parts", governedCommit: "c".repeat(40), evidenceDir: "/ev/x", planPath: "/p.json", planSha256: hashB };
  await assert.rejects(cli.runExecute(depsB, argsWrongCommit), /commit does not match/);
  assert.equal(txnCalls, 0);
});
await acheck("cli.runExecute: happy path -- valid plan hash binds through to the txn and publishes evidence", async () => {
  const plan = planBackfill([rec("a", { createdAt: T2019 })], zeroCounters);
  const planEvidence = buildPlanEvidence(plan, { projectId: "taylor-parts", governedCommit: "c".repeat(40), now: NOW });
  const rawPlan = serializeEvidence(planEvidence);
  const realHash = createHash("sha256").update(rawPlan, "utf8").digest("hex");
  let boundPlan = null;
  const deps = {
    fs: fakeFs(), now: NOW,
    readPlanRaw: async () => rawPlan,
    runExecuteTxn: async ({ plan: p }) => { boundPlan = p; return { assigned: p.assignments.map((a) => ({ salesOrderId: a.salesOrderId, salesOrderNumber: a.salesOrderNumber })), counts: { assigned: p.assignments.length, skippedAlreadyNumbered: 0 } }; },
  };
  const args = { projectId: "taylor-parts", governedCommit: "c".repeat(40), evidenceDir: "/ev/exec", planPath: "/p.json", planSha256: realHash };
  const { result, evidenceDir } = await cli.runExecute(deps, args);
  assert.equal(evidenceDir, "/ev/exec");
  assert.equal(result.counts.assigned, 1);
  assert.equal(boundPlan.assignments[0].salesOrderId, "a");
  assert.ok([...deps.fs.files.keys()].some((k) => k.endsWith("execution-result.json")));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
