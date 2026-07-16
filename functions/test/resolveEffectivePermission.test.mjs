// Enterprise Access & Administration Platform (Issue #226) -- Row 2
// (Task 7) acceptance tests. Covers Spec sec21 A1 (resolver is a pure
// function; exhaustive allow/deny per seeded Role), A3 (every legacy
// capability has a seeded-compatibility mapping), and S1/S2 (fail-closed
// on missing/stale/malformed access data; operationalRole never grants
// a Permission by itself).
//
// Dependency-free: plain Node assert against the compiled resolver +
// seeded Roles, no test runner, matching this repo's existing
// pure-logic test convention.
//
// Prerequisite: `npm run build` in functions/ first (imports the
// compiled lib/ output, not the TypeScript source).
import assert from "node:assert/strict";
import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import { COMPATIBILITY_ROLES, ADMIN_ROLE, DISPATCHER_ROLE, TECHNICIAN_ROLE } from "../lib/access/compatibilityRoles.js";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

function activeAssignment(roleId, overrides = {}) {
  return {
    id: `assignment-${roleId}`,
    principalUid: "principal-1",
    roleId,
    scope: { type: "global" },
    grantedBy: "seed",
    grantedAt: { toMillis: () => 0 },
    status: "active",
    accessVersionAtGrant: 1,
    ...overrides,
  };
}

function baseTarget(overrides = {}) {
  return {
    scope: { type: "global" },
    condition: {},
    ...overrides,
  };
}

function resolve(roleId, permissionId, target, accessVersion = 1) {
  return resolveEffectivePermission({
    permissionId,
    assignments: [activeAssignment(roleId)],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: accessVersion,
    target,
  });
}

// --- A3: every catalog id is accounted for by at least one seeded Role ---
check("A3: every Permission id is granted by at least one compatibility Role (directly or Conditioned) except the still-deferred audit.event.read (Row 11) and the report.* field-read capability class (Issue #325 / ADR-007 D-226)", () => {
  // admin.userStatus.write/admin.roleAssignment.write/admin.
  // accessRequest.decide were granted to ADMIN_ROLE in Row 7 (Task 12) --
  // Row 7 is the trusted-writer row Row 2's own comment deferred them to.
  //
  // report.* (34 ids, permissionCatalog.ts's "Report field-level read
  // capabilities" section): D-226 is catalog-only per its own scope --
  // no Rule, Function, or Role grants these ids yet. Granting them here
  // would be premature: the trusted execution/projection service (D-FN)
  // that would be the actual caller does not exist, is #15-gated, and
  // per ADR-007 is "unavailable-not-unsafe" until then. Whether/how
  // report.* ids are eventually granted to a compatibility Role (vs.
  // only to a future reporting-specific Role) is an open decision for
  // that later, separately-authorized row -- not resolved by this
  // catalog-only PR.
  const deferredForNow = new Set([
    "audit.event.read",
    ...PERMISSION_CATALOG.filter((p) => p.id.startsWith("report.")).map((p) => p.id),
  ]);
  const grantedIds = new Set([
    ...ADMIN_ROLE.permissions,
    ...DISPATCHER_ROLE.permissions,
    ...TECHNICIAN_ROLE.permissions,
  ]);
  for (const permission of PERMISSION_CATALOG) {
    if (deferredForNow.has(permission.id)) continue;
    assert.ok(grantedIds.has(permission.id), `"${permission.id}" is granted by no seeded Role`);
  }
});

// --- A1: pure function, identical inputs -> identical decision ---
check("A1: resolver is a pure function (same inputs -> same decision, repeatedly)", () => {
  const first = resolve("admin", "account.record.read", baseTarget());
  const second = resolve("admin", "account.record.read", baseTarget());
  assert.deepEqual(first, second);
});

