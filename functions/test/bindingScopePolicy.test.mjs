// R-32 (#152) -- the per-binding assignment-scope policy, and the Reorder authority that is its
// first consumer. PURE: no emulator, no Firestore, no clock. The Reorder half uses a hand-built
// fake `db` so the authority's real read shape is exercised without a live backend.
//
// WHAT THESE PROTECT, stated so a future editor cannot weaken them by accident:
//   - absent policy must mean pre-R-32 behaviour EXACTLY (the compatibility contract)
//   - the same PermissionId may be global on one Role and location-only on another
//   - a PRE-EXISTING global manager assignment cannot confer a location-restricted binding
//     (resolution-time enforcement -- the reason grant-time alone is insufficient)
//   - `employees.assignedWarehouseIds` can no longer authorize a Function
import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectivePermission } from "../lib/access/resolveEffectivePermission.js";
import {
  bindingAllowsAssignmentScope,
  roleHasAnyBindingAtAssignmentScope,
} from "../lib/access/bindingScopePolicy.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import {
  loadReorderWarehouseAuthority,
  REORDER_WAREHOUSE_AUTHORITY_REASON,
} from "../lib/reorderRequest/reorderWarehouseAuthority.js";
import { projectReorderWarehouseOptions } from "../lib/reorderRequest/reorderCallables.js";

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const CREATE = "reorder.request.create.manual";
const CATALOG = "inventory.catalog.read";
const TXN = "inventory.transaction.read";

// Every spine id is registered active:false; activate the ones under test the way the sandbox
// runtime does, so a DENY in these tests is never merely an activation artefact.
const ACTIVATION = new Set([CATALOG, TXN, "salesOrder.read", "workOrder.create", "inventory.balance.read"]);

const grantedAt = { toMillis: () => 0 };
const assign = (roleId, scope) => ({
  id: `a:${roleId}:${scope.type}${scope.value ? `:${scope.value}` : ""}`,
  principalUid: "p1",
  roleId,
  scope,
  grantedBy: "test",
  grantedAt,
  status: "active",
  accessVersionAtGrant: 1,
});
const globalTarget = () => ({ scope: { type: "global" }, condition: {} });
const atWarehouse = (id) => ({ scope: { type: "location", value: id }, condition: {} });

function decide(permissionId, assignments, target) {
  return resolveEffectivePermission({
    permissionId,
    assignments,
    roles: ROLES,
    currentAccessVersion: 1,
    target,
    activationOverrides: ACTIVATION,
  }).decision;
}

// ---------------------------------------------------------------------------
// A. POLICY DEFAULT -- absent scopesByPermission is pre-R-32 behaviour, exactly
// ---------------------------------------------------------------------------
test("A: a Role declaring no scopesByPermission is unaffected by R-32", () => {
  for (const [roleId, role] of Object.entries(ROLES)) {
    if (role.scopesByPermission) continue;
    for (const permissionId of role.permissions) {
      assert.equal(
        bindingAllowsAssignmentScope(role, permissionId, "global"),
        true,
        `${roleId}/${permissionId} must stay unrestricted`,
      );
      assert.equal(bindingAllowsAssignmentScope(role, permissionId, "location"), true);
    }
  }
});

test("A: exactly two Roles declare a policy, and only over the bindings R-32 named", () => {
  const declaring = Object.entries(ROLES).filter(([, r]) => r.scopesByPermission);
  assert.deepEqual(declaring.map(([id]) => id).sort(), ["partsManager", "warehouseManager"]);
  for (const [, role] of declaring) {
    assert.deepEqual(Object.keys(role.scopesByPermission).sort(), [TXN, CREATE].sort());
    // R-32 section 6 is explicit that global reference-data reads are NOT location-required.
    assert.equal(role.scopesByPermission[CATALOG], undefined);
    // and the two Reorder capabilities whose runtime enforcement is unresolved stay undeclared
    assert.equal(role.scopesByPermission["reorder.request.read.queue"], undefined);
    assert.equal(role.scopesByPermission["reorder.request.assign"], undefined);
  }
});

