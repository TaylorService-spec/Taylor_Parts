import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintFinding, reconcileFindings, FINDING_STATUS, isResolved } from "./findingsRegister.mjs";

// Findings/entries now carry a stable `discriminator` (the issue identity). A short helper to build them.
const F = (file, symbol, discriminator, extra = {}) => ({ file, symbol, discriminator, ...extra });

test("fingerprint is stable across line/wording drift but DISTINCT per issue in the same symbol", () => {
  const a = fingerprintFinding({ file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", discriminator: "no-availability-check", category: "double-booking", line: 64 });
  const b = fingerprintFinding({ file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", discriminator: "no-availability-check", category: "technician availability not checked", line: 118 });
  assert.equal(a, b, "same location + discriminator → same fingerprint regardless of prose/line drift");
  // TWO DIFFERENT ISSUES in the SAME symbol must NOT collapse:
  const other = fingerprintFinding({ file: "functions/src/transitionWorkOrder.ts", symbol: "transitionWorkOrder", discriminator: "missing-idempotency-key" });
  assert.notEqual(a, other, "a different discriminator in the same symbol → a different fingerprint");
});

test("fingerprint FAILS CLOSED (null) when the issue discriminator is missing", () => {
  assert.equal(fingerprintFinding({ file: "a.ts", symbol: "x" }), null, "no discriminator → null, never a collapsed id");
  assert.equal(fingerprintFinding({ file: "a.ts", discriminator: "y" }) !== null, true, "file + discriminator is enough (symbol optional)");
  assert.equal(fingerprintFinding({ discriminator: "y" }), null, "no file → null");
});

test("ANTI-COLLISION: a NEW issue in a symbol that already has a resolved entry still SURFACES (never suppressed)", () => {
  // The exact hole the verifier flagged: transitionWorkOrder already has a KNOWN_ACCEPTED finding; a DIFFERENT
  // real bug in the same function must not be silently dropped.
  const register = [F("functions/src/transitionWorkOrder.ts", "transitionWorkOrder", "no-availability-check", { status: FINDING_STATUS.KNOWN_ACCEPTED })];
  const out = reconcileFindings([
    F("functions/src/transitionWorkOrder.ts", "transitionWorkOrder", "no-availability-check", { category: "double-booking" }), // the accepted one
    F("functions/src/transitionWorkOrder.ts", "transitionWorkOrder", "sql-injection-in-status-write", { category: "security" }), // a DIFFERENT real bug
  ], register);
  assert.deepEqual(out.surfaced.map((f) => f.discriminator), ["sql-injection-in-status-write"], "the new distinct issue surfaces");
  assert.equal(out.suppressed.length, 1, "only the actually-known issue is suppressed");
  assert.equal(out.suppressed[0].discriminator, "no-availability-check");
});

test("FAIL CLOSED: a finding with no discriminator surfaces for disposition, never matched/suppressed", () => {
  const register = [F("a.ts", "x", "known-issue", { status: FINDING_STATUS.DEFERRED })];
  const out = reconcileFindings([{ file: "a.ts", symbol: "x", category: "something" }], register); // no discriminator
  assert.equal(out.surfaced.length, 1);
  assert.equal(out.surfaced[0].disposition, "NEEDS_DISCRIMINATOR");
  assert.equal(out.suppressed.length, 0, "an un-fingerprintable finding is NEVER suppressed by a same-symbol entry");
});

test("NEW surfaces; already-dispositioned (ACCEPTED/DEFERRED/FALSE_POSITIVE) are memory → suppressed", () => {
  const register = [
    F("functions/src/inventoryService.ts", "triggerInventoryEffects", "ledger-not-atomic", { status: FINDING_STATUS.KNOWN_ACCEPTED }),
    F("field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", "receiveReorderRequest", "no-ledger-write", { status: FINDING_STATUS.DEFERRED, deferralRef: "#15", revalidateWhen: "Blaze active" }),
    F("functions/src/old.ts", "notActuallyABug", "flagged-documented-behavior", { status: FINDING_STATUS.FALSE_POSITIVE }),
  ];
  const out = reconcileFindings([
    F("functions/src/inventoryService.ts", "triggerInventoryEffects", "ledger-not-atomic"),
    F("field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", "receiveReorderRequest", "no-ledger-write"),
    F("functions/src/old.ts", "notActuallyABug", "flagged-documented-behavior"),
    F("functions/src/newThing.ts", "brandNewBug", "npe-on-null-input"),
  ], register);
  assert.deepEqual(out.surfaced.map((f) => f.symbol), ["brandNewBug"], "only the truly-new finding needs disposition");
  assert.deepEqual(out.suppressed.map((f) => f.symbol).sort(), ["notActuallyABug", "receiveReorderRequest", "triggerInventoryEffects"]);
  const deferred = out.suppressed.find((s) => s.becauseStatus === FINDING_STATUS.DEFERRED);
  assert.equal(deferred.revalidateWhen, "Blaze active", "the deferral's re-disposition CONDITION is carried");
});

test("a PROVEN-fixed finding (with test) reappearing is a REGRESSION, never re-raised as new", () => {
  const register = [F("functions/src/createWorkOrder.ts", "createWorkOrder", "no-idempotency-key", { status: FINDING_STATUS.FIXED, regressionTest: "functions/test/createWorkOrder.idempotency.test.ts::double-submit" })];
  const out = reconcileFindings([F("functions/src/createWorkOrder.ts", "createWorkOrder", "no-idempotency-key")], register);
  assert.equal(out.surfaced.length, 0);
  assert.equal(out.regressions.length, 1);
  assert.equal(out.regressions[0].regressionTest, "functions/test/createWorkOrder.idempotency.test.ts::double-submit");
});

test("'fixed' without a regression test reappearing is escalated as unprovenFixed — never suppressed", () => {
  const register = [F("a.ts", "claimedFixed", "the-bug", { status: FINDING_STATUS.FIXED })]; // no regressionTest
  const out = reconcileFindings([F("a.ts", "claimedFixed", "the-bug")], register);
  assert.equal(out.suppressed.length, 0, "an unproven fix must not silently suppress");
  assert.equal(out.regressions.length, 0);
  assert.equal(out.unprovenFixed.length, 1);
  assert.match(out.unprovenFixed[0].reason, /never proven/);
});

test("a CONFIRMED_OPEN finding is 'already tracked', not surfaced as new", () => {
  const register = [F("functions/src/transitionWorkOrder.ts", "transitionWorkOrder", "no-availability-check", { status: FINDING_STATUS.CONFIRMED_OPEN })];
  const out = reconcileFindings([F("functions/src/transitionWorkOrder.ts", "transitionWorkOrder", "no-availability-check")], register);
  assert.equal(out.surfaced.length, 0);
  assert.equal(out.alreadyOpen.length, 1);
});

test("integrity: a FIXED register entry WITHOUT a regression test is flagged unverified", () => {
  const register = [
    F("a.ts", "x", "bug-1", { status: FINDING_STATUS.FIXED, regressionTest: "a.test.ts::x" }),
    F("b.ts", "y", "bug-2", { status: FINDING_STATUS.FIXED }),
  ];
  const out = reconcileFindings([], register);
  assert.deepEqual(out.unverifiedFixed.map((u) => u.symbol), ["y"]);
});

test("THE #852 scenario: re-running the audit surfaces only the genuinely-new issue", () => {
  const register = [
    F("functions/src/inventoryService.ts", "triggerInventoryEffects", "ledger-not-atomic", { severity: "HIGH", status: FINDING_STATUS.KNOWN_ACCEPTED }),
    F("functions/src/transitionWorkOrder.ts", "transitionWorkOrder", "no-availability-check", { severity: "HIGH", status: FINDING_STATUS.CONFIRMED_OPEN }),
    F("field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", "receiveReorderRequest", "no-ledger-write", { severity: "HIGH", status: FINDING_STATUS.DEFERRED, deferralRef: "#15" }),
  ];
  const nextAudit = [
    F("functions/src/inventoryService.ts", "triggerInventoryEffects", "ledger-not-atomic", { severity: "HIGH" }),
    F("functions/src/transitionWorkOrder.ts", "transitionWorkOrder", "no-availability-check", { severity: "HIGH" }),
    F("field-ops-app-vite/src/modules/inventoryRole/PartsAssociateHome.jsx", "receiveReorderRequest", "no-ledger-write", { severity: "HIGH" }),
    F("functions/src/billing/charge.ts", "applyCharge", "missing-retry-cap", { severity: "MEDIUM" }),
  ];
  const out = reconcileFindings(nextAudit, register);
  assert.deepEqual(out.surfaced.map((f) => f.symbol), ["applyCharge"], "only the NEW issue needs disposition");
  assert.equal(out.suppressed.length, 2, "H1 accepted + H3 deferred → memory, suppressed");
  assert.equal(out.alreadyOpen.length, 1, "H2 confirmed-open stays tracked");
  assert.equal(out.regressions.length + out.unprovenFixed.length, 0);
});

test("isResolved reflects the suppressing statuses", () => {
  assert.equal(isResolved(FINDING_STATUS.FIXED), true);
  assert.equal(isResolved(FINDING_STATUS.KNOWN_ACCEPTED), true);
  assert.equal(isResolved(FINDING_STATUS.DEFERRED), true);
  assert.equal(isResolved(FINDING_STATUS.FALSE_POSITIVE), true);
  assert.equal(isResolved(FINDING_STATUS.CONFIRMED_OPEN), false);
});
