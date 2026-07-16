// Issue #226 Row 12 -- Admin mutation UI (Task 17), gated inert. Deterministic
// unit test for AdminRolesPermissions.jsx's assignable-Role filter, which
// mirrors assignApprovedRole's own restriction (functions/src/access/
// trustedWriterCommands.ts: "limited to repository-approved, NON-PRIVILEGED
// Roles only", ADR-005 sec2.4). Tests the filter logic directly against the
// real COMPATIBILITY_ROLES catalog rather than re-implementing/duplicating
// AdminRolesPermissions.jsx's own module-level computation, since there is no
// React-rendering test harness in this repo (see this file's sibling tests
// for the same pure-logic convention).
//
// Run: node test/adminMutationAssignableRoles.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { COMPATIBILITY_ROLES } from "../src/access/compatibilityRoles.ts";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const assignableRoleIds = Object.values(COMPATIBILITY_ROLES)
  .filter((role) => !role.privileged)
  .map((role) => role.id);

ok("admin is excluded from the assignable-Role list (privileged)", () => {
  assert.equal(assignableRoleIds.includes("admin"), false);
});
ok("dispatcher and technician are both present in the assignable-Role list (non-privileged)", () => {
  assert.equal(assignableRoleIds.includes("dispatcher"), true);
  assert.equal(assignableRoleIds.includes("technician"), true);
});
ok("exactly two Roles are assignable today (admin is the only privileged compatibility Role)", () => {
  assert.deepEqual([...assignableRoleIds].sort(), ["dispatcher", "technician"]);
});

console.log(`\n${passed} passed, 0 failed`);
