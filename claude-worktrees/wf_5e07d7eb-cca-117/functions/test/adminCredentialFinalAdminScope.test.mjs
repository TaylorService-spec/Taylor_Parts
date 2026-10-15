// AUTH-PR-3.5 -- PURE unit test (no Firestore, no emulator) for the
// final-active-admin protection's scope filter (adminCredentialCallables.ts).
//
// Regression coverage: resolveTargetFacts's isFinalActiveAdmin query counted
// ANY roleAssignment with roleId=="admin" && status=="active" as "another
// active admin exists", with no Scope filter. grantRole allows an "admin"
// roleAssignment to be created at any Scope type (only the ACTOR granting it
// must hold global-scoped admin.roleAssignment.write; the new assignment's
// own scope is caller-supplied and unrestricted). A domain/location/tenant-
// scoped "admin" assignment never actually satisfies resolveEffectivePermission's
// scopeMatches for a global target, so it confers no real admin authority --
// yet before the fix it still counted, letting a non-functional narrowly-
// scoped "admin" assignment mask the true last effective admin and defeat the
// guard whose entire purpose is to prevent resetting the last admin's
// password.
//
// Prerequisite: npm run build (compiles to functions/lib). Then:
//   node functions/test/adminCredentialFinalAdminScope.test.mjs
import assert from "node:assert/strict";
import { isOtherEffectiveActiveAdmin } from "../lib/access/adminCredentialCallables.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const TARGET = "real-global-admin";

ok("global-scoped admin roleAssignment for ANOTHER principal counts", () => {
  const other = { principalUid: "other-uid", scope: { type: "global" } };
  assert.strictEqual(isOtherEffectiveActiveAdmin(other, TARGET), true);
});

ok("domain-scoped admin roleAssignment for another principal does NOT count (non-functional)", () => {
  const other = { principalUid: "other-uid", scope: { type: "domain", value: "sales" } };
  assert.strictEqual(isOtherEffectiveActiveAdmin(other, TARGET), false);
});

ok("location-scoped admin roleAssignment for another principal does NOT count", () => {
  const other = { principalUid: "other-uid", scope: { type: "location", value: "wh-1" } };
  assert.strictEqual(isOtherEffectiveActiveAdmin(other, TARGET), false);
});

ok("tenant-scoped admin roleAssignment for another principal does NOT count", () => {
  const other = { principalUid: "other-uid", scope: { type: "tenant", value: "t-1" } };
  assert.strictEqual(isOtherEffectiveActiveAdmin(other, TARGET), false);
});

ok("global-scoped assignment for the TARGET itself does not count as an OTHER admin", () => {
  const self = { principalUid: TARGET, scope: { type: "global" } };
  assert.strictEqual(isOtherEffectiveActiveAdmin(self, TARGET), false);
});

ok("missing scope field does NOT count (fail-safe: unknown scope is not global)", () => {
  const other = { principalUid: "other-uid" };
  assert.strictEqual(isOtherEffectiveActiveAdmin(other, TARGET), false);
});

// End-to-end regression: the exact scenario in the finding. A real global
// admin is the sole functional admin; a second, domain-scoped "admin"
// roleAssignment exists for a different principal (non-functional -- confers
// no real authority). The real admin must still resolve as final/protected.
ok("regression: real sole global admin stays final-protected despite a non-functional scoped admin doc", () => {
  const docs = [
    { principalUid: TARGET, scope: { type: "global" } }, // the target's own assignment
    { principalUid: "decoy-uid", scope: { type: "domain", value: "sales" } }, // non-functional
  ];
  const others = docs.filter((d) => isOtherEffectiveActiveAdmin(d, TARGET));
  assert.strictEqual(others.length, 0, "a non-functional scoped admin doc must not mask the last real admin");
});

console.log(`\n${passed} passed`);
