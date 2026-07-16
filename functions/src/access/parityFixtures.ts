// Enterprise Access & Administration Platform (Issue #226) -- parity
// fixtures for the shadow-mode comparison harness. Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md §18/
// §21 (P1-P3) and sequenced by docs/implementation-plans/enterprise-
// access-and-administration-platform.md (Row 4 / Task 9).
//
// Every fixture's `legacyDecision` is the seeded-compatibility oracle
// (Spec §7) -- what today's production Rules/security-role matrix
// ALREADY does, sourced from the Assessment's current-state matrix +
// Inventory domain audit table (the same ground truth
// compatibilityRoles.ts was built from). This does not duplicate the
// Issue #100 driver.mjs browser-verification fixtures (those exercise
// the real UI + emulator end to end); these are pure in-memory
// resolver-parity fixtures, covering every persona/operational-role
// combo plus the inactive-employment/broken-linkage/governed-field
// edge cases Row 4 requires.
//
// PURE, dependency-free data module.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/access/parityFixtures.ts. If either
// file changes, change the other to match.
import type { Timestamp } from "firebase-admin/firestore";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import type { RoleAssignment } from "../types/access";
import type { ShadowComparisonInput } from "./shadowParityHarness";

// A minimal grantedAt stand-in -- fixtures never exercise the
// narrowest-Scope tie-break's real timestamp ordering (each fixture
// supplies exactly one assignment), so a fixed zero millis is enough.
const FIXTURE_GRANTED_AT = { toMillis: () => 0 } as unknown as Timestamp;

function assignment(roleId: string): RoleAssignment {
  return {
    id: `fixture-assignment-${roleId}`,
    principalUid: "fixture-principal",
    roleId,
    scope: { type: "global" },
    grantedBy: "fixture-seed",
    grantedAt: FIXTURE_GRANTED_AT,
    status: "active",
    accessVersionAtGrant: 1,
  };
}

function target(condition: Record<string, unknown> = {}) {
  return { scope: { type: "global" as const }, condition };
}

// operationalRoleActive predicates. `alwaysFalse` models BOTH inactive
// employment and a broken User<->Employee link -- from the resolver's
// point of view (and firestore.rules' own isActiveOperationalRole())
// they are indistinguishable: the caller-supplied predicate simply
// returns false, exactly as the real Rules helper would for either
// cause (Spec §13 fail-closed: no fallback branch distinguishes them).
const noOperationalRoleActive = () => false;
function onlyRole(role: string) {
  return (candidate: string) => candidate === role;
}

