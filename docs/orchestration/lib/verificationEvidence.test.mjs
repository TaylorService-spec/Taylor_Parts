import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECK, VERDICT, buildScenario, observation, evaluate, supportsTruthMatrixClaim,
} from "./verificationEvidence.mjs";

const scenario = () =>
  buildScenario({
    itemId: "sales-order-actions",
    capability: "salesOrder.transition",
    positivePersona: "admin",
    negativePersona: "technician",
  });

const ENV = { environmentId: "platform-sandbox", commit: "b09f3a13" };
const pass = (check, evidence = "evidence/shot.png") => observation({ check, passed: true, evidence });

test("a scenario without a negative persona is refused at construction", () => {
  // The whole point: a positive-only scenario can never verify, so it must not be
  // constructible and then quietly fail forever.
  assert.throws(
    () => buildScenario({ itemId: "x", capability: "c", positivePersona: "admin" }),
    /negativePersona is required/,
  );
});

test("a scenario cannot use the same persona for both paths", () => {
  assert.throws(
    () => buildScenario({ itemId: "x", capability: "c", positivePersona: "admin", negativePersona: "admin" }),
    /must differ/,
  );
});

test("missing itemId or capability is refused", () => {
  assert.throws(() => buildScenario({ capability: "c", positivePersona: "a", negativePersona: "b" }), /itemId/);
  assert.throws(() => buildScenario({ itemId: "i", positivePersona: "a", negativePersona: "b" }), /capability/);
});

test("DEFECT GUARD: a positive path alone is NOT VERIFIED", () => {
  // "It worked when I was admin" is the exact claim this contract exists to reject.
  const r = evaluate(scenario(), [pass(CHECK.POSITIVE)], ENV);
  assert.equal(r.verdict, VERDICT.NOT_VERIFIED);
  assert.ok(r.reasons.some((x) => /negative path not exercised/.test(x)));
  assert.equal(supportsTruthMatrixClaim(r), false);
});

test("positive + negative, both evidenced, is VERIFIED", () => {
  const r = evaluate(scenario(), [pass(CHECK.POSITIVE), pass(CHECK.NEGATIVE)], ENV);
  assert.equal(r.verdict, VERDICT.VERIFIED);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.commit, "b09f3a13");
  assert.equal(supportsTruthMatrixClaim(r), true);
});

test("a check with no evidence cannot count as proven", () => {
  const r = evaluate(
    scenario(),
    [pass(CHECK.POSITIVE), observation({ check: CHECK.NEGATIVE, passed: true, evidence: "   " })],
    ENV,
  );
  assert.equal(r.verdict, VERDICT.NOT_VERIFIED);
  assert.ok(r.reasons.some((x) => /carries no evidence/.test(x)));
});

test("a failed check is FAILED, and outranks incompleteness", () => {
  const r = evaluate(
    scenario(),
    [observation({ check: CHECK.POSITIVE, passed: false, evidence: "shot.png", detail: "button did nothing" })],
    ENV,
  );
  assert.equal(r.verdict, VERDICT.FAILED);
  assert.deepEqual(r.failedChecks, [CHECK.POSITIVE]);
  assert.ok(r.reasons[0].includes("button did nothing"));
  assert.equal(supportsTruthMatrixClaim(r), false);
});

test("evidence with no environment or commit recorded cannot verify", () => {
  const r = evaluate(scenario(), [pass(CHECK.POSITIVE), pass(CHECK.NEGATIVE)], {});
  assert.equal(r.verdict, VERDICT.NOT_VERIFIED);
  assert.ok(r.reasons.some((x) => /environmentId not recorded/.test(x)));
  assert.ok(r.reasons.some((x) => /commit not recorded/.test(x)));
});

test("DEFECT GUARD: evidence expires when the environment moves", () => {
  // 2026-08-16: the sandbox served a commit 17 behind main while reporting a fresh
  // build time. Evidence gathered against one commit must not carry forward silently.
  const r = evaluate(scenario(), [pass(CHECK.POSITIVE), pass(CHECK.NEGATIVE)], ENV, "225bc7ab");
  assert.equal(r.verdict, VERDICT.STALE);
  assert.equal(r.servingCommit, "225bc7ab");
  assert.ok(r.reasons[0].includes("re-verify"));
  assert.equal(supportsTruthMatrixClaim(r), false);
});

test("the same serving commit does not make evidence stale", () => {
  const r = evaluate(scenario(), [pass(CHECK.POSITIVE), pass(CHECK.NEGATIVE)], ENV, "b09f3a13");
  assert.equal(r.verdict, VERDICT.VERIFIED);
});

test("a re-run supersedes an earlier observation of the same kind", () => {
  const r = evaluate(
    scenario(),
    [
      observation({ check: CHECK.POSITIVE, passed: false, evidence: "first.png", detail: "flake" }),
      pass(CHECK.POSITIVE, "second.png"),
      pass(CHECK.NEGATIVE),
    ],
    ENV,
  );
  assert.equal(r.verdict, VERDICT.VERIFIED);
});

test("HONEST_ERROR is recorded but is not required to verify", () => {
  const r = evaluate(
    scenario(),
    [pass(CHECK.POSITIVE), pass(CHECK.NEGATIVE), pass(CHECK.HONEST_ERROR)],
    ENV,
  );
  assert.equal(r.verdict, VERDICT.VERIFIED);
  assert.equal(r.checks.length, 3);
});

test("a failing HONEST_ERROR check does fail the run", () => {
  const r = evaluate(
    scenario(),
    [
      pass(CHECK.POSITIVE),
      pass(CHECK.NEGATIVE),
      observation({ check: CHECK.HONEST_ERROR, passed: false, evidence: "e.png", detail: "false empty state" }),
    ],
    ENV,
  );
  assert.equal(r.verdict, VERDICT.FAILED);
});

test("observation validates its inputs", () => {
  assert.throws(() => observation({ check: "NOPE", passed: true }), /unknown check kind/);
  assert.throws(() => observation({ check: CHECK.POSITIVE, passed: "yes" }), /must be a boolean/);
});

test("evaluate with no observations at all is NOT_VERIFIED, never VERIFIED by omission", () => {
  const r = evaluate(scenario(), [], ENV);
  assert.equal(r.verdict, VERDICT.NOT_VERIFIED);
  assert.equal(r.reasons.length, 2);
  assert.equal(supportsTruthMatrixClaim(r), false);
});