// ---------------------------------------------------------------------------
// B. BINDING POLICY -- permitted qualifies, forbidden is rejected
// ---------------------------------------------------------------------------
test("B: a declared binding accepts only the listed assignment scope types", () => {
  const pm = ROLES.partsManager;
  assert.equal(bindingAllowsAssignmentScope(pm, CREATE, "location"), true);
  assert.equal(bindingAllowsAssignmentScope(pm, CREATE, "global"), false);
  assert.equal(bindingAllowsAssignmentScope(pm, CREATE, "domain"), false);
  assert.equal(bindingAllowsAssignmentScope(pm, CREATE, "ownAssignment"), false);
  // an undeclared binding on the SAME Role stays unrestricted
  assert.equal(bindingAllowsAssignmentScope(pm, CATALOG, "global"), true);
});

test("B: malformed or hostile inputs deny rather than throw", () => {
  assert.equal(bindingAllowsAssignmentScope(null, CREATE, "global"), false);
  assert.equal(bindingAllowsAssignmentScope(ROLES.partsManager, "", "global"), false);
  assert.equal(bindingAllowsAssignmentScope(ROLES.partsManager, CREATE, undefined), false);
  assert.equal(bindingAllowsAssignmentScope({ permissions: [], scopesByPermission: { x: "location" } }, "x", "location"), false);
  assert.equal(bindingAllowsAssignmentScope({ permissions: [], scopesByPermission: { x: [] } }, "x", "location"), false);
});

// ---------------------------------------------------------------------------
// C. SAME PERMISSION, DIFFERENT ROLE POLICY -- the point of per-binding scope
// ---------------------------------------------------------------------------
test("C: admin and dispatcher keep GLOBAL authority over a location target (R-32 section 9)", () => {
  for (const roleId of ["admin", "dispatcher"]) {
    assert.equal(decide(CREATE, [assign(roleId, { type: "global" })], atWarehouse("wh-main")), "ALLOW");
    assert.equal(decide(CREATE, [assign(roleId, { type: "global" })], atWarehouse("wh-north")), "ALLOW");
    assert.equal(decide(CREATE, [assign(roleId, { type: "global" })], globalTarget()), "ALLOW");
  }
});

test("C: a manager's SAME capability is refused from global and allowed only at its warehouse", () => {
  for (const roleId of ["partsManager", "warehouseManager"]) {
    // the bypass R-30 named, closed
    assert.equal(decide(CREATE, [assign(roleId, { type: "global" })], atWarehouse("wh-main")), "DENY");
    assert.equal(
      decide(CREATE, [assign(roleId, { type: "location", value: "wh-main" })], atWarehouse("wh-main")),
      "ALLOW",
    );
    assert.equal(
      decide(CREATE, [assign(roleId, { type: "location", value: "wh-main" })], atWarehouse("wh-north")),
      "DENY",
    );
  }
});

// ---------------------------------------------------------------------------
// D. MIXED ROLE -- global and location assignments COMPOSE, they do not replace
// ---------------------------------------------------------------------------
test("D: partsManager@global + partsManager@location:wh-main both work, each where it should", () => {
  const both = [
    assign("partsManager", { type: "global" }),
    assign("partsManager", { type: "location", value: "wh-main" }),
  ];
  // the global-capable binding still resolves through the GLOBAL assignment
  assert.equal(decide(CATALOG, both, globalTarget()), "ALLOW");
  // the location-restricted binding resolves through the LOCATION assignment
  assert.equal(decide(CREATE, both, atWarehouse("wh-main")), "ALLOW");
  // and not at a warehouse neither assignment names
  assert.equal(decide(CREATE, both, atWarehouse("wh-north")), "DENY");
});

