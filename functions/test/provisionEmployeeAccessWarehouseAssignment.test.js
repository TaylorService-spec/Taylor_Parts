const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPlan, detectConflicts, normalizeAssignedWarehouseIds } = require("../scripts/provisionEmployeeAccess.js");

// Issue #226 -- WAREHOUSE_MANAGER scoped access, Implementation Plan Row A
// (docs/specifications/warehouse-manager-scoped-access.md,
// docs/implementation-plans/warehouse-manager-scoped-access.md). Same
// lightweight-mock pattern as provisionEmployeeAccessSecurityRole.test.js
// and provisionEmployeeAccessCaseDTransaction.test.js -- buildPlan() and
// detectConflicts() are pure (no I/O), exercised directly with hand-built
// state objects, no emulator required.
//
// What's being proven: absent/empty assignedWarehouseIds never defaults to
// "all warehouses" (always [] , never omitted, on create); an unknown
// warehouse ID is rejected before any write; an unchanged value is not
// rewritten; a changed value is written; the field is Employee-side only
// (never touches userUpdates, never appears on the UPDATE_SECURITY_ROLE
// plan).

test("normalizeAssignedWarehouseIds: undefined/empty input yields undefined (not [])", () => {
  assert.equal(normalizeAssignedWarehouseIds(undefined), undefined);
  assert.equal(normalizeAssignedWarehouseIds(""), undefined);
});

test("normalizeAssignedWarehouseIds: trims, drops empties, de-duplicates, preserves first-occurrence order", () => {
  assert.deepEqual(
    normalizeAssignedWarehouseIds(" wh-main ,wh-satellite,, wh-main ,wh-east"),
    ["wh-main", "wh-satellite", "wh-east"]
  );
});

test("detectConflicts: throws when a referenced warehouse does not exist, names every missing ID", () => {
  assert.throws(
    () =>
      detectConflicts(
        { employeeId: "emp-1", displayName: undefined, email: undefined, securityRole: undefined,
          assignedWarehouseIds: ["wh-main", "wh-ghost"], requireExistingAuthUser: false },
        { employee: { userId: "uid-1" }, linkedUserRecord: null, targetAuthUser: null, targetUserDoc: null,
          missingWarehouseIds: ["wh-ghost"] }
      ),
    /Warehouse\(s\) not found: wh-ghost/
  );
});

test("detectConflicts: does not throw when every referenced warehouse exists", () => {
  assert.doesNotThrow(() =>
    detectConflicts(
      { employeeId: "emp-1", displayName: undefined, email: undefined, securityRole: undefined,
        assignedWarehouseIds: ["wh-main"], requireExistingAuthUser: false },
      { employee: { userId: "uid-1" }, linkedUserRecord: null, targetAuthUser: null, targetUserDoc: null,
        missingWarehouseIds: [] }
    )
  );
});

test("detectConflicts: no assignedWarehouseIds requested -- missingWarehouseIds is ignored entirely", () => {
  assert.doesNotThrow(() =>
    detectConflicts(
      { employeeId: "emp-1", displayName: "Someone", email: undefined, securityRole: undefined,
        assignedWarehouseIds: undefined, requireExistingAuthUser: false },
      { employee: null, linkedUserRecord: null, targetAuthUser: null, targetUserDoc: null,
        missingWarehouseIds: [] }
    )
  );
});

test("buildPlan Case A (CREATE_EMPLOYEE_ONLY): assignedWarehouseIds defaults to [], never omitted", () => {
  const plan = buildPlan(
    { employeeId: "emp-2", displayName: "Jane Doe", email: undefined, securityRole: undefined,
      operationalRoles: undefined, assignedWarehouseIds: undefined },
    { employee: null, targetAuthUser: null }
  );
  assert.equal(plan.operation, "CREATE_EMPLOYEE_ONLY");
  assert.deepEqual(plan.employeeDoc.assignedWarehouseIds, []);
});

