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
import { OWNER_ROLE } from "../lib/access/governedBusinessRoles.js";
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

// Shared A3 accounting -- consumed by BOTH the real A3 exhaustiveness assertion AND the A3-inv synthetic
// regression, so the regression exercises the REAL gate. An id is "accounted for" if a seeded
// compatibility Role grants it OR it is deferred-by-design. buildDeferredForNow() derives the
// report.*/inventory.catalog.*/equipment.* CLASSES from the passed catalog (separate reviewed classes),
// but lists inventory.stock and the audit/admin ids as EXACT literals -- so a FUTURE inventory.stock.*
// capability is NOT auto-exempted. Broadening the inventory.stock exception back to a prefix here would
// make the A3-inv regression fail (its synthetic future id would become deferred instead of unaccounted).
const SEEDED_GRANTED_IDS = new Set([
  ...ADMIN_ROLE.permissions,
  ...DISPATCHER_ROLE.permissions,
  ...TECHNICIAN_ROLE.permissions,
]);
function buildDeferredForNow(catalog) {
  // report.* (D-226 catalog-only), inventory.catalog.* (INV-1 Phase 1 PR 1.2 / ADR-008 Decision #40),
  // and equipment.* (D4, `active: false`) are ungranted-by-design CLASSES. The audit/admin/inventory.stock
  // ids are individually named EXACT exceptions (never prefix-generated).
  return new Set([
    "audit.event.read",
    ...catalog.filter((p) => p.id.startsWith("report.")).map((p) => p.id),
    ...catalog.filter((p) => p.id.startsWith("inventory.catalog.")).map((p) => p.id),
    ...catalog.filter((p) => p.id.startsWith("equipment.")).map((p) => p.id),
    // NOTE: inventory.stock.receive is NO LONGER deferred -- the Capability Grant Gate granted it to the
    // ADMIN + DISPATCHER compatibility Roles, so it is now accounted-for via SEEDED_GRANTED_IDS (derived
    // from those roles), NOT via this deferred set. A future inventory.stock.* stays UNACCOUNTED (A3-inv).
    // AUTH-PR-3.5 (DECISIONS #56): registered `active: false`, granted to NO Role.
    "admin.credentialReset.initiate",
    // WO Parts Planning Phase 2: workOrder.parts.plan is registered `active: false` and granted to NO
    // compatibility Role -- ungranted-by-design, pending a separate Owner grant. Named as an EXACT literal
    // (not a prefix), so a future workOrder.parts.* capability stays UNACCOUNTED until reviewed.
    "workOrder.parts.plan",
    // Sales/Fulfillment/Finance spine (opportunity.*, salesOrder.*, finance.*):
    // NO LONGER deferred as of Phase 6a (per-environment-capability-activation
    // spec, 2026-08-14). All 11 spine ids are now GRANTED to compatibility Roles
    // (operational 6 -> admin + dispatcher via the shared base; finance 5 ->
    // admin; owner inherits admin), so they are accounted-for via
    // SEEDED_GRANTED_IDS, exactly like inventory.stock.receive above -- NOT via
    // this deferred set. They remain registered `active: false`, so they are
    // still DENIED everywhere the per-environment activation override is off
    // (production, role-keyed) -- grant is not activation. A FUTURE
    // opportunity.*/salesOrder.*/finance.* capability stays UNACCOUNTED (these
    // were EXACT literals, never prefixes), which the A3-inv gate protects.
    // Commercial Coverage & Territory (#15): coverage.write -- ungranted-by-design (Admin-SDK-only), EXACT literal.
    "coverage.write",
    // Commercial Coverage & Territory (#15): coverage.read -- ungranted-by-design (trusted backend resolve), EXACT literal.
    "coverage.read",
    // Serialized Asset registry, Spec phase M.1 (docs/specifications/serialized-asset-equipment-installation.md
    // §I / §M.1): inventory.serializedAsset.read -- registered `active: false`, granted to NO compatibility
    // Role by this phase. EXACT literal (not a prefix), so a future inventory.serializedAsset.* capability
    // stays UNACCOUNTED until separately reviewed (same protection the A3-inv gate applies elsewhere).
    "inventory.serializedAsset.read",
    // CRM Activity (Wave 7 extension Part 1.4): crm.activity.create / crm.activity.read --
    // registered `active: false` and granted to NO compatibility Role, pending a separate Owner
    // grant. EXACT literals, never a "crm.activity." prefix, so a future crm.activity.* capability
    // stays UNACCOUNTED until separately reviewed -- the same protection A3-inv applies elsewhere.
    "crm.activity.create",
    "crm.activity.read",
    // Coordinated Operations fidelity fix (2026-08-15): fulfillment.coordinatedVisit.read -- registered
    // `active: false`, granted to NO compatibility Role by this phase. EXACT literal (not a prefix), so a
    // future fulfillment.coordinatedVisit.* or fulfillment.* capability stays UNACCOUNTED until separately
    // reviewed -- the same protection A3-inv applies elsewhere.
    "fulfillment.coordinatedVisit.read",
  ]);
}
// Catalog ids neither granted by a seeded Role nor deferred-by-design (the exhaustiveness gate's
// "unaccounted" set). A3 requires this empty; A3-inv requires a synthetic future id to appear in it.
function unaccountedIds(catalog) {
  const deferred = buildDeferredForNow(catalog);
  return catalog.filter((p) => !deferred.has(p.id) && !SEEDED_GRANTED_IDS.has(p.id)).map((p) => p.id);
}