test("D: holding ONLY a location assignment does not silently strip the global-capable bindings", () => {
  const locationOnly = [assign("partsManager", { type: "location", value: "wh-main" })];
  // against a location target the whole Role still resolves -- the undeclared bindings included
  assert.equal(decide(CATALOG, locationOnly, atWarehouse("wh-main")), "ALLOW");
  // against a GLOBAL target it confers nothing, which is scopeMatches() and NOT the new policy:
  // that is pre-existing behaviour R-32 did not change, and is why the global assignment above
  // remains necessary rather than optional.
  assert.equal(decide(CATALOG, locationOnly, globalTarget()), "DENY");
});

// ---------------------------------------------------------------------------
// E. PRE-EXISTING BAD ASSIGNMENT -- resolution-time, not just grant-time
// ---------------------------------------------------------------------------
test("E: a partsManager@global assignment written BEFORE R-32 cannot confer the location binding", () => {
  // Deliberately shaped as an already-stored document: no grant-time check ever saw it.
  const preExisting = {
    id: "legacy-assignment-written-in-2026-08",
    principalUid: "p1",
    roleId: "partsManager",
    scope: { type: "global" },
    grantedBy: "someone",
    grantedAt,
    status: "active",
    accessVersionAtGrant: 1,
  };
  assert.equal(decide(CREATE, [preExisting], atWarehouse("wh-main")), "DENY");
  assert.equal(decide(CREATE, [preExisting], globalTarget()), "DENY");
  // it still confers everything R-32 did not restrict -- this is a bounded correction, not a purge
  assert.equal(decide(CATALOG, [preExisting], globalTarget()), "ALLOW");
});

// ---------------------------------------------------------------------------
// F(part) / G. CAPABILITY HOME -- the split brain, closed
// ---------------------------------------------------------------------------
const SIX = [
  CREATE,
  "reorder.request.read.queue",
  "reorder.request.assign",
  TXN,
  "inventory.action.read",
  CATALOG,
];

test("G: technician carries none of the six, and cannot reach them via any operational role", () => {
  for (const permissionId of SIX) {
    assert.equal(COMPATIBILITY_ROLES.technician.permissions.includes(permissionId), false, permissionId);
    assert.equal(COMPATIBILITY_ROLES.technician.conditionsByPermission?.[permissionId], undefined, permissionId);
    const target = { scope: { type: "global" }, condition: { operationalRoleActive: () => true } };
    assert.equal(decide(permissionId, [assign("technician", { type: "global" })], target), "DENY", permissionId);
  }
});

test("G: each of the six now sits on the governed Role its old condition named, and nowhere new", () => {
  const expected = {
    [CREATE]: ["partsManager", "warehouseManager"],
    "reorder.request.read.queue": ["partsManager"],
    "reorder.request.assign": ["partsManager"],
    [TXN]: ["partsManager", "warehouseManager"],
    "inventory.action.read": ["warehouseManager"],
    [CATALOG]: ["partsManager", "warehouseManager"],
  };
  for (const [permissionId, roleIds] of Object.entries(expected)) {
    for (const roleId of roleIds) {
      assert.equal(ROLES[roleId].permissions.includes(permissionId), true, `${roleId} must carry ${permissionId}`);
    }
  }
  // inventory.action.read was WAREHOUSE_MANAGER-only and must NOT have leaked to partsManager
  assert.equal(ROLES.partsManager.permissions.includes("inventory.action.read"), false);
  // reorder read.queue/assign were PARTS_MANAGER-only and must NOT have leaked to warehouseManager
  assert.equal(ROLES.warehouseManager.permissions.includes("reorder.request.read.queue"), false);
  assert.equal(ROLES.warehouseManager.permissions.includes("reorder.request.assign"), false);
});