// --- admin ---
check("admin: account.governedField.write ALLOW", () => {
  assert.equal(resolve("admin", "account.governedField.write", baseTarget()).decision, "ALLOW");
});
check("admin: reorder.request.approve ALLOW", () => {
  assert.equal(resolve("admin", "reorder.request.approve", baseTarget()).decision, "ALLOW");
});
check("admin: reorder.purchaseOrder.void ALLOW as the request's own assignee", () => {
  assert.equal(
    resolve("admin", "reorder.purchaseOrder.void", baseTarget({ condition: { isOwnAssignment: true } })).decision,
    "ALLOW",
  );
});
check("admin: reorder.purchaseOrder.void DENY when not the request's own assignee (firestore.rules double-gates Void: isAdminOrDispatcher() AND assignee)", () => {
  assert.equal(
    resolve("admin", "reorder.purchaseOrder.void", baseTarget({ condition: { isOwnAssignment: false } })).decision,
    "DENY",
  );
});

// --- dispatcher: Issue #175 governed-field DENY ---
check("dispatcher: account.governedField.write DENY (Issue #175)", () => {
  assert.equal(resolve("dispatcher", "account.governedField.write", baseTarget()).decision, "DENY");
});
check("dispatcher: account.record.read ALLOW", () => {
  assert.equal(resolve("dispatcher", "account.record.read", baseTarget()).decision, "ALLOW");
});
check("dispatcher: reorder.request.cancel ALLOW", () => {
  assert.equal(resolve("dispatcher", "reorder.request.cancel", baseTarget()).decision, "ALLOW");
});
check("dispatcher: none of the Row 7 admin.* authorities (regression guard: admin/dispatcher no longer share a filter-derived permission list)", () => {
  for (const permissionId of [
    "admin.userStatus.write",
    "admin.roleAssignment.write",
    "admin.accessRequest.decide",
  ]) {
    assert.equal(resolve("dispatcher", permissionId, baseTarget()).decision, "DENY", `expected dispatcher DENY for ${permissionId}`);
  }
});
check("admin: all three Row 7 admin.* authorities ALLOW", () => {
  for (const permissionId of [
    "admin.userStatus.write",
    "admin.roleAssignment.write",
    "admin.accessRequest.decide",
  ]) {
    assert.equal(resolve("admin", permissionId, baseTarget()).decision, "ALLOW", `expected admin ALLOW for ${permissionId}`);
  }
});

// --- technician: no Customer access, no approve/reject/cancel/system-create ---
check("technician: account.record.read DENY", () => {
  assert.equal(resolve("technician", "account.record.read", baseTarget()).decision, "DENY");
});
check("technician: reorder.request.approve DENY (not in permission set at all)", () => {
  assert.equal(resolve("technician", "reorder.request.approve", baseTarget()).decision, "DENY");
});
check("technician: reorder.request.create.system DENY", () => {
  assert.equal(resolve("technician", "reorder.request.create.system", baseTarget()).decision, "DENY");
});
check("technician: workOrder.transition ALLOW unconditioned (direction narrowed elsewhere)", () => {
  assert.equal(resolve("technician", "workOrder.transition", baseTarget()).decision, "ALLOW");
});

// --- technician: Issue #100 operational-role Conditions, S2 (operationalRole never grants by itself) ---
check("technician: reorder.request.assign DENY when PARTS_MANAGER not active", () => {
  const target = baseTarget({ condition: { operationalRoleActive: () => false } });
  assert.equal(resolve("technician", "reorder.request.assign", target).decision, "DENY");
});
check("technician: reorder.request.assign ALLOW when PARTS_MANAGER active", () => {
  const target = baseTarget({
    condition: { operationalRoleActive: (role) => role === "PARTS_MANAGER" },
  });
  assert.equal(resolve("technician", "reorder.request.assign", target).decision, "ALLOW");
});
check("technician: reorder.request.startPurchasing DENY for a PARTS_MANAGER (wrong operational role)", () => {
  const target = baseTarget({
    condition: { operationalRoleActive: (role) => role === "PARTS_MANAGER" },
  });
  assert.equal(resolve("technician", "reorder.request.startPurchasing", target).decision, "DENY");
});
check("technician: reorder.request.create.manual ALLOW for either PARTS_MANAGER or WAREHOUSE_MANAGER (ANY-of)", () => {
  const asManager = baseTarget({ condition: { operationalRoleActive: (r) => r === "PARTS_MANAGER" } });
  const asWarehouse = baseTarget({ condition: { operationalRoleActive: (r) => r === "WAREHOUSE_MANAGER" } });
  assert.equal(resolve("technician", "reorder.request.create.manual", asManager).decision, "ALLOW");
  assert.equal(resolve("technician", "reorder.request.create.manual", asWarehouse).decision, "ALLOW");
});
check("technician: reorder.purchaseOrder.void DENY even as an active PARTS_ASSOCIATE and the request's own assignee (no operational role gets Void)", () => {
  const target = baseTarget({
    condition: { operationalRoleActive: () => true, isOwnAssignment: true },
  });
  assert.equal(resolve("technician", "reorder.purchaseOrder.void", target).decision, "DENY");
});

