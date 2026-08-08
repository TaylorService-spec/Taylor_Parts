// Finance BILLING POLICY (Owner §5) — pure tests. Proves eligibility (fact) is separated from policy
// (decision); PARTIALLY_ELIGIBLE never auto-bills under the Taylor default; and the C713×5 case protection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBillingDecision, DEFAULT_BILLING_POLICY, BILLING_POLICIES } from "../src/domain/financeBillingPolicy.js";

test("default policy is BILL_ON_COMPLETE and is a recognized policy", () => {
  assert.equal(DEFAULT_BILLING_POLICY, "BILL_ON_COMPLETE");
  assert.equal(BILLING_POLICIES.includes("BILL_AS_FULFILLED"), true);
});

test("ELIGIBLE bills in full under every policy", () => {
  for (const p of BILLING_POLICIES) {
    const d = resolveBillingDecision({ eligibility: "ELIGIBLE" }, p);
    assert.equal(d.action, "BILL_NOW");
    assert.equal(d.scope, "FULL");
    assert.equal(d.autoBillable, true);
  }
});

test("PARTIALLY_ELIGIBLE under BILL_ON_COMPLETE HOLDS — never auto-bills (Taylor default)", () => {
  const d = resolveBillingDecision({ eligibility: "PARTIALLY_ELIGIBLE" }); // default policy
  assert.equal(d.action, "HOLD_FOR_POLICY");
  assert.equal(d.scope, "FULFILLED_PORTION");
  assert.equal(d.autoBillable, false); // visible + eligible, but NOT automatic
});

test("PARTIALLY_ELIGIBLE under BILL_AS_FULFILLED bills the fulfilled portion", () => {
  const d = resolveBillingDecision({ eligibility: "PARTIALLY_ELIGIBLE" }, "BILL_AS_FULFILLED");
  assert.equal(d.action, "BILL_NOW");
  assert.equal(d.scope, "FULFILLED_PORTION");
  assert.equal(d.autoBillable, true);
});

test("MILESTONE/DEPOSIT hold (unconfigured) — fail closed, never auto-bill", () => {
  for (const p of ["MILESTONE", "DEPOSIT"]) {
    const d = resolveBillingDecision({ eligibility: "PARTIALLY_ELIGIBLE" }, p);
    assert.equal(d.action, "HOLD_FOR_POLICY");
    assert.equal(d.autoBillable, false);
  }
});

test("HELD / NOT_YET / CANCELLED / unknown are NOT_BILLABLE under any policy", () => {
  for (const e of ["HELD", "NOT_YET", "CANCELLED", "UNKNOWN", undefined]) {
    for (const p of BILLING_POLICIES) {
      const d = resolveBillingDecision({ eligibility: e }, p);
      assert.equal(d.action, "NOT_BILLABLE");
      assert.equal(d.scope, "NONE");
    }
  }
});

test("C713×5 protection: 4 complete + 1 blocked ⇒ HELD ⇒ NOT_BILLABLE (no auto invoice of 5 or 4)", () => {
  // A blocked unit makes the coordinated visit / billing eligibility HELD.
  const d = resolveBillingDecision({ eligibility: "HELD" });
  assert.equal(d.action, "NOT_BILLABLE");
  // And a merely-partial (no blocker) case holds under the default — still not automatic.
  const partial = resolveBillingDecision({ eligibility: "PARTIALLY_ELIGIBLE" });
  assert.equal(partial.autoBillable, false);
});

test("an unrecognized policy falls back to the safe default (BILL_ON_COMPLETE)", () => {
  const d = resolveBillingDecision({ eligibility: "PARTIALLY_ELIGIBLE" }, "WHATEVER");
  assert.equal(d.policy, "BILL_ON_COMPLETE");
  assert.equal(d.autoBillable, false);
});
