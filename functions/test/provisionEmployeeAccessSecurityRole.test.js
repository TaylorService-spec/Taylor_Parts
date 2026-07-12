const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPlan } = require("../scripts/provisionEmployeeAccess.js");

// Inventory Operational Queue A0 (docs/specifications/inventory-operational-
// queue.md; docs/implementation-plans/inventory-operational-queue.md).
// buildPlan() is pure (no I/O, per provisionEmployeeAccess.js's own phase D
// contract) -- these tests exercise it directly with hand-built state
// objects, the same lightweight-mock pattern this project's sibling test
// file (onboardEmployeeVerify.test.js) already uses for this exact script's
// neighbor tool, rather than requiring a live emulator for logic that
// touches no Firestore/Auth SDK call itself.
//
// What's being proven: every code path that sets users/{uid}.role
// (userUpdates.role) also sets the linked Employee's securityRole mirror
// (employeeDoc.securityRole or employeeUpdates.securityRole) in the SAME
// returned plan -- the securityRole mirror invariant documented at the top
// of provisionEmployeeAccess.js. No path is exercised here that claims the
// mirror is ever read back or cross-verified against users/{uid} -- that
// is exclusively the separate drift-detection script's job.

test("Case D (UPDATE_SECURITY_ROLE): writes users/{uid}.role and employees/{employeeId}.securityRole together", () => {
  const plan = buildPlan(
    { employeeId: "emp-1", displayName: undefined, email: undefined, securityRole: "dispatcher", operationalRoles: undefined },
    { employee: { userId: "uid-1", securityRole: "technician" }, targetAuthUser: null }
  );
  assert.equal(plan.operation, "UPDATE_SECURITY_ROLE");
  assert.equal(plan.userId, "uid-1");
  assert.deepEqual(plan.userUpdates, { role: "dispatcher" });
  assert.deepEqual(plan.employeeUpdates, { securityRole: "dispatcher" });
});

test("Case B (GRANT_ACCESS), new Employee with --securityRole: employeeDoc.securityRole matches userUpdates.role", () => {
  const plan = buildPlan(
    { employeeId: "emp-2", displayName: "Jane Doe", email: "jane@example.com", securityRole: "admin", operationalRoles: ["PARTS_ASSOCIATE"] },
    { employee: null, targetAuthUser: null }
  );
  assert.equal(plan.operation, "GRANT_ACCESS");
  assert.equal(plan.employeeDoc.securityRole, "admin");
  assert.equal(plan.userUpdates.role, "admin");
  assert.equal(plan.employeeDoc.securityRole, plan.userUpdates.role);
});

test("Case B (GRANT_ACCESS), new Employee with no --securityRole: employeeDoc.securityRole is reserved null, userUpdates.role is absent", () => {
  const plan = buildPlan(
    { employeeId: "emp-3", displayName: "No Role Yet", email: "norole@example.com", securityRole: undefined, operationalRoles: undefined },
    { employee: null, targetAuthUser: null }
  );
  assert.equal(plan.operation, "GRANT_ACCESS");
  assert.equal(plan.employeeDoc.securityRole, null);
  assert.equal("role" in plan.userUpdates, false);
});

test("Case B (GRANT_ACCESS), existing Employee, --securityRole differs from current: employeeUpdates.securityRole matches userUpdates.role", () => {
  const plan = buildPlan(
    { employeeId: "emp-4", displayName: undefined, email: "existing@example.com", securityRole: "dispatcher", operationalRoles: undefined },
    { employee: { userId: "uid-4", displayName: "Existing Person", operationalRoles: [], securityRole: "technician" }, targetAuthUser: { uid: "uid-4" } }
  );
  assert.equal(plan.operation, "GRANT_ACCESS");
  assert.equal(plan.employeeUpdates.securityRole, "dispatcher");
  assert.equal(plan.userUpdates.role, "dispatcher");
});

test("Case B (GRANT_ACCESS), existing Employee, --securityRole matches current: employeeUpdates omits securityRole (no-op field, not rewritten)", () => {
  const plan = buildPlan(
    { employeeId: "emp-5", displayName: undefined, email: "same@example.com", securityRole: "admin", operationalRoles: undefined },
    { employee: { userId: "uid-5", displayName: "Same Role", operationalRoles: [], securityRole: "admin" }, targetAuthUser: { uid: "uid-5" } }
  );
  assert.equal(plan.operation, "GRANT_ACCESS");
  assert.equal("securityRole" in plan.employeeUpdates, false);
  // userUpdates.role is still set even when unchanged -- set() with
  // merge:true on an identical value is a safe no-op write, matching
  // this file's own idempotency contract; the mirror invariant is about
  // the plan's SHAPE (both-or-neither), not about skipping a redundant
  // write to users/{uid}.
  assert.equal(plan.userUpdates.role, "admin");
});

test("Case A (CREATE_EMPLOYEE_ONLY): securityRole is always reserved null at creation, never omitted", () => {
  const plan = buildPlan(
    { employeeId: "emp-6", displayName: "No Access Yet", email: undefined, securityRole: undefined, operationalRoles: ["WAREHOUSE_ASSOCIATE"] },
    { employee: null, targetAuthUser: null }
  );
  assert.equal(plan.operation, "CREATE_EMPLOYEE_ONLY");
  assert.equal(plan.employeeDoc.securityRole, null);
});

test("Case C (UPDATE_EMPLOYEE_ONLY): no securityRole field touched -- this path never carries a security role at all", () => {
  const plan = buildPlan(
    { employeeId: "emp-7", displayName: "Renamed", email: undefined, securityRole: undefined, operationalRoles: undefined },
    { employee: { displayName: "Old Name", operationalRoles: [], securityRole: null }, targetAuthUser: null }
  );
  assert.equal(plan.operation, "UPDATE_EMPLOYEE_ONLY");
  assert.equal(plan.employeeUpdates.securityRole, undefined);
  assert.equal("securityRole" in plan.employeeUpdates, false);
});
