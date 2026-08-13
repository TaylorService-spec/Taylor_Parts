import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintFinding, reconcileFindings, FINDING_STATUS, isResolved } from "./findingsRegister.mjs";

test("fingerprint is stable across line-number drift and wording changes (keyed on location)", () => {
  const a = fingerprintFinding({ file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", category: "double-booking" });
  const b = fingerprintFinding({ file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", category: "technician availability not checked" });
  assert.equal(a, b, "same file+symbol → same fingerprint regardless of category wording");
  const c = fingerprintFinding({ file: "functions/src/inventoryService.ts", symbol: "triggerInventoryEffects" });
  assert.notEqual(a, c, "different location → different fingerprint");
});

test("NEW surfaces; KNOWN_ACCEPTED/DEFERRED route to governance review (not suppressed); FALSE_POSITIVE is dropped", () => {
  const register = [
    { file: "functions/src/inventoryService.ts", symbol: "triggerInventoryEffects", status: FINDING_STATUS.KNOWN_ACCEPTED },
    { file: "field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", symbol: "receiveReorderRequest", status: FINDING_STATUS.DEFERRED, deferralRef: "#15" },
    { file: "functions/src/old.ts", symbol: "notActuallyABug", status: FINDING_STATUS.FALSE_POSITIVE },
  ];
  const out = reconcileFindings([
    { file: "functions/src/inventoryService.ts", symbol: "triggerInventoryEffects", category: "atomicity" },   // accepted → review
    { file: "field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", symbol: "receiveReorderRequest" }, // deferred → review
    { file: "functions/src/old.ts", symbol: "notActuallyABug" },                                                // false-positive → suppressed
    { file: "functions/src/newThing.ts", symbol: "brandNewBug", category: "npe" },                              // genuinely new
  ], register);
  assert.deepEqual(out.surfaced.map((f) => f.symbol), ["brandNewBug"], "only the truly-new finding surfaces as new work");
  assert.deepEqual(out.needsGovernanceReview.map((f) => f.symbol).sort(), ["receiveReorderRequest", "triggerInventoryEffects"], "accepted + deferred go to ChatGPT review, NOT buried");
  const deferredReview = out.needsGovernanceReview.find((r) => r.becauseStatus === FINDING_STATUS.DEFERRED);
  assert.match(deferredReview.reviewReason, /time to do it now/, "deferral carries a re-evaluate-now prompt");
  assert.equal(deferredReview.deferralRef, "#15");
  assert.deepEqual(out.suppressed.map((f) => f.symbol), ["notActuallyABug"], "only a genuine false-positive is dropped");
});

test("'fixed' without a regression test is NOT trusted — routes to review, never suppressed", () => {
  const register = [{ file: "a.ts", symbol: "claimedFixed", status: FINDING_STATUS.FIXED }]; // no regressionTest
  const out = reconcileFindings([{ file: "a.ts", symbol: "claimedFixed", category: "still broken?" }], register);
  assert.equal(out.surfaced.length, 0);
  assert.equal(out.suppressed.length, 0, "an unproven fix must not silently suppress the finding");
  assert.equal(out.regressions.length, 0, "no test, so not a proven regression either");
  assert.equal(out.needsGovernanceReview.length, 1);
  assert.match(out.needsGovernanceReview[0].reviewReason, /no regression test — fix is unproven/);
});

test("a PROVEN-fixed finding (with test) reappearing is a REGRESSION, never re-raised as new", () => {
  const register = [{ file: "functions/src/createWorkOrder.ts", symbol: "createWorkOrder", status: FINDING_STATUS.FIXED, regressionTest: "functions/test/createWorkOrder.idempotency.test.ts::double-submit" }];
  const out = reconcileFindings([{ file: "functions/src/createWorkOrder.ts", symbol: "createWorkOrder", category: "no idempotency" }], register);
  assert.equal(out.surfaced.length, 0, "not surfaced as new");
  assert.equal(out.regressions.length, 1, "flagged as a regression (the guarding test should have caught it)");
  assert.equal(out.regressions[0].regressionTest, "functions/test/createWorkOrder.idempotency.test.ts::double-submit");
});

test("a CONFIRMED_OPEN finding is 'already tracked', not surfaced as new", () => {
  const register = [{ file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", status: FINDING_STATUS.CONFIRMED_OPEN }];
  const out = reconcileFindings([{ file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", category: "double-booking" }], register);
  assert.equal(out.surfaced.length, 0);
  assert.equal(out.alreadyOpen.length, 1);
});

test("integrity: a FIXED register entry WITHOUT a regression test is flagged unverified ('fixed' unproven)", () => {
  const register = [
    { file: "a.ts", symbol: "x", status: FINDING_STATUS.FIXED, regressionTest: "a.test.ts::x" }, // proven
    { file: "b.ts", symbol: "y", status: FINDING_STATUS.FIXED },                                  // claimed only
  ];
  const out = reconcileFindings([], register);
  assert.deepEqual(out.unverifiedFixed.map((u) => u.symbol), ["y"], "fixed-without-test is not proven fixed");
});

test("THE #852 scenario: re-running the audit surfaces only the genuinely-new issue", () => {
  // Register seeded from the verified #852 Highs: H1 known-accepted, H2 confirmed-open, H3 deferred(#15).
  const register = [
    { file: "functions/src/inventoryService.ts", symbol: "triggerInventoryEffects", severity: "HIGH", status: FINDING_STATUS.KNOWN_ACCEPTED },
    { file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", severity: "HIGH", status: FINDING_STATUS.CONFIRMED_OPEN },
    { file: "field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", symbol: "receiveReorderRequest", severity: "HIGH", status: FINDING_STATUS.DEFERRED, deferralRef: "#15" },
  ];
  // Next cold audit re-reports the same three Highs (as it would) PLUS one genuinely new medium.
  const nextAudit = [
    { file: "functions/src/inventoryService.ts", symbol: "triggerInventoryEffects", category: "ledger double-apply", severity: "HIGH" },
    { file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", category: "no availability check", severity: "HIGH" },
    { file: "field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", symbol: "receiveReorderRequest", category: "no ledger write", severity: "HIGH" },
    { file: "functions/src/billing/charge.ts", symbol: "applyCharge", category: "missing retry cap", severity: "MEDIUM" },
  ];
  const out = reconcileFindings(nextAudit, register);
  assert.deepEqual(out.surfaced.map((f) => f.symbol), ["applyCharge"], "only the NEW issue surfaces as new work");
  assert.equal(out.needsGovernanceReview.length, 2, "known-accepted (H1) + deferred #15 (H3) route to ChatGPT re-evaluation, not silence");
  assert.equal(out.alreadyOpen.length, 1, "the confirmed-open double-booking (H2) stays tracked, not re-raised as new");
  assert.equal(out.regressions.length, 0);
  assert.equal(out.suppressed.length, 0);
});

test("isResolved reflects the suppressing statuses", () => {
  assert.equal(isResolved(FINDING_STATUS.FIXED), true);
  assert.equal(isResolved(FINDING_STATUS.KNOWN_ACCEPTED), true);
  assert.equal(isResolved(FINDING_STATUS.DEFERRED), true);
  assert.equal(isResolved(FINDING_STATUS.FALSE_POSITIVE), true);
  assert.equal(isResolved(FINDING_STATUS.CONFIRMED_OPEN), false);
});