test("G: a plain technician gains no manager authority even holding the compatibility Role", () => {
  const plain = [assign("technician", { type: "global" })];
  const asAssociate = { scope: { type: "global" }, condition: { operationalRoleActive: (r) => r === "PARTS_ASSOCIATE" } };
  // what a technician legitimately keeps
  assert.equal(decide("reorder.request.read.own", plain, asAssociate), "ALLOW");
  assert.equal(decide("workOrder.transition", plain, globalTarget()), "ALLOW");
  // and what it may no longer reach
  for (const permissionId of SIX) assert.equal(decide(permissionId, plain, asAssociate), "DENY", permissionId);
});

// ---------------------------------------------------------------------------
// F. GRANT-TIME helper semantics (the emulator-backed grantRole path is covered
//    in trustedWriterCommands.test.mjs; this pins the shared opinion it consumes)
// ---------------------------------------------------------------------------
test("F: a mixed Role is grantable at BOTH scopes -- some, never every", () => {
  for (const roleId of ["partsManager", "warehouseManager"]) {
    assert.equal(roleHasAnyBindingAtAssignmentScope(ROLES[roleId], "location"), true);
    // still true at global, because the eleven undeclared bindings remain global-capable --
    // this is what keeps the two assignments composable rather than mutually exclusive
    assert.equal(roleHasAnyBindingAtAssignmentScope(ROLES[roleId], "global"), true);
  }
});

test("F: a Role whose every binding forbids the requested scope is refusable", () => {
  const locked = { id: "locked", name: "L", description: "", permissions: ["a", "b"], scopesByPermission: { a: ["location"], b: ["location"] } };
  assert.equal(roleHasAnyBindingAtAssignmentScope(locked, "location"), true);
  assert.equal(roleHasAnyBindingAtAssignmentScope(locked, "global"), false);
  assert.equal(roleHasAnyBindingAtAssignmentScope(null, "global"), false);
});

// ---------------------------------------------------------------------------
// H / I / J / K / L -- the Reorder consumer, against a fake Firestore
// ---------------------------------------------------------------------------
function fakeDb({ user, assignments = [], employee = null }) {
  const snap = (exists, data, id) => ({ exists, id, data: () => data });
  return {
    collection(name) {
      return {
        doc(id) {
          if (name === "users") return { get: async () => snap(user !== null, user, id) };
          if (name === "employees") return { get: async () => snap(employee !== null, employee, id) };
          throw new Error(`unexpected doc read: ${name}/${id}`);
        },
        where() {
          return {
            where: () => ({
              get: async () => ({ docs: assignments.map((a) => ({ id: a.id, data: () => a })) }),
            }),
          };
        },
        // A collection-wide get must never be issued by the AUTHORITY -- only by the option
        // reader, which this fake is not standing in for.
        get: async () => {
          throw new Error("loadReorderWarehouseAuthority must not read a whole collection");
        },
      };
    },
  };
}

const WAREHOUSES = [
  { id: "wh-main", data: { id: "wh-main", name: "Main", status: "ACTIVE", operatingCompanyId: "taylor" } },
  { id: "wh-north", data: { id: "wh-north", name: "North", status: "ACTIVE", operatingCompanyId: "taylor" } },
  { id: "wh-retired", data: { id: "wh-retired", name: "Retired", status: "INACTIVE", operatingCompanyId: "taylor" } },
];
const governedOk = (data) => ({ valid: true, value: { status: data.status } });

test("H: a manager scoped to wh-main is offered wh-main and no other warehouse", async () => {
  const db = fakeDb({
    user: { role: "technician", employeeId: "e1", accessVersion: 1 },
    assignments: [assign("partsManager", { type: "location", value: "wh-main" })],
    employee: { userId: "p1", employmentStatus: "ACTIVE", operationalRoles: ["PARTS_MANAGER"] },
  });
  const authority = await loadReorderWarehouseAuthority(db, "p1", CREATE);
  const options = projectReorderWarehouseOptions(authority, WAREHOUSES, { validateGoverned: governedOk });
  assert.deepEqual(options.map((o) => o.warehouseId), ["wh-main"]);
});

