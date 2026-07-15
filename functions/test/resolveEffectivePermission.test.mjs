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
check("A3: every Permission id is granted by at least one compatibility Role (directly or Conditioned) except the deferred admin.*/audit.* ids", () => {
  const deferredForNow = new Set([
    "admin.userStatus.write",
    "admin.roleAssignment.write",
    "admin.accessRequest.decide",
    "audit.event.read",
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
check("admin: reorder.purchaseOrder.void ALLOW even without isOwnAssignment", () => {
  assert.equal(
    resolve("admin", "reorder.purchaseOrder.void", baseTarget({ condition: { isOwnAssignment: false } })).decision,
    "ALLOW",
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

// --- Scope: tenant is inert/neutral, ownAssignment requires the flag, domain/location require exact match ---
check("Scope: tenant-scoped assignment matches (neutral pass-through per Spec sec10)", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { scope: { type: "tenant", value: "unresolved" } })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
  });
  assert.equal(result.decision, "ALLOW");
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