// --- A3: every catalog id is accounted for by a seeded Role or is deferred-by-design ---
check("A3: every Permission id is granted by at least one compatibility Role, or is deferred-by-design (audit.event.read, report.*, inventory.catalog.*, equipment.*, admin.credentialReset.initiate) -- inventory.stock.receive is now GRANTED (admin + dispatcher direct; owner inherited), not deferred", () => {
  assert.deepEqual(unaccountedIds(PERMISSION_CATALOG), [], "every catalog id must be granted or explicitly deferred-by-design");
});

// --- A3-inv: the inventory.stock exception is EXACT -- a synthetic future inventory.stock.* is caught by
// the SAME accounting A3 uses (broadening the shared exception to inventory.stock.* would make this fail) ---
check("A3-inv: a synthetic future inventory.stock.* capability is reported UNACCOUNTED by the real A3 accounting", () => {
  // Sanity: today exactly one inventory.stock.* exists (the reviewed one).
  assert.deepEqual(PERMISSION_CATALOG.filter((p) => p.id.startsWith("inventory.stock.")).map((p) => p.id).sort(), ["inventory.stock.receive"]);
  // Run an AUGMENTED catalog (with a future capability) through the SAME accounting the real A3 uses:
  const synthetic = Object.freeze({ id: "inventory.stock.transferOut", description: "synthetic future capability", resource: "inventory.stock", action: "transferOut" });
  const augmented = [...PERMISSION_CATALOG, synthetic];
  const unaccounted = unaccountedIds(augmented);
  assert.equal(unaccounted.includes("inventory.stock.transferOut"), true,
    "a future inventory.stock.* must be reported UNACCOUNTED until separately enumerated (broadening the exact exception to inventory.stock.* would make this fail)");
  // The reviewed capability remains accounted-for -- now via GRANT (admin/dispatcher), not deferral --
  // i.e. NOT reported unaccounted.
  assert.equal(unaccounted.includes("inventory.stock.receive"), false);
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
check("S1: a version bump does not revoke an older active assignment (accessVersionAtGrant <= current) -> ALLOW", () => {
  const result = resolveEffectivePermission({
    permissionId: "account.record.read",
    assignments: [activeAssignment("admin", { accessVersionAtGrant: 1 })],
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 5,
    target: baseTarget(),
  });
  assert.equal(result.decision, "ALLOW");
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

// ---------------------------------------------------------------------------
// Per-environment capability activation override (spec 2026-08-14). These lock
// the resolver-layer contract: the OPTIONAL activationOverrides set lifts ONLY
// the blanket active:false deny, and NEVER substitutes for a qualifying grant.
// ---------------------------------------------------------------------------

// A synthetic active:false capability + a role that grants it, so these tests do
// not depend on which real spine ids happen to be active:false (they all are).
const INACTIVE_ID = "spine.synthetic.inactive";
function rolesGranting(id) {
  return { syntheticSpine: { id: "syntheticSpine", permissions: [id] } };
}
// Force findPermission to see INACTIVE_ID as registered+inactive by using a real
// catalog id that is active:false. opportunity.write is registered active:false.
const REAL_INACTIVE_ID = "opportunity.write";

check("override ABSENT: a registered active:false capability still denies inactivePermission", () => {
  const result = resolveEffectivePermission({
    permissionId: REAL_INACTIVE_ID,
    assignments: [activeAssignment("syntheticSpine")],
    roles: { syntheticSpine: { id: "syntheticSpine", permissions: [REAL_INACTIVE_ID] } },
    currentAccessVersion: 1,
    target: baseTarget(),
    // activationOverrides omitted -> strict no-op (today's behavior)
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "inactivePermission");
});

check("override PRESENT but NO qualifying grant: denies noQualifyingGrant, NOT allow", () => {
  const result = resolveEffectivePermission({
    permissionId: REAL_INACTIVE_ID,
    assignments: [], // override lifts active gate, but there is no grant
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: 1,
    target: baseTarget(),
    activationOverrides: new Set([REAL_INACTIVE_ID]),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(
    result.reason,
    "noQualifyingGrant",
    "activation alone must never grant -- a qualifying Role is still required",
  );
});

check("override PRESENT AND a qualifying grant: ALLOW (activation + authorization both satisfied)", () => {
  const result = resolveEffectivePermission({
    permissionId: REAL_INACTIVE_ID,
    assignments: [activeAssignment("syntheticSpine")],
    roles: { syntheticSpine: { id: "syntheticSpine", permissions: [REAL_INACTIVE_ID] } },
    currentAccessVersion: 1,
    target: baseTarget(),
    activationOverrides: new Set([REAL_INACTIVE_ID]),
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.reason, "qualifyingGrant");
});

check("override for a DIFFERENT id does not lift THIS id's active:false deny", () => {
  const result = resolveEffectivePermission({
    permissionId: REAL_INACTIVE_ID,
    assignments: [activeAssignment("syntheticSpine")],
    roles: { syntheticSpine: { id: "syntheticSpine", permissions: [REAL_INACTIVE_ID] } },
    currentAccessVersion: 1,
    target: baseTarget(),
    activationOverrides: new Set(["salesOrder.fulfill"]), // not REAL_INACTIVE_ID
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "inactivePermission");
});

check("override never rescues an UNKNOWN permission id", () => {
  const result = resolveEffectivePermission({
    permissionId: "totally.unregistered.id",
    assignments: [activeAssignment("syntheticSpine")],
    roles: rolesGranting("totally.unregistered.id"),
    currentAccessVersion: 1,
    target: baseTarget(),
    activationOverrides: new Set(["totally.unregistered.id"]),
  });
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "unknownPermission");
});

void INACTIVE_ID;

// ---------------------------------------------------------------------------
// Phase 6a -- Sales/Fulfillment/Finance spine ROLE GRANTS (spec 2026-08-14).
// owner/admin = full 13; dispatcher = 8 operational only; technician = 0.
// (salesOrder.read added 2026-08-15, Owner-ratified, same operational grant shape
// as the other 3 operational Sales ids -- see permissionCatalog.ts's entry.
// inventory.catalog.read added 2026-08-15, Wave 6 Owner Decision -- same operational
// admin+dispatcher grant shape, see manufacturerReadService.ts.)
// Every ALLOW here also passes an activationOverrides set (the sandbox posture);
// the final test proves the production posture (grant without activation = DENY).
// ---------------------------------------------------------------------------
const SPINE_OPERATIONAL = [
  "opportunity.write",
  "opportunity.read",
  "opportunity.createSalesOrder",
  "salesOrder.read",
  "salesOrder.write",
  "salesOrder.fulfill",
  "salesOrder.service",
  "inventory.catalog.read",
];
const SPINE_FINANCE = [
  "finance.invoice.issue",
  "finance.payment.apply",
  "finance.adjustment.record",
  "finance.refund.record",
  "finance.read",
];
const SPINE_ALL = [...SPINE_OPERATIONAL, ...SPINE_FINANCE];
const SPINE_ACTIVATION = new Set(SPINE_ALL);

function resolveWithActivation(roleId, permissionId, roles = COMPATIBILITY_ROLES) {
  return resolveEffectivePermission({
    permissionId,
    assignments: [activeAssignment(roleId)],
    roles,
    currentAccessVersion: 1,
    target: baseTarget(),
    activationOverrides: SPINE_ACTIVATION,
  });
}

check("Phase 6a: admin ALLOWs the FULL spine (all 13) under sandbox activation", () => {
  for (const id of SPINE_ALL) {
    const r = resolveWithActivation("admin", id);
    assert.equal(r.decision, "ALLOW", `admin should ALLOW ${id}: got ${r.reason}`);
  }
});

check("Phase 6a: owner ALLOWs the FULL spine (all 13) under activation (inherits admin)", () => {
  const roles = { ...COMPATIBILITY_ROLES, owner: OWNER_ROLE };
  for (const id of SPINE_ALL) {
    assert.equal(resolveWithActivation("owner", id, roles).decision, "ALLOW", `owner should ALLOW ${id}`);
  }
});

check("Phase 6a: dispatcher ALLOWs the 8 OPERATIONAL spine ids under activation", () => {
  for (const id of SPINE_OPERATIONAL) {
    assert.equal(resolveWithActivation("dispatcher", id).decision, "ALLOW", `dispatcher should ALLOW ${id}`);
  }
});

check("Phase 6a: dispatcher DENYs all 5 FINANCE spine ids under activation (least-privilege, noQualifyingGrant)", () => {
  for (const id of SPINE_FINANCE) {
    const r = resolveWithActivation("dispatcher", id);
    assert.equal(r.decision, "DENY", `dispatcher must DENY ${id}`);
    assert.equal(r.reason, "noQualifyingGrant", `dispatcher DENY of ${id} must be noQualifyingGrant (has no such grant), not inactivePermission`);
  }
});

check("Phase 6a: technician DENYs EVERY spine id under activation (holds no spine grant)", () => {
  for (const id of SPINE_ALL) {
    const r = resolveWithActivation("technician", id);
    assert.equal(r.decision, "DENY", `technician must DENY ${id}`);
    assert.equal(r.reason, "noQualifyingGrant", `technician DENY of ${id} must be noQualifyingGrant`);
  }
});

check("Phase 6a PRODUCTION POSTURE: WITHOUT activation, admin STILL DENYs the spine (grant != activation) -- inactivePermission, not ALLOW", () => {
  // The load-bearing safety property. admin now GRANTS finance.invoice.issue,
  // but with NO activationOverrides (production: role-keyed off) the active:false
  // gate stands ahead of the grant -> inactivePermission DENY. This is why the
  // grant is safe to ship globally.
  for (const id of SPINE_ALL) {
    const r = resolveEffectivePermission({
      permissionId: id,
      assignments: [activeAssignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: baseTarget(),
    });
    assert.equal(r.decision, "DENY", `${id} must DENY without activation`);
    assert.equal(r.reason, "inactivePermission", `${id} must DENY as inactivePermission (active:false stands ahead of the grant)`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
