// P1A step 2 -- the parity harness's decision classifier, proved offline against every required
// mismatch class. `classify(legacyAllow, target)` is the ONE function that turns a
// (legacy decision, eos_policy decision) pair into a PASS/FAIL verdict and a reason; every
// Firestore/Postgres-touching path in functions/scripts/inventoryCapabilityParityHarness.js
// produces exactly the `target` shape this test constructs directly, so exercising `classify`
// against every refusal/held-role/stale-assignment combination proves the classification logic
// deterministically without a database or a Firestore emulator.
//
// THREE VERDICTS, not two (Owner ruling G0-2, vacuity fix at baseline
// 64008d5ae0bdd9532909671b15a91122400accf1): PASS, FAIL and OBSERVATION, plus a second
// `demonstrates` axis naming which readiness evidence the row actually supplies. Deny on BOTH sides
// is an OBSERVATION and demonstrates NOTHING -- it used to be scored PASS/NONE, which is what let a
// principal holding no capabilities at all report CAPABILITY_PARITY_READY. The deny/deny sub-reasons
// and the readiness predicate itself are proved in
// test/inventoryCapabilityParityHarnessVacuity.test.mjs; this file keeps proving the DISAGREEMENT
// classes, each of which is still a FAIL.
import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/inventoryCapabilityParityHarness.js";

const baseTarget = () => ({
  allow: false,
  refusal: null,
  heldRoleKeys: [],
  hadStaleAssignment: false,
  capabilityKnownInCatalog: true,
});

test("allow parity: legacy allows, eos_policy allows -> PASS/NONE, and it DEMONSTRATES reachability", () => {
  const target = { ...baseTarget(), allow: true, heldRoleKeys: ["inventoryReceivingClerk"] };
  assert.deepEqual(classify(true, target), { parity: "PASS", reason: "NONE", demonstrates: "EXPECTED_ALLOW" });
});

test("deny parity: legacy denies, eos_policy denies -> OBSERVATION, NOT a pass, demonstrating nothing", () => {
  // THE VACUITY FIX. This was `{ parity: "PASS", reason: "NONE" }`, which made "nobody may do this
  // on either side" indistinguishable from "the migration works" -- see the suite named above.
  const verdict = classify(false, baseTarget());
  assert.equal(verdict.parity, "OBSERVATION");
  assert.equal(verdict.demonstrates, "NONE");
  assert.notEqual(verdict.parity, "PASS");
});

test("missing principal mapping", () => {
  const target = { ...baseTarget(), refusal: "UNKNOWN_PRINCIPAL" };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_PRINCIPAL_MAPPING", demonstrates: "NONE" });
});

test("disabled principal", () => {
  const target = { ...baseTarget(), refusal: "PRINCIPAL_DISABLED" };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "DISABLED_PRINCIPAL", demonstrates: "NONE" });
});

test("missing active assignment (no tenant membership at all)", () => {
  const target = { ...baseTarget(), refusal: "NO_TENANT_MEMBERSHIP" };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_ACTIVE_ASSIGNMENT", demonstrates: "NONE" });
});

test("disabled assignment: principal resolves, but its only qualifying assignment was excluded as stale", () => {
  const target = { ...baseTarget(), hadStaleAssignment: true, heldRoleKeys: [] };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "DISABLED_ASSIGNMENT", demonstrates: "NONE" });
});

test("missing role: principal resolves in-tenant but holds no qualifying Role at all", () => {
  const target = { ...baseTarget(), heldRoleKeys: [] };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_ROLE", demonstrates: "NONE" });
});

test("missing role_capability grant: principal holds the Role, but that Role has no grant row for this capability", () => {
  const target = { ...baseTarget(), heldRoleKeys: ["inventoryReceivingClerk"] };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_ROLE_CAPABILITY_GRANT", demonstrates: "NONE" });
});

test("missing capability catalog entry: the capability key itself is unknown to eos_policy", () => {
  const target = { ...baseTarget(), heldRoleKeys: ["inventoryReceivingClerk"], capabilityKnownInCatalog: false };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_CAPABILITY_CATALOG_ENTRY", demonstrates: "NONE" });
});

test("extra Postgres grant: eos_policy allows something legacy would deny", () => {
  const target = { ...baseTarget(), allow: true, heldRoleKeys: ["inventoryReceivingClerk"] };
  assert.deepEqual(classify(false, target), { parity: "FAIL", reason: "EXTRA_POSTGRES_GRANT", demonstrates: "NONE" });
});

test("spoofed tenant refusal: a stated foreign tenant is refused -- this is the CORRECT security behavior, reported PASS", () => {
  const target = { ...baseTarget(), refusal: "TENANT_NOT_A_MEMBERSHIP" };
  // Unlike an ordinary deny/deny this IS a demonstration: the harness chose a tenant the principal
  // is not a member of, so the refusal it EXPECTED is the refusal it got.
  assert.deepEqual(classify(true, target), { parity: "PASS", reason: "SPOOFED_TENANT_REFUSAL", demonstrates: "EXPECTED_DENY" });
  // Even when legacy would also deny, a spoof attempt is reported as the spoof-refusal reason, not
  // silently folded into an ordinary deny/deny observation -- the evidence must show the refusal
  // happened. It still does not count as the demonstrated ALLOW readiness requires.
  assert.deepEqual(classify(false, target), { parity: "PASS", reason: "SPOOFED_TENANT_REFUSAL", demonstrates: "EXPECTED_DENY" });
});

test("ambiguous tenant and inactive tenant both classify as missing active assignment, same as no membership", () => {
  assert.equal(classify(true, { ...baseTarget(), refusal: "AMBIGUOUS_TENANT" }).reason, "MISSING_ACTIVE_ASSIGNMENT");
  assert.equal(classify(true, { ...baseTarget(), refusal: "TENANT_NOT_ACTIVE" }).reason, "MISSING_ACTIVE_ASSIGNMENT");
});
