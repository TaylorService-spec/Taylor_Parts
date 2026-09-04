// Tests for the C1-IDENTITY-01 roster reconciliation classifier.
//
// Every fixture below is synthetic. No Taylor person, production uid, employee id or role
// assignment is named anywhere in this file, and none may be added to it.
//
// Run: node --test docs/customer-1/identity/rosterReconciliation.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { reconcileRoster } from "./rosterReconciliation.mjs";

const KNOWN_ROLES = ["role.alpha", "role.beta"];

/** One principal whose five records all agree. The baseline every case below perturbs. */
const clean = () => ({
  authAccounts: [{ uid: "uid-1", disabled: false }],
  users: [{ uid: "uid-1", role: "technician", employeeId: "emp-1" }],
  employees: [
    {
      employeeId: "emp-1",
      userId: "uid-1",
      employmentStatus: "ACTIVE",
      securityRole: "technician",
      operationalRoles: [],
      assignedWarehouseIds: ["wh-1"],
    },
  ],
  roleAssignments: [
    { id: "ra-1", principalUid: "uid-1", roleId: "role.alpha", status: "active", scope: { type: "location", value: "wh-1" } },
  ],
  knownRoleIds: KNOWN_ROLES,
});

const kinds = (result) => result.exceptions.map((e) => e.kind).sort();

test("a fully agreeing roster produces no exceptions", () => {
  const result = reconcileRoster(clean());
  assert.deepEqual(result.exceptions, []);
  assert.deepEqual(result.limits, []);
  assert.deepEqual(result.denominator, {
    authAccountsRead: 1,
    usersDocuments: 1,
    principalsWithAssignments: 1,
    principalsConsidered: 1,
  });
});

test("an Auth account with no users document is an orphan", () => {
  const input = clean();
  input.authAccounts.push({ uid: "uid-2", disabled: false });
  assert.deepEqual(kinds(reconcileRoster(input)), ["ORPHAN_AUTH_ACCOUNT"]);
});

test("omitting the Auth read is a stated limit, not a clean orphan result", () => {
  const input = clean();
  delete input.authAccounts;
  const result = reconcileRoster(input);
  assert.deepEqual(result.exceptions, []);
  assert.equal(result.denominator.authAccountsRead, null);
  assert.match(result.limits[0], /^AUTH_NOT_READ:/);
});

test("the join is users.employeeId, in that direction", () => {
  const noLink = clean();
  delete noLink.users[0].employeeId;
  assert.deepEqual(kinds(reconcileRoster(noLink)), ["PRINCIPAL_HAS_NO_EMPLOYEE_LINK"]);

  const unresolved = clean();
  unresolved.users[0].employeeId = "emp-missing";
  assert.deepEqual(kinds(reconcileRoster(unresolved)), ["PRINCIPAL_JOIN_UNRESOLVED"]);

  const backLink = clean();
  backLink.employees[0].userId = "uid-other";
  assert.deepEqual(kinds(reconcileRoster(backLink)), ["BACK_LINK_MISMATCH"]);
});

test("a principal with zero role assignments is ungoverned, not absent", () => {
  const input = clean();
  input.roleAssignments = [];
  input.employees[0].assignedWarehouseIds = [];
  const result = reconcileRoster(input);
  assert.deepEqual(kinds(result), ["UNGOVERNED_PRINCIPAL"]);
  assert.equal(result.denominator.principalsWithAssignments, 0);
  assert.equal(result.denominator.principalsConsidered, 1);
});

test("securityRole drift against the linked users.role is reported", () => {
  const input = clean();
  input.employees[0].securityRole = "admin";
  const [drift] = reconcileRoster(input).exceptions;
  assert.equal(drift.kind, "SECURITY_ROLE_MIRROR_DRIFT");
  assert.equal(drift.securityRole, "admin");
  assert.equal(drift.userRole, "technician");
});

test("assignment status and scope defects are reported per assignment", () => {
  const input = clean();
  input.roleAssignments = [
    { id: "ra-1", principalUid: "uid-1", roleId: "role.alpha", status: "pending", scope: { type: "global" } },
    { id: "ra-2", principalUid: "uid-1", roleId: "role.alpha", status: "active", scope: { type: "location" } },
    { id: "ra-3", principalUid: "uid-1", roleId: "role.alpha", status: "", scope: null },
    { id: "ra-4", principalUid: "uid-1", roleId: "role.unknown", status: "active", scope: { type: "global" } },
  ];
  input.employees[0].assignedWarehouseIds = [];
  assert.deepEqual(kinds(reconcileRoster(input)), [
    "ASSIGNMENT_MALFORMED",
    "ASSIGNMENT_MALFORMED_SCOPE",
    "ASSIGNMENT_MALFORMED_SCOPE",
    "ASSIGNMENT_REFERENCES_MISSING_ROLE",
    "ASSIGNMENT_UNKNOWN_STATUS",
  ]);
});

test("an assignment with no principal is set aside, never attributed to a principal", () => {
  const input = clean();
  input.roleAssignments.push({ id: "ra-orphan", principalUid: "", roleId: "role.alpha", status: "active" });
  const result = reconcileRoster(input);
  assert.deepEqual(result.exceptions, []);
  assert.deepEqual(result.assignmentsWithoutPrincipal, ["ra-orphan"]);
});

test("a terminated employee with live access is reported, and a fully closed one is not", () => {
  const live = clean();
  live.employees[0].employmentStatus = "TERMINATED";
  const [exception] = reconcileRoster(live).exceptions;
  assert.equal(exception.kind, "ACCESS_ON_TERMINATED_EMPLOYEE");
  assert.equal(exception.activeAssignments, 1);
  assert.equal(exception.authAccountEnabled, true);

  // An enabled Auth account alone is access, even with every assignment disabled.
  const authOnly = clean();
  authOnly.employees[0].employmentStatus = "TERMINATED";
  authOnly.roleAssignments[0].status = "disabled";
  authOnly.employees[0].assignedWarehouseIds = [];
  assert.ok(kinds(reconcileRoster(authOnly)).includes("ACCESS_ON_TERMINATED_EMPLOYEE"));

  const closed = clean();
  closed.employees[0].employmentStatus = "TERMINATED";
  closed.roleAssignments[0].status = "disabled";
  closed.employees[0].assignedWarehouseIds = [];
  closed.authAccounts[0].disabled = true;
  assert.deepEqual(reconcileRoster(closed).exceptions, []);
});

test("legacy and governed location scopes that disagree are contradictory; absence is not", () => {
  const contradictory = clean();
  contradictory.employees[0].assignedWarehouseIds = ["wh-2"];
  assert.deepEqual(kinds(reconcileRoster(contradictory)), ["CONTRADICTORY_LOCATION_SCOPE"]);

  // PR #1752 measured no location scopes at all in production. That is LP5's standing finding,
  // not a per-principal contradiction, and this classifier must not manufacture one.
  const noGovernedScope = clean();
  noGovernedScope.roleAssignments[0].scope = { type: "global" };
  assert.deepEqual(reconcileRoster(noGovernedScope).exceptions, []);
});
