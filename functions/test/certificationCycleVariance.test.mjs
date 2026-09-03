// THE BOUNDED CYCLE-COUNT APPLIER — what it may do, and what it must refuse.
//
// Counting is the one inventory act allowed to change the COMPANY TOTAL. A transfer relocates and
// nets to zero; a receipt adds what a supplier delivered; a reconciled count corrects the books to
// the shelf. That makes it the most dangerous of the three to mis-target: a reconciled variance
// rewrites physical truth, so a count against the wrong part silently rewrites the evidence another
// scenario is asserting.
//
// These tests cover the part the applier actually owns — argument binding, refusal, materiality,
// protection, and the phase contract. The cycle-count service has its own suites and is not
// re-tested here.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const REPO = path.resolve(process.cwd(), "..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

// The module resolves an execution target at import time; with no --projectId it refuses before any
// I/O and records that in process.exitCode, which would fail this file. Cleared once, visibly.
process.argv = ["node", "applyCycleVariance.mjs"];
const applier = await import(L("functions/scripts/certificationWorld/applyCycleVariance.mjs"));
const { parseCountRequest, planCount, countIdempotencyKey, protectedParts } = applier;
process.exitCode = 0;
const { MATERIALITY } = await import(L("functions/scripts/certificationWorld/executeCycleCount.mjs"));

const SRC = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/applyCycleVariance.mjs"), "utf8");
const CODE = SRC.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const ctx = (over = {}) => ({
  expectedQuantity: 48, protectedSet: new Set(), existingForPart: 0,
  reorderPoint: 16, companyQuantity: 51, ...over,
});
const req = (over = {}) => ({ partId: "CW-P-0501", locationId: "wh-main", countedQuantity: 43, ...over });

// ============================================================================================
// ARGUMENTS ARE STATED. There is no candidate search anywhere.
// ============================================================================================
test("part, location and counted quantity must all be stated", () => {
  assert.deepEqual(parseCountRequest(["--partId", "CW-P-0501", "--locationId", "wh-main", "--countedQuantity", "43"]),
    { partId: "CW-P-0501", locationId: "wh-main", countedQuantity: 43 });
  assert.throws(() => parseCountRequest(["--locationId", "wh-main", "--countedQuantity", "43"]), /--partId is required/);
  assert.throws(() => parseCountRequest(["--partId", "CW-P-0501", "--countedQuantity", "43"]), /--locationId is required/);
  assert.throws(() => parseCountRequest(["--partId", "CW-P-0501", "--locationId", "wh-main"]), /--countedQuantity is required/);
});

test("an invalid counted quantity refuses, but ZERO is a legitimate count", () => {
  const base = ["--partId", "CW-P-0501", "--locationId", "wh-main", "--countedQuantity"];
  for (const bad of ["-1", "2.5", "abc"]) {
    assert.throws(() => parseCountRequest([...base, bad]), /whole number >= 0/);
  }
  // A shelf can genuinely be empty. Flooring at 1 would make the emptiest real count unreportable.
  assert.equal(parseCountRequest([...base, "0"]).countedQuantity, 0);
});