// --- S1: fail-closed on missing/stale/malformed/unavailable access data ---
check("S1: unknown PermissionId -> DENY", () => {
  const result = resolve("admin", "not.a.realPermission", baseTarget());
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "unknownPermission");
});
check("S1: non-array assignments -> DENY", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: undefined,
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "malformedAssignments");
});
check("S1: disabled assignment contributes nothing -> DENY", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { status: "disabled" })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
});
check("S1: stale assignment (accessVersionAtGrant > current) contributes nothing -> DENY", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { accessVersionAtGrant: 5 })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
});
check("S1: assignment referencing an unknown roleId contributes nothing -> DENY", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("not-a-real-role")],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
});
check("S1: malformed assignment (missing scope) is excluded, not thrown", () => {
  const malformed = { ...activeAssignment("admin") };
  delete malformed.scope;
  const wellFormed = activeAssignment("dispatcher");
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [malformed, wellFormed],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  // The malformed assignment is skipped silently; the well-formed one still resolves.
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.matchedAssignmentId, wellFormed.id);
});
check("S1: unknown ConditionKind never passes (fails closed)", () => {
  const roles = {
    ...COMPATIBILITY_ROLES,
    technician: {
      ...TECHNICIAN_ROLE,
      conditionsByPermission: {
        ...TECHNICIAN_ROLE.conditionsByPermission,
        "reorder.request.assign": [{ kind: "notARealKind", params: {} }],
      },
    },
  };
  const result = resolveEffectivePermission({
    permissionId: "reorder.request.assign",
    assignments: [activeAssignment("technician")],
    roles,
    currentAccessVersion: 1,
    target: baseTarget({ condition: { operationalRoleActive: () => true } }),
  });
  assert.equal(result.decision, "DENY");
});

// --- Scope: tenant is inert/never-widening (requires exact match like domain/location), ownAssignment requires the flag ---
check("Scope: tenant-scoped assignment DENY against a global target (genuinely inert -- never widens to global authority)", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { scope: { type: "tenant", value: "unresolved" } })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
});
check("Scope: tenant-scoped assignment DENY even against a matching-shaped tenant target (no live tenant model exists -- #140 is the only future authority for this)", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { scope: { type: "tenant", value: "tenant-a" } })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget({ scope: { type: "tenant", value: "tenant-b" } }),
  });
  assert.equal(result.decision, "DENY");
});
check("Scope: a tenant-scoped admin assignment cannot authorize a global trusted command (admin.roleAssignment.write) -- proves tenant Scope never widens to global authority", () => {
  const result = resolveEffectivePermission({
    permissionId: "admin.roleAssignment.write",
    assignments: [activeAssignment("admin", { scope: { type: "tenant", value: "any-tenant" } })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget({ scope: { type: "global" } }),
  });
  assert.equal(result.decision, "DENY");
});
check("Scope: domain-scoped assignment DENY against a non-matching target domain", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { scope: { type: "domain", value: "customer" } })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget({ scope: { type: "domain", value: "inventory" } }),
  });
  assert.equal(result.decision, "DENY");
});
check("Scope: domain-scoped assignment ALLOW against a matching target domain", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { scope: { type: "domain", value: "customer" } })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget({ scope: { type: "domain", value: "customer" } }),
  });
  assert.equal(result.decision, "ALLOW");
});