test("buildPlan Case A (CREATE_EMPLOYEE_ONLY): assignedWarehouseIds is written verbatim when given", () => {
  const plan = buildPlan(
    { employeeId: "emp-3", displayName: "Jane Doe", email: undefined, securityRole: undefined,
      operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: ["wh-main"] },
    { employee: null, targetAuthUser: null }
  );
  assert.deepEqual(plan.employeeDoc.assignedWarehouseIds, ["wh-main"]);
});

test("buildPlan Case C (UPDATE_EMPLOYEE_ONLY): unchanged assignedWarehouseIds is not rewritten", () => {
  const plan = buildPlan(
    { employeeId: "emp-4", displayName: undefined, email: undefined, securityRole: undefined,
      operationalRoles: undefined, assignedWarehouseIds: ["wh-main"] },
    { employee: { userId: "uid-4", operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: ["wh-main"] },
      targetAuthUser: null }
  );
  assert.equal(plan.operation, "UPDATE_EMPLOYEE_ONLY");
  assert.equal(plan.employeeUpdates, null, "no field changed -- no-op update");
});

test("buildPlan Case C (UPDATE_EMPLOYEE_ONLY): changed assignedWarehouseIds is written", () => {
  const plan = buildPlan(
    { employeeId: "emp-5", displayName: undefined, email: undefined, securityRole: undefined,
      operationalRoles: undefined, assignedWarehouseIds: ["wh-main", "wh-satellite"] },
    { employee: { userId: "uid-5", operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: ["wh-main"] },
      targetAuthUser: null }
  );
  assert.deepEqual(plan.employeeUpdates.assignedWarehouseIds, ["wh-main", "wh-satellite"]);
});

test("buildPlan Case C (UPDATE_EMPLOYEE_ONLY): pre-migration Employee (field absent) gets it written on first assignment", () => {
  const plan = buildPlan(
    { employeeId: "emp-6", displayName: undefined, email: undefined, securityRole: undefined,
      operationalRoles: undefined, assignedWarehouseIds: ["wh-main"] },
    { employee: { userId: "uid-6", operationalRoles: ["WAREHOUSE_MANAGER"] }, targetAuthUser: null }
  );
  assert.deepEqual(plan.employeeUpdates.assignedWarehouseIds, ["wh-main"]);
});

test("buildPlan Case B (GRANT_ACCESS), new Employee: assignedWarehouseIds defaults to [] alongside a new Auth link", () => {
  const plan = buildPlan(
    { employeeId: "emp-7", displayName: "New Hire", email: "new@example.com", securityRole: "technician",
      operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: undefined },
    { employee: null, targetAuthUser: null }
  );
  assert.equal(plan.operation, "GRANT_ACCESS");
  assert.deepEqual(plan.employeeDoc.assignedWarehouseIds, []);
});

test("buildPlan Case B (GRANT_ACCESS), existing Employee: assignedWarehouseIds change lands in employeeUpdates, never in userUpdates", () => {
  const plan = buildPlan(
    { employeeId: "emp-8", displayName: undefined, email: "existing@example.com", securityRole: undefined,
      operationalRoles: undefined, assignedWarehouseIds: ["wh-east"] },
    { employee: { userId: "uid-8", operationalRoles: ["WAREHOUSE_MANAGER"], assignedWarehouseIds: [] },
      targetAuthUser: { uid: "uid-8" } }
  );
  assert.deepEqual(plan.employeeUpdates.assignedWarehouseIds, ["wh-east"]);
  assert.equal("assignedWarehouseIds" in plan.userUpdates, false, "never a users/{uid} field");
});

test("buildPlan Case D (UPDATE_SECURITY_ROLE): assignedWarehouseIds is untouched -- Employee-side field only, not part of this branch", () => {
  const plan = buildPlan(
    { employeeId: "emp-9", displayName: undefined, email: undefined, securityRole: "dispatcher",
      operationalRoles: undefined, assignedWarehouseIds: ["wh-main"] },
    { employee: { userId: "uid-9", securityRole: "technician", assignedWarehouseIds: [] }, targetAuthUser: null }
  );
  assert.equal(plan.operation, "UPDATE_SECURITY_ROLE");
  assert.deepEqual(plan.employeeUpdates, { securityRole: "dispatcher" });
  assert.equal("assignedWarehouseIds" in plan.employeeUpdates, false);
});