test("no automatic candidate selection is possible", () => {
  // The whole failure mode this guards: a tool that picks its own part picks which evidence to
  // overwrite. There must be no fallback, no default and no search in the code.
  assert.doesNotMatch(CODE, /partId\s*=\s*["'']CW-P/, "no hardcoded part may be defaulted");
  assert.doesNotMatch(CODE, /\.find\(\s*\(?\w+\)?\s*=>\s*\w+\.onHand/, "no candidate scoring may exist");
  assert.match(CODE, /--partId is required/);
});

// ============================================================================================
// PROTECTION. Derived from live evidence, never a hardcoded id list.
// ============================================================================================
test("a protected part refuses -- and protection is DERIVED, not hardcoded", async () => {
  assert.throws(() => planCount(req(), ctx({ protectedSet: new Set(["CW-P-0501"]) })),
    /protected Certification evidence/);
  // The Golden part and the APPROVED trap are covered without either being named in the source,
  // because both are referenced by live purchase orders.
  assert.doesNotMatch(CODE, /["'']CW-P-0000["'']/, "the Golden part must not be hardcoded");
  assert.doesNotMatch(CODE, /["'']CW-P-0001["'']/, "the trap must not be hardcoded");
  assert.match(CODE, /collection\("purchase_orders"\)/);
  assert.match(CODE, /collection\("receiving_orders"\)/);
});

test("protectedParts folds in purchase orders, receipts and work-order snapshots", async () => {
  const db = {
    collection: (name) => ({
      get: async () => ({
        docs: name === "purchase_orders"
          ? [{ data: () => ({ items: [{ partId: "CW-P-0000" }] }) },
             { data: () => ({ items: [{ partId: "CW-P-0001" }] }) }]
          : name === "receiving_orders"
            ? [{ data: () => ({ lines: [{ partId: "CW-P-0000" }] }) }]
            : name === "fieldops_wos"
              ? [{ data: () => ({ inventorySnapshot: [{ partId: "CW-P-0777" }] }) }]
              : [],
      }),
    }),
  };
  const set = await protectedParts(db);
  for (const id of ["CW-P-0000", "CW-P-0001", "CW-P-0777"]) {
    assert.ok(set.has(id), `${id} must be protected`);
  }
  assert.ok(!set.has("CW-P-0501"), "an unreferenced part stays countable");
});

test("a part that already has a cycle count refuses", () => {
  assert.throws(() => planCount(req(), ctx({ existingForPart: 1 })),
    /already exist for CW-P-0501 -- refusing rather than stacking/);
});

// ============================================================================================
// MATERIALITY. The product's rule, not a number chosen here.
// ============================================================================================
test("a MATERIAL variance passes and reports the company-total move", () => {
  const plan = planCount(req(), ctx());
  assert.equal(plan.variance, -5);
  assert.equal(plan.material, true);
  assert.equal(plan.companyBefore, 51);
  assert.equal(plan.companyAfter, 46, "a reconciled count MAY move the company total -- the invariant");
  assert.equal(plan.conditionBefore, "HEALTHY");
  assert.equal(plan.conditionAfter, "HEALTHY", "the correction must not destroy a retained condition");
});

test("an IMMATERIAL variance refuses", () => {
  // MATERIALITY is absoluteUnits 3 / relativeFraction 0.1; -2 of 48 clears neither.
  assert.equal(MATERIALITY.absoluteUnits, 3);
  assert.throws(() => planCount(req({ countedQuantity: 46 }), ctx()), /IMMATERIAL/);
});

test("a ZERO variance refuses, because it would prove nothing", () => {
  // A zero-variance count stages no ledger movement at all -- the same fact that made a governed
  // known-zero unrepresentable in CERT-PURCH-UNKNOWN-07.
  assert.throws(() => planCount(req({ countedQuantity: 48 }), ctx()),
    /zero variance stages\s+no ledger movement/);
});

// ============================================================================================
// GATES.
// ============================================================================================
test("a live write demands BOTH flags; production and unknown targets refuse", async () => {
  assert.match(CODE, /assertBothLiveFlags/);
  assert.match(CODE, /resolveExecutionTarget/);
  const { assertBothLiveFlags, ExecutionTargetRefused } =
    await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
  const target = { projectId: "eos-platform-certification", isLive: true, apply: true };
  assert.throws(() => assertBothLiveFlags({ target, argv: ["node", "x", "--apply"] }),
    (e) => e instanceof ExecutionTargetRefused);
  assert.throws(() => assertBothLiveFlags({ target, argv: ["node", "x", "--apply-live-certification"] }),
    (e) => e instanceof ExecutionTargetRefused);
  assert.doesNotThrow(() => assertBothLiveFlags({
    target, argv: ["node", "x", "--apply", "--apply-live-certification"] }));
});

test("dry run is the default and writes nothing", () => {
  assert.match(CODE, /const APPLY = argv\.includes\("--apply"\)/);
  assert.match(SRC, /DRY RUN -- nothing written\./);
  // Every write goes through cycleCountAs, and none may run before the dry-run check. There are
  // now TWO apply branches -- the fresh ceremony and the resume path -- so asserting that one
  // slice holds them all would be wrong; what matters is that nothing writes ahead of the gate.
  const firstApplyBranch = CODE.indexOf("if (!APPLY)");
  assert.ok(firstApplyBranch > 0, "an APPLY branch must exist");
  const beforeAnyBranch = CODE.slice(0, firstApplyBranch);
  assert.equal((beforeAnyBranch.match(/cycleCountAs\(/g) ?? []).length, 0,
    "no cycleCountAs call may run before the dry-run check");
  const writes = (CODE.match(/cycleCountAs\(/g) ?? []).length;
  assert.equal(writes, 6,
    "fresh: create, submit, self-approval, reconcile; resume: self-approval, reconcile");
});

// ============================================================================================
// THE PHASE CONTRACT. Counting observes; reconciliation corrects.
// ============================================================================================
test("SUBMIT is verified not to move stock, before reconciliation is attempted", () => {
  assert.match(CODE, /COUNTING MOVED STOCK/);
  const submitIdx = CODE.indexOf("PHASE 2 COUNTED");
  const guardIdx = CODE.indexOf("COUNTING MOVED STOCK");
  const reconcileIdx = CODE.indexOf('"reconcile"');
  assert.ok(submitIdx < guardIdx && guardIdx < CODE.lastIndexOf('"reconcile"'),
    "the no-movement check must sit between submit and the reconcile that follows it");
  assert.ok(reconcileIdx > 0);
});

test("self-approval is attempted and its SUCCESS is treated as failure", () => {
  assert.match(CODE, /SELF-APPROVAL SUCCEEDED -- separation of duties has failed/);
  assert.match(CODE, /if \(selfApprove\.ok\)/,
    "a successful self-approval must stop the ceremony, not be reported as a pass");
});

test("SoD is resolved live and a failure refuses the whole ceremony", () => {
  assert.match(CODE, /separation of duties does not hold -- refusing to run the ceremony/);
  assert.match(CODE, /counterReconcile.*DENY|sod\.counterReconcile === "DENY"/);
  assert.match(CODE, /counterUid !== reconcilerUid/, "the two actors must be different principals");
});

// ============================================================================================
// CLOCK AND REPLAY.
// ============================================================================================
test("the emulator keeps its deterministic clock; the live applier injects the real one", async () => {
  const exec = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/executeCycleCount.mjs"), "utf8");
  assert.match(exec, /const FIXED_NOW = new Date\("2026-08-22T17:00:00\.000Z"\)/,
    "the pinned instant must survive -- G07 reproducibility depends on it");
  assert.match(exec, /\{ now = \(\) => FIXED_NOW \} = \{\}/, "default stays FIXED_NOW");
  assert.match(CODE, /const now = \(\) => new Date\(\)/, "the live ceremony stamps the real instant");
});

test("the idempotency key is deterministic and quantity-bearing", () => {
  const k = (countedQuantity) => countIdempotencyKey({ partId: "CW-P-0501", locationId: "wh-main", countedQuantity });
  assert.equal(k(43), "cw_cycle_CW-P-0501_wh-main_43");
  assert.equal(k(43), k(43));
  assert.notEqual(k(43), k(44), "two different observations are different events");
});

test("a state shift between plan and CREATE stops the ceremony", () => {
  // The expected quantity is measured twice -- once by the plan, once by the service's own
  // snapshot. A disagreement means the world moved under the ceremony, and continuing would submit
  // a variance computed against a number that is no longer true.
  assert.match(CODE, /state moved under the ceremony, STOPPING before submit/);
});

// ============================================================================================
// CERT-CYCLE-12 — THE GUARD THAT COULD NEVER PASS.
//
// The first live ceremony reached COUNTED and stopped on "COUNTING MOVED STOCK". Nothing had moved:
// warehouse still 48, inventory_transactions still 88, and the three ADJUSTED rows it counted were
// the part's OWN OPENING BALANCES -- cw_open_CW-P-0501_{wh-main,cert-trk-01,cert-trk-04}, recorded
// at the fixture epoch 2025-12-06 by the seeder, none referencing the count.
//
// The guard asserted `adjustmentRows === 0` ABSOLUTELY. Opening balances are themselves ADJUSTED
// movements, so every stocked part in this world begins with adjustment evidence and the assertion
// could never have passed for ANY part. It was not a subtle bug; it was unconditionally broken, and
// the dry run never exercises it because it lives inside the APPLY branch.
//
// The invariant was right. The measurement was wrong. What must be proven is that SUBMIT added no
// NEW adjustment -- a set difference by document id, not a count.
// ============================================================================================
const { newAdjustmentIds, planResume } = applier;

test("CERT-CYCLE-12: historical adjustment rows are NOT new -- the ceremony proceeds", () => {
  // The exact live shape: three pre-existing opening-balance rows, unchanged by submit.
  const before = new Set(["imv_5120ff82", "imv_9738b246", "imv_c0590d31"]);
  const after = new Set(["imv_5120ff82", "imv_9738b246", "imv_c0590d31"]);
  assert.deepEqual(newAdjustmentIds(before, after), [],
    "three rows before, the same three after -- counting observed and moved nothing");
  // The old guard's question, for contrast: a count of 3 is not zero, and it stopped the ceremony.
  assert.equal(after.size, 3, "an absolute zero assertion fails here, which is the defect");
});

test("CERT-CYCLE-12: a genuinely NEW adjustment during submit is caught", () => {
  const before = new Set(["imv_5120ff82", "imv_9738b246", "imv_c0590d31"]);
  const after = new Set([...before, "imv_NEWROW"]);
  assert.deepEqual(newAdjustmentIds(before, after), ["imv_NEWROW"],
    "counting must never stage an adjustment; this is the case the guard exists for");
});

test("CERT-CYCLE-12: an added row is caught even when the TOTAL is unchanged", () => {
  // Why ids, not counts. One row added and one gone nets to the same total; a count comparison
  // reports no change while the ledger has genuinely moved.
  const before = new Set(["a", "b", "c"]);
  const after = new Set(["a", "b", "NEW"]);
  assert.equal(after.size, before.size, "totals agree");
  assert.deepEqual(newAdjustmentIds(before, after), ["NEW"], "and the set difference still catches it");
});

// ============================================================================================
// THE RESUME PATH. Finish the existing count; never open a second one.
// ============================================================================================
const stored = (over = {}) => ({
  partId: "CW-P-0501", location: { type: "WAREHOUSE", locationId: "wh-main" },
  expectedQuantity: 48, countedQuantity: 43, variance: -5, status: "COUNTED",
  submittedBy: "Wx3MuDOIO5VFRNJCJ9SQv01vntI2", ...over,
});
const asked = { cycleCountId: "cyc_live", partId: "CW-P-0501", locationId: "wh-main",
  expectedQuantity: 48, countedQuantity: 43 };
const okCtx = (over = {}) => ({ stored: stored(), warehouseNow: 48, newAdjustments: [], ...over });

test("RESUME: a COUNTED record with no movement is resumable", () => {
  const plan = planResume(asked, okCtx());
  assert.equal(plan.resumable, true);
  assert.equal(plan.variance, -5);
});

test("RESUME: only a COUNTED record may be resumed", () => {
  for (const status of ["OPEN", "RECONCILED", "REJECTED", "CANCELLED"]) {
    assert.throws(() => planResume(asked, okCtx({ stored: stored({ status }) })),
      new RegExp(`is ${status}, not COUNTED`));
  }
});

test("RESUME: the stored record must match what was stated, field by field", () => {
  assert.throws(() => planResume(asked, okCtx({ stored: stored({ partId: "CW-P-0999" }) })), /part CW-P-0999/);
  assert.throws(() => planResume(asked, okCtx({ stored: stored({ expectedQuantity: 47 }) })), /expected 47/);
  assert.throws(() => planResume(asked, okCtx({ stored: stored({ countedQuantity: 40 }) })), /counted 40/);
  assert.throws(() => planResume(asked, okCtx({
    stored: stored({ location: { type: "WAREHOUSE", locationId: "wh-other" } }) })), /location wh-other/);
});

test("RESUME: stock moving after the count refuses -- a correction must not apply twice", () => {
  assert.throws(() => planResume(asked, okCtx({ warehouseNow: 43 })),
    /warehouse is 43 but the count expected 48/);
  assert.throws(() => planResume(asked, okCtx({ newAdjustments: ["imv_x"] })),
    /SUBMIT created adjustment rows/);
});

test("RESUME: a stored variance disagreeing with counted-expected refuses", () => {
  assert.throws(() => planResume(asked, okCtx({ stored: stored({ variance: -4 }) })),
    /stored variance -4 disagrees with counted-expected -5/);
});

test("RESUME creates nothing: no create, no resubmit, no new idempotency event", () => {
  const resumeBlock = CODE.slice(CODE.indexOf("RESUME_ID"), CODE.indexOf("} else if (target)"));
  assert.doesNotMatch(resumeBlock, /"create"/, "resume must never open a second count");
  assert.doesNotMatch(resumeBlock, /"submit"/, "resume must never resubmit the observation");
  assert.doesNotMatch(resumeBlock, /countIdempotencyKey/, "resume mints no new idempotency event");
  assert.match(resumeBlock, /"reconcile"/, "it performs only the self-approval probe and the approval");
  assert.match(resumeBlock, /--resumeCycleCountId/, "the exact id must be stated");
});

test("RESUME: the submitter must be the counter, and SoD is re-resolved live", () => {
  const resumeBlock = CODE.slice(CODE.indexOf("RESUME_ID"), CODE.indexOf("} else if (target)"));
  assert.match(resumeBlock, /stored\.submittedBy !== idx\.get\(COUNTER\)/,
    "reconciling a count submitted by someone else would settle an unverified observation");
  assert.match(resumeBlock, /separation of duties does not hold -- refusing to resume/);
  assert.match(resumeBlock, /SELF-APPROVAL SUCCEEDED/);
});