// --- Issue #325 / ADR-007 D-226: field-level read-capability extension.
// "Unknown, inactive, malformed, or unregistered field capabilities
// deny" -- each of the four is exercised as its own distinguishable
// case, including proving `inactivePermission` denies UNCONDITIONALLY,
// ahead of and regardless of any Role grant (a synthetic Role fixture
// below, never COMPATIBILITY_ROLES, so this is provably not "denied
// only because nothing grants it").

check("D-226: unregistered field capability id denies as unknownPermission, even with a synthetic grant", () => {
  const roles = {
    syntheticGrantsAll: {
      id: "syntheticGrantsAll",
      name: "test fixture",
      description: "grants an unregistered id -- proves the catalog gate, not the grant, denies",
      permissions: ["report.customer.field.doesNotExist.read"],
    },
  };
  const result = resolveEffectivePermission({
    permissionId: "report.customer.field.doesNotExist.read",
    assignments: [activeAssignment("syntheticGrantsAll")],
    roles,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "unknownPermission");
});

check("D-226: malformed field-shaped id (missing the literal 'field' segment) denies as unknownPermission", () => {
  const roles = {
    syntheticGrantsAll: {
      id: "syntheticGrantsAll",
      name: "test fixture",
      description: "grants a malformed id -- proves the catalog gate denies a shape that was never registered",
      permissions: ["report.customer.name.read"],
    },
  };
  const result = resolveEffectivePermission({
    permissionId: "report.customer.name.read",
    assignments: [activeAssignment("syntheticGrantsAll")],
    roles,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "unknownPermission");
});

check("D-226: inactive field capability denies as inactivePermission EVEN WHEN a Role grants it (ADR-007 sec2.6 override)", () => {
  const roles = {
    syntheticGrantsNotes: {
      id: "syntheticGrantsNotes",
      name: "test fixture",
      description: "grants the registered-but-inactive customer.notes field-read capability",
      permissions: ["report.customer.field.notes.read"],
    },
  };
  const result = resolveEffectivePermission({
    permissionId: "report.customer.field.notes.read",
    assignments: [activeAssignment("syntheticGrantsNotes")],
    roles,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "inactivePermission");
});

check("D-226: inactive wave-4-deferred accountOwner field capability denies the same way", () => {
  const roles = {
    syntheticGrantsOwner: {
      id: "syntheticGrantsOwner",
      name: "test fixture",
      permissions: ["report.customer.field.accountOwner.read"],
    },
  };
  const result = resolveEffectivePermission({
    permissionId: "report.customer.field.accountOwner.read",
    assignments: [activeAssignment("syntheticGrantsOwner")],
    roles,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "inactivePermission");
});

check("D-226: an ACTIVE, registered field capability ALLOWs normally when actually granted (the mechanism works, not just denies)", () => {
  const roles = {
    syntheticGrantsName: {
      id: "syntheticGrantsName",
      name: "test fixture",
      permissions: ["report.customer.field.name.read"],
    },
  };
  const result = resolveEffectivePermission({
    permissionId: "report.customer.field.name.read",
    assignments: [activeAssignment("syntheticGrantsName")],
    roles,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.reason, "qualifyingGrant");
  assert.equal(result.matchedRoleId, "syntheticGrantsName");
});

check("D-226: an active, registered field capability with NO grant at all denies as noQualifyingGrant (not inactivePermission/unknownPermission)", () => {
  const result = resolveEffectivePermission({
    permissionId: "report.customer.field.name.read",
    assignments: [activeAssignment("admin")], // admin's real grants never include report.* (A3 deferral)
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "noQualifyingGrant");
});

check("D-226: no compatibility Role (admin/dispatcher/technician) is granted any report.* id today (catalog-only, no premature grant)", () => {
  const reportIds = new Set(PERMISSION_CATALOG.filter((p) => p.id.startsWith("report.")).map((p) => p.id));
  for (const role of Object.values(COMPATIBILITY_ROLES)) {
    for (const id of role.permissions) {
      assert.ok(!reportIds.has(id), `compatibility Role "${role.id}" unexpectedly grants "${id}"`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