export const PARITY_FIXTURES: readonly ShadowComparisonInput[] = Object.freeze([
  // --- admin / dispatcher: Customer + Issue #175 governed field ---
  {
    fixtureLabel: "admin: governed field write",
    permissionId: "account.governedField.write",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "account.governedField.write",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: governed field write (Issue #175 withheld)",
    permissionId: "account.governedField.write",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "account.governedField.write",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: Customer record read",
    permissionId: "account.record.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "account.record.read",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },

  // --- Row 13 (Task 18): Customer/Account domain shadow migration --
  // completes the admin/dispatcher/technician x {read, create, update,
  // governedField.write} matrix (firestore.rules ~L1108-1128's `accounts`
  // match block: read/create/update all gate on isAdminOrDispatcher();
  // the separate governed-field nuance -- dispatcher may create/update only
  // at the governed baseline, admin may set any valid value -- is modeled
  // by the distinct account.governedField.write permission/Condition,
  // already covered above; account.record.create/update themselves are
  // unconditional admin/dispatcher grants in compatibilityRoles.ts's shared
  // base, matching the Rules' base isAdminOrDispatcher() gate exactly).
  // `delete` has no corresponding permission id -- firestore.rules denies it
  // unconditionally (`allow delete: if false`) for every role, so there is
  // nothing for the resolver to parity-check.
  {
    fixtureLabel: "admin: Customer record read",
    permissionId: "account.record.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "account.record.read",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "admin: Customer record create",
    permissionId: "account.record.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "account.record.create",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "admin: Customer record update",
    permissionId: "account.record.update",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "account.record.update",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: Customer record create",
    permissionId: "account.record.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "account.record.create",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: Customer record update",
    permissionId: "account.record.update",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "account.record.update",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician (no operational role): Customer record create",
    permissionId: "account.record.create",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "account.record.create",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician (no operational role): Customer record update",
    permissionId: "account.record.update",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "account.record.update",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician (no operational role): Customer governed field write",
    permissionId: "account.governedField.write",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "account.governedField.write",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },

  // --- admin / dispatcher: reorder approve/reject/cancel/void ---
  {
    fixtureLabel: "admin: reorder request approve",
    permissionId: "reorder.request.approve",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.approve",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request cancel",
    permissionId: "reorder.request.cancel",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.cancel",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    // firestore.rules (current `main`, ~L794-798) double-gates Void:
    // isAdminOrDispatcher() AND the caller is the request's own
    // recorded assignee -- even admin must be the assignee.
    fixtureLabel: "admin: reorder purchase order void (as the request's own assignee)",
    permissionId: "reorder.purchaseOrder.void",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.void",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ isOwnAssignment: true }),
    },
  },
  {
    fixtureLabel: "admin: reorder purchase order void DENIED when not the request's own assignee",
    permissionId: "reorder.purchaseOrder.void",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.void",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ isOwnAssignment: false }),
    },
  },

  // --- Row 14 (Task 19): Inventory/Reorder/Purchasing domain shadow
  // migration -- completes coverage of the remaining reorder.*/inventory.*
  // permission ids (permissionCatalog.ts). admin/dispatcher: both are
  // unconditional grants in compatibilityRoles.ts's shared base for every id
  // below (SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS), matching firestore.rules'
  // isAdminOrDispatcher() base gate. technician: TECHNICIAN_ROLE.permissions
  // grants each id only via its own operationalRoleActive Condition
  // (conditionsByPermission) -- three ids (create.system, reject,
  // inventory.action.create) are absent from technician's permissions list
  // entirely, so DENY is unconditional (no operational role can unlock them),
  // matching the Assessment's "no operational role gets Approve/Reject/
  // Cancel/Void" audit finding extended to these three as well. The
  // "wrong-role DENIES" behavior itself is already proven generically by the
  // existing PARTS_ASSOCIATE/INACTIVE-employment/broken-linkage fixtures
  // above/below, so it is not re-proven per id here -- each id gets exactly
  // one admin ALLOW, one dispatcher ALLOW, and (only where technician holds
  // any grant) one technician + correct-operational-role ALLOW.
  {
    fixtureLabel: "admin: reorder request read queue",
    permissionId: "reorder.request.read.queue",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.read.queue",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request read queue",
    permissionId: "reorder.request.read.queue",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.read.queue",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_MANAGER (active): reorder request read queue",
    permissionId: "reorder.request.read.queue",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.read.queue",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_MANAGER") }),
    },
  },
  {
    fixtureLabel: "admin: reorder request create (system)",
    permissionId: "reorder.request.create.system",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.create.system",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request create (system)",
    permissionId: "reorder.request.create.system",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.create.system",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    // No operational role unlocks this -- absent from TECHNICIAN_ROLE.permissions.
    fixtureLabel: "technician: reorder request create (system) -- no operational role grants this",
    permissionId: "reorder.request.create.system",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "reorder.request.create.system",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_MANAGER") }),
    },
  },
  {
    fixtureLabel: "admin: reorder request start purchasing",
    permissionId: "reorder.request.startPurchasing",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.startPurchasing",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request start purchasing",
    permissionId: "reorder.request.startPurchasing",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.startPurchasing",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): reorder request start purchasing",
    permissionId: "reorder.request.startPurchasing",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.startPurchasing",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE") }),
    },
  },
  {
    fixtureLabel: "admin: reorder request post-purchasing update",
    permissionId: "reorder.request.postPurchasingUpdate",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.postPurchasingUpdate",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request post-purchasing update",
    permissionId: "reorder.request.postPurchasingUpdate",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.postPurchasingUpdate",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): reorder request post-purchasing update",
    permissionId: "reorder.request.postPurchasingUpdate",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.postPurchasingUpdate",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE") }),
    },
  },
  {
    fixtureLabel: "admin: reorder request record purchase order",
    permissionId: "reorder.request.recordPurchaseOrder",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.recordPurchaseOrder",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request record purchase order",
    permissionId: "reorder.request.recordPurchaseOrder",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.recordPurchaseOrder",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): reorder request record purchase order",
    permissionId: "reorder.request.recordPurchaseOrder",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.recordPurchaseOrder",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE") }),
    },
  },
  {
    fixtureLabel: "admin: reorder request mark received",
    permissionId: "reorder.request.markReceived",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.markReceived",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request mark received",
    permissionId: "reorder.request.markReceived",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.markReceived",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): reorder request mark received",
    permissionId: "reorder.request.markReceived",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.markReceived",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE") }),
    },
  },
  {
    fixtureLabel: "admin: reorder request reject",
    permissionId: "reorder.request.reject",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.reject",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder request reject",
    permissionId: "reorder.request.reject",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.reject",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    // No operational role unlocks this -- absent from TECHNICIAN_ROLE.permissions.
    fixtureLabel: "technician: reorder request reject -- no operational role grants this",
    permissionId: "reorder.request.reject",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "reorder.request.reject",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_MANAGER") }),
    },
  },
  {
    fixtureLabel: "admin: reorder purchase order read",
    permissionId: "reorder.purchaseOrder.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.read",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder purchase order read",
    permissionId: "reorder.purchaseOrder.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.read",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): reorder purchase order read",
    permissionId: "reorder.purchaseOrder.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.read",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE") }),
    },
  },
  {
    fixtureLabel: "admin: reorder purchase order create",
    permissionId: "reorder.purchaseOrder.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.create",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: reorder purchase order create",
    permissionId: "reorder.purchaseOrder.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.create",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): reorder purchase order create",
    permissionId: "reorder.purchaseOrder.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.create",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE") }),
    },
  },
  {
    fixtureLabel: "admin: inventory transaction read",
    permissionId: "inventory.transaction.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.transaction.read",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: inventory transaction read",
    permissionId: "inventory.transaction.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.transaction.read",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + PARTS_MANAGER (active): inventory transaction read",
    permissionId: "inventory.transaction.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.transaction.read",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_MANAGER") }),
    },
  },
  {
    fixtureLabel: "admin: inventory action read",
    permissionId: "inventory.action.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.action.read",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: inventory action read",
    permissionId: "inventory.action.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.action.read",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician + WAREHOUSE_MANAGER (active): inventory action read",
    permissionId: "inventory.action.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.action.read",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("WAREHOUSE_MANAGER") }),
    },
  },
  {
    fixtureLabel: "admin: inventory action create",
    permissionId: "inventory.action.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.action.create",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: inventory action create",
    permissionId: "inventory.action.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "inventory.action.create",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    // No operational role unlocks this -- absent from TECHNICIAN_ROLE.permissions.
    fixtureLabel: "technician: inventory action create -- no operational role grants this",
    permissionId: "inventory.action.create",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "inventory.action.create",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("WAREHOUSE_MANAGER") }),
    },
  },

  // --- pure technician (no operational role): no Customer, no approve ---
  {
    fixtureLabel: "technician (no operational role): Customer record read",
    permissionId: "account.record.read",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "account.record.read",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician: reorder request approve (never available to technician)",
    permissionId: "reorder.request.approve",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "reorder.request.approve",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_MANAGER") }),
    },
  },

  // --- Issue #100 operational-role combos ---
  {
    fixtureLabel: "technician + PARTS_MANAGER (active): assign reorder request",
    permissionId: "reorder.request.assign",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.assign",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_MANAGER") }),
    },
  },
  {
    fixtureLabel: "technician + WAREHOUSE_MANAGER (active): manual NEEDS_PLANNING create",
    permissionId: "reorder.request.create.manual",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.create.manual",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("WAREHOUSE_MANAGER") }),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): own-assignment read",
    permissionId: "reorder.request.read.own",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "reorder.request.read.own",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE") }),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (active): purchase order void (no operational role gets Void)",
    permissionId: "reorder.purchaseOrder.void",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "reorder.purchaseOrder.void",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: onlyRole("PARTS_ASSOCIATE"), isOwnAssignment: true }),
    },
  },

  // --- fail-closed: inactive employment / broken linkage ---
  // Both model as operationalRoleActive always returning false -- the
  // real isActiveOperationalRole() Rules helper collapses either cause
  // to the same false, so the resolver (which only sees the predicate's
  // result, never the underlying reason) must DENY identically to how
  // Rules already DENY today, with no distinguishing fallback branch.
  {
    fixtureLabel: "technician + PARTS_MANAGER (INACTIVE employment): assign reorder request",
    permissionId: "reorder.request.assign",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "reorder.request.assign",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: noOperationalRoleActive }),
    },
  },
  {
    fixtureLabel: "technician + PARTS_ASSOCIATE (broken User<->Employee linkage): own-assignment read",
    permissionId: "reorder.request.read.own",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "reorder.request.read.own",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target({ operationalRoleActive: noOperationalRoleActive }),
    },
  },

  // --- fail-closed: no assignment at all (e.g. unauthenticated / unprovisioned principal) ---
  {
    fixtureLabel: "no assignments at all: any permission",
    permissionId: "account.record.read",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "account.record.read",
      assignments: [],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },

  // --- Row 15 (Task 20): Service/Work Order domain shadow migration --
  // firestore.rules' `fieldops_wos` collection (~L204-214) denies ALL
  // client-direct writes unconditionally (`allow create, update, delete:
  // if false`) -- every real workOrder.* authorization decision lives in
  // the createWorkOrder/transitionWorkOrder trusted Cloud Functions, not
  // Rules. createWorkOrder.ts and transitionWorkOrder's Cancel action both
  // gate to admin/dispatcher only; technician is denied create/cancel
  // entirely (absent from TECHNICIAN_ROLE.permissions). workOrder.transition
  // itself IS granted to technician, unconditioned (compatibilityRoles.ts's
  // own comment: the specific forward/backward action/status/ownership
  // narrowing is transitionEngine.ts's ACTION_PERMISSIONS table --
  // trusted-Function-authoritative territory this resolver does not take
  // over, Spec sec12).
  {
    fixtureLabel: "admin: work order create",
    permissionId: "workOrder.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "workOrder.create",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: work order create",
    permissionId: "workOrder.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "workOrder.create",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician: work order create -- admin/dispatcher only",
    permissionId: "workOrder.create",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "workOrder.create",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "admin: work order transition",
    permissionId: "workOrder.transition",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "workOrder.transition",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: work order transition",
    permissionId: "workOrder.transition",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "workOrder.transition",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician: work order transition -- unconditioned grant (specific action/status/ownership narrowed by the trusted transitionWorkOrder Function, not this resolver)",
    permissionId: "workOrder.transition",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "workOrder.transition",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "admin: work order cancel",
    permissionId: "workOrder.cancel",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "workOrder.cancel",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: work order cancel",
    permissionId: "workOrder.cancel",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "workOrder.cancel",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician: work order cancel -- admin/dispatcher only",
    permissionId: "workOrder.cancel",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "workOrder.cancel",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
]) as readonly ShadowComparisonInput[];