test("H: admin sees every eligible ACTIVE governed warehouse, and never the INACTIVE one", async () => {
  const db = fakeDb({
    user: { role: "admin", employeeId: null, accessVersion: 1 },
    assignments: [assign("admin", { type: "global" })],
  });
  const authority = await loadReorderWarehouseAuthority(db, "p1", CREATE);
  const options = projectReorderWarehouseOptions(authority, WAREHOUSES, { validateGoverned: governedOk });
  assert.deepEqual(options.map((o) => o.warehouseId), ["wh-main", "wh-north"]);
  assert.equal(options.some((o) => o.warehouseId === "wh-retired"), false);
});

test("I/J: LIST and CREATE agree for every candidate -- offered == create-authorized", async () => {
  for (const [label, setup] of [
    ["scoped manager", {
      user: { role: "technician", employeeId: "e1", accessVersion: 1 },
      assignments: [assign("warehouseManager", { type: "location", value: "wh-north" })],
      employee: { userId: "p1", employmentStatus: "ACTIVE", operationalRoles: ["WAREHOUSE_MANAGER"] },
    }],
    ["admin", { user: { role: "admin", accessVersion: 1 }, assignments: [assign("admin", { type: "global" })] }],
    ["unauthorized", { user: { role: "technician", accessVersion: 1 }, assignments: [] }],
  ]) {
    const authority = await loadReorderWarehouseAuthority(fakeDb(setup), "p1", CREATE);
    const offered = new Set(
      projectReorderWarehouseOptions(authority, WAREHOUSES, { validateGoverned: governedOk }).map((o) => o.warehouseId),
    );
    for (const w of WAREHOUSES) {
      const createAuthorized = authority.allows(w.id);
      if (offered.has(w.id)) {
        assert.equal(createAuthorized, true, `${label}: offered ${w.id} must be create-authorized`);
      }
      // the converse is bounded by the governed/ACTIVE/company filter, never by authorization:
      // an authorized-but-ineligible warehouse (wh-retired) is withheld from BOTH.
      if (w.id === "wh-retired") assert.equal(offered.has(w.id), false, `${label}: wh-retired is never offered`);
    }
  }
});

test("I: a scoped manager is refused a warehouse outside their assignment", async () => {
  const db = fakeDb({
    user: { role: "technician", employeeId: "e1", accessVersion: 1 },
    assignments: [assign("partsManager", { type: "location", value: "wh-main" })],
    employee: { userId: "p1", employmentStatus: "ACTIVE", operationalRoles: ["PARTS_MANAGER"] },
  });
  const authority = await loadReorderWarehouseAuthority(db, "p1", CREATE);
  assert.equal(authority.allows("wh-main"), true);
  assert.equal(authority.allows("wh-north"), false);
  assert.equal(authority.allows(""), false);
  assert.equal(authority.allows(undefined), false);
});

// ---------------------------------------------------------------------------
// L. THE RETIREMENT PROOF -- assignedWarehouseIds can no longer authorize
// ---------------------------------------------------------------------------
test("L: assignedWarehouseIds alone authorizes NOTHING once the RoleAssignment is absent", async () => {
  const db = fakeDb({
    user: { role: "technician", employeeId: "e1", accessVersion: 1 },
    // Exactly the sandbox shape that used to succeed: an ACTIVE, reciprocally-linked
    // WAREHOUSE_MANAGER carrying wh-main in assignedWarehouseIds...
    employee: {
      userId: "p1",
      employmentStatus: "ACTIVE",
      operationalRoles: ["WAREHOUSE_MANAGER"],
      assignedWarehouseIds: ["wh-main"],
    },
    // ...and no qualifying RoleAssignment at all.
    assignments: [],
  });
  const authority = await loadReorderWarehouseAuthority(db, "p1", CREATE);
  assert.equal(authority.allows("wh-main"), false);
  const options = projectReorderWarehouseOptions(authority, WAREHOUSES, { validateGoverned: governedOk });
  assert.deepEqual(options, []);
});

