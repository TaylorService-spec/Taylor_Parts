// Issue #226 Row 11 -- Read-only Admin MVP (Task 16). Deterministic unit tests
// for describePermissionDecision(), Spec sec16's "denial explanation" MVP
// surface. Exercises the function against literal ResolveResult-shaped values
// (the exact contract resolveEffectivePermission() -- src/access/
// resolveEffectivePermission.ts -- returns; that function's own behavior is
// already exhaustively covered by functions/test/resolveEffectivePermission.test.mjs
// against the compiled resolver, so this file does not re-import the .ts
// mirror -- it is dependency-free, matching this repo's existing pure-logic
// convention, and Node's ESM loader cannot resolve that mirror's own
// extensionless internal imports without a build step (functions/test's own
// tests run against the compiled lib/ output for the same reason).
//
// Run: node test/permissionDecisionCopy.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { describePermissionDecision } from "../src/domain/permissionDecisionCopy.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ----- ALLOW -----
ok("an ALLOW result naming a matchedRoleId is described as 'Allowed', naming the Role", () => {
  const copy = describePermissionDecision({ decision: "ALLOW", reason: "qualifyingGrant", matchedRoleId: "admin" });
  assert.equal(copy.statusLabel, "Allowed");
  assert.equal(copy.explanation, 'Granted by the "admin" Role.');
});
ok("an ALLOW result with no matchedRoleId still allows, with generic copy", () => {
  const copy = describePermissionDecision({ decision: "ALLOW", reason: "qualifyingGrant" });
  assert.equal(copy.statusLabel, "Allowed");
  assert.equal(copy.explanation, "Granted by an active Role assignment.");
});

// ----- DENY: each real DenialReason -----
ok("noQualifyingGrant is described as 'Denied' with its own explanation", () => {
  const copy = describePermissionDecision({ decision: "DENY", reason: "noQualifyingGrant" });
  assert.equal(copy.statusLabel, "Denied");
  assert.equal(copy.explanation, "No active, currently-valid Role grants this permission for the selected scope.");
});
ok("unknownPermission is described as 'Denied' with its own explanation", () => {
  const copy = describePermissionDecision({ decision: "DENY", reason: "unknownPermission" });
  assert.equal(copy.statusLabel, "Denied");
  assert.equal(copy.explanation, "This permission is not recognized by the platform's permission catalog.");
});
ok("malformedAssignments is described as 'Denied' with its own explanation", () => {
  const copy = describePermissionDecision({ decision: "DENY", reason: "malformedAssignments" });
  assert.equal(copy.statusLabel, "Denied");
  assert.equal(copy.explanation, "The principal's role assignments could not be read; access is denied until they can be verified.");
});

// ----- Fail-closed on malformed/unexpected input -----
ok("a malformed/absent result object fails closed to 'Denied' with the default explanation, never throws", () => {
  for (const bad of [null, undefined, {}, "not-an-object", 42, { decision: "not-a-real-decision" }, { decision: "DENY", reason: "not-a-real-reason" }]) {
    const copy = describePermissionDecision(bad);
    assert.equal(copy.statusLabel, "Denied");
    assert.equal(copy.explanation, "No active, currently-valid Role grants this permission for the selected scope.");
  }
});

// ----- No raw ids/paths ever leak into the copy -----
ok("the copy never includes a raw assignment/document id, only the repository-declared Role id", () => {
  const copy = describePermissionDecision({
    decision: "ALLOW",
    reason: "qualifyingGrant",
    matchedRoleId: "admin",
    matchedAssignmentId: "roleAssignments/verySecretOpaqueDocumentId12345",
  });
  assert.equal(copy.explanation.includes("verySecretOpaqueDocumentId12345"), false);
  assert.equal(copy.explanation.includes("roleAssignments/"), false);
});

console.log(`\n${passed} passed, 0 failed`);
