// GENERAL MANAGER HOLDS NO SECURITY ADMINISTRATION.
// Run: node --test test/generalManagerNoAdmin.test.mjs
//
// ============================ THE DECISION THIS PINS ============================
//
// The canonical business-intent matrix grants General Manager CRED on both Users and
// Roles / Permissions. Implementing that literally would produce a NON-PRIVILEGED Role holding
// admin.roleAssignment.write -- and a General Manager could then grant themselves any Role, owner
// included, through the ordinary grant path instead of the privileged two-person one.
//
// Owner ruling 2026-08-21: General Manager is the highest broad BUSINESS role and is NOT security
// administration. Broad operational authority, employee visibility, audit read -- yes. Access
// administration -- no. Owner and Admin retain it.
//
// This is pinned mechanically because the matrix still SAYS CRED. Anyone regenerating role
// definitions from the workbook without the override would restore the self-escalation path, and it
// would look like a faithful implementation of a business document rather than a security change.
import test from "node:test";
import assert from "node:assert/strict";
import { GENERAL_MANAGER_ROLE, GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";

test("generalManager holds zero admin.* capabilities", () => {
  const admin = (GENERAL_MANAGER_ROLE.permissions || []).filter((p) => p.startsWith("admin."));
  assert.deepEqual(
    admin, [],
    "General Manager must never hold admin.* -- the workbook's CRED on Users and Roles/Permissions is " +
    "deliberately overridden (Owner ruling 2026-08-21). Restoring it recreates a self-escalation path.",
  );
});

test("generalManager holds no capability that could grant itself more authority", () => {
  // admin.* is the obvious shape. This checks the PROPERTY rather than the prefix, so a future
  // capability that confers grant authority under a different name is caught too.
  const SELF_ESCALATION = [
    "admin.roleAssignment.write",   // assign Roles -- including to oneself
    "admin.userStatus.write",       // enable/disable principals
    "admin.accessRequest.decide",   // approve one's own access request
    "admin.credentialReset.initiate",
  ];
  for (const cap of SELF_ESCALATION) {
    assert.equal(
      (GENERAL_MANAGER_ROLE.permissions || []).includes(cap), false,
      `generalManager must not hold ${cap}`,
    );
  }
});

test("generalManager is non-privileged, which is exactly why the above matters", () => {
  // A privileged Role routes through the two-person grant path. General Manager does not -- so an
  // admin.* capability here would be reachable through the ordinary path with no second approver.
  assert.notEqual(GENERAL_MANAGER_ROLE.privileged, true);
});

test("no OTHER non-privileged governed Role holds security administration either", () => {
  // The same hazard, generalised. owner is the one deliberate exception and is privileged.
  for (const [id, role] of Object.entries(GOVERNED_BUSINESS_ROLES)) {
    if (id === "owner") continue;
    const admin = (role.permissions || []).filter((p) => p.startsWith("admin."));
    assert.deepEqual(admin, [], `${id} must not hold security administration: ${admin.join(", ")}`);
  }
});

test("generalManager DOES hold broad business authority -- this is not a role that does nothing", () => {
  // The counterweight. A guard that only forbids could be satisfied by an empty Role, which would
  // pass while quietly undoing the grant the Owner actually made.
  const perms = GENERAL_MANAGER_ROLE.permissions || [];
  assert.ok(perms.length >= 20, `expected broad business authority, got ${perms.length}`);
  for (const expected of ["customer.record.create", "salesOrder.write", "opportunity.createSalesOrder",
                          "finance.invoice.issue", "workOrder.create", "audit.event.read"]) {
    assert.ok(perms.includes(expected), `generalManager should hold ${expected}`);
  }
});