test("L: a global manager assignment does not resurrect the old field's authority either", async () => {
  const db = fakeDb({
    user: { role: "technician", employeeId: "e1", accessVersion: 1 },
    employee: {
      userId: "p1",
      employmentStatus: "ACTIVE",
      operationalRoles: ["WAREHOUSE_MANAGER"],
      assignedWarehouseIds: ["wh-main"],
    },
    assignments: [assign("warehouseManager", { type: "global" })],
  });
  const authority = await loadReorderWarehouseAuthority(db, "p1", CREATE);
  assert.equal(authority.allows("wh-main"), false);
});

test("fail-closed: a read error yields an authority that allows nothing, and says so", async () => {
  const exploding = {
    collection() {
      return { doc: () => ({ get: async () => { throw new Error("backend down"); } }), where: () => ({ where: () => ({ get: async () => { throw new Error("backend down"); } }) }) };
    },
  };
  const authority = await loadReorderWarehouseAuthority(exploding, "p1", CREATE);
  assert.equal(authority.allows("wh-main"), false);
  assert.equal(authority.reason, REORDER_WAREHOUSE_AUTHORITY_REASON.AUTHORITY_UNRESOLVED);
});

// ---------------------------------------------------------------------------
// THE DEFECT LIVE PROOF CAUGHT, AND THE TESTS DID NOT
// ---------------------------------------------------------------------------
// Every test above exercises loadReorderWarehouseAuthority DIRECTLY. None of them went through the
// callable's own entry sequence, and that is precisely where the bug was: both reorder callables
// opened with a `requireCapability` that resolves through the effective-access feed, which builds a
// GLOBAL TargetContext by construction. A location-scoped assignment can never match a global
// target, so `warehouseManager @ location:wh-main` was refused 403 BEFORE the location authority
// ran -- the exact principal R-32 exists to serve.
//
// Two guards, because one alone is weak:
//   1. the behavioural asymmetry that made the gate wrong (global DENY, location ALLOW)
//   2. a static guard, so reinstating the gate FAILS rather than silently re-denying managers
test("DEFECT GUARD: the manager whose location grant works is DENIED by a global-target evaluation", () => {
  const a = [assign("warehouseManager", { type: "location", value: "wh-main" })];
  // What the removed gate asked -- and would still answer -- for this principal:
  assert.equal(decide(CREATE, a, globalTarget()), "DENY");
  // What the authority the callables now use answers for the same principal:
  assert.equal(decide(CREATE, a, atWarehouse("wh-main")), "ALLOW");
  // So any global-target precondition in front of the location authority is unsatisfiable for
  // every location-scoped manager. That is the defect, stated as an assertion.
});

test("DEFECT GUARD: neither reorder callable gates create.manual on a global target", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../src/reorderRequest/reorderCallables.ts", import.meta.url),
    "utf8",
  );
  // recordReorderPurchaseOrder legitimately keeps its gate: its capability carries no location
  // binding, so a global target is the correct question for it. Exactly one gate may remain.
  const gates = src.match(/await requireCapability\(/g) ?? [];
  assert.equal(gates.length, 1, "only recordReorderPurchaseOrder may gate on a global capability check");
  assert.equal(
    src.includes("await requireCapability(request.auth.uid, REORDER_CREATE_MANUAL_CAPABILITY)"),
    false,
    "reinstating a global-target gate on create.manual re-breaks every location-scoped manager",
  );
  assert.equal(
    src.includes("await requireCapability(request.auth.uid, REORDER_RECORD_PO_CAPABILITY)"),
    true,
    "recordReorderPurchaseOrder must keep its gate",
  );
});
