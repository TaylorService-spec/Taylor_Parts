// P1A step 2 -- the parity harness's decision classifier, proved offline against every required
// mismatch class. `classify(legacyAllow, target)` is the ONE function that turns a
// (legacy decision, eos_policy decision) pair into a PASS/FAIL verdict and a reason; every
// Firestore/Postgres-touching path in functions/scripts/inventoryCapabilityParityHarness.js
// produces exactly the `target` shape this test constructs directly, so exercising `classify`
// against every refusal/held-role/stale-assignment combination proves the classification logic
// deterministically without a database or a Firestore emulator.
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

test("allow parity: legacy allows, eos_policy allows -> PASS/NONE", () => {
  const target = { ...baseTarget(), allow: true, heldRoleKeys: ["inventoryReceivingClerk"] };
  assert.deepEqual(classify(true, target), { parity: "PASS", reason: "NONE" });
});

test("deny parity: legacy denies, eos_policy denies -> PASS/NONE", () => {
  assert.deepEqual(classify(false, baseTarget()), { parity: "PASS", reason: "NONE" });
});

test("missing principal mapping", () => {
  const target = { ...baseTarget(), refusal: "UNKNOWN_PRINCIPAL" };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_PRINCIPAL_MAPPING" });
});

test("disabled principal", () => {
  const target = { ...baseTarget(), refusal: "PRINCIPAL_DISABLED" };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "DISABLED_PRINCIPAL" });
});

test("missing active assignment (no tenant membership at all)", () => {
  const target = { ...baseTarget(), refusal: "NO_TENANT_MEMBERSHIP" };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_ACTIVE_ASSIGNMENT" });
});

test("disabled assignment: principal resolves, but its only qualifying assignment was excluded as stale", () => {
  const target = { ...baseTarget(), hadStaleAssignment: true, heldRoleKeys: [] };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "DISABLED_ASSIGNMENT" });
});

test("missing role: principal resolves in-tenant but holds no qualifying Role at all", () => {
  const target = { ...baseTarget(), heldRoleKeys: [] };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_ROLE" });
});

test("missing role_capability grant: principal holds the Role, but that Role has no grant row for this capability", () => {
  const target = { ...baseTarget(), heldRoleKeys: ["inventoryReceivingClerk"] };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_ROLE_CAPABILITY_GRANT" });
});

test("missing capability catalog entry: the capability key itself is unknown to eos_policy", () => {
  const target = { ...baseTarget(), heldRoleKeys: ["inventoryReceivingClerk"], capabilityKnownInCatalog: false };
  assert.deepEqual(classify(true, target), { parity: "FAIL", reason: "MISSING_CAPABILITY_CATALOG_ENTRY" });
});

test("extra Postgres grant: eos_policy allows something legacy would deny", () => {
  const target = { ...baseTarget(), allow: true, heldRoleKeys: ["inventoryReceivingClerk"] };
  assert.deepEqual(classify(false, target), { parity: "FAIL", reason: "EXTRA_POSTGRES_GRANT" });
});

test("spoofed tenant refusal: a stated foreign tenant is refused -- this is the CORRECT security behavior, reported PASS", () => {
  const target = { ...baseTarget(), refusal: "TENANT_NOT_A_MEMBERSHIP" };
  assert.deepEqual(classify(true, target), { parity: "PASS", reason: "SPOOFED_TENANT_REFUSAL" });
  // Even when legacy would also deny, a spoof attempt is reported as the spoof-refusal reason, not
  // silently folded into ordinary NONE parity -- the evidence must show the refusal happened.
  assert.deepEqual(classify(false, target), { parity: "PASS", reason: "SPOOFED_TENANT_REFUSAL" });
});

test("ambiguous tenant and inactive tenant both classify as missing active assignment, same as no membership", () => {
  assert.equal(classify(true, { ...baseTarget(), refusal: "AMBIGUOUS_TENANT" }).reason, "MISSING_ACTIVE_ASSIGNMENT");
  assert.equal(classify(true, { ...baseTarget(), refusal: "TENANT_NOT_ACTIVE" }).reason, "MISSING_ACTIVE_ASSIGNMENT");
});
