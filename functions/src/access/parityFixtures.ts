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
// SHARED EOS ACCESS CONTRACT. This module exists in both the Functions and
// frontend packages because there is no shared-module tooling in this repo. It is
// maintained as ONE canonical source and mechanically synchronized by
// scripts/syncAccessContracts.mjs -- never by hand-editing two copies.
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

// ============================ RETIRED BY R-32 (#152) ============================
//
// FIVE fixtures were REMOVED here, each of the form "technician + PARTS_MANAGER/WAREHOUSE_MANAGER
// (active) -> ALLOW": reorder.request.create.manual, reorder.request.read.queue,
// reorder.request.assign, inventory.transaction.read, inventory.action.read.
//
// THEY WERE NOT WRONG WHEN WRITTEN, AND THIS IS NOT A FIXTURE FIX. They recorded a real legacy
// behaviour: today's Rules DO grant those reads to an active operational manager, and the
// compatibility Role reproduced that faithfully. R-32 deliberately ENDS that reproduction -- manager
// authority may no longer be obtained by holding a Role named `technician` -- so the governed model
// now DENIES where legacy Rules still ALLOW.
//
// THAT IS AN INTENTIONAL, OWNER-RULED DIVERGENCE, and it is recorded here rather than hidden by
// flipping each fixture's expectation to DENY. A flipped fixture would still read as "parity
// holds", which would be false: parity for these five is deliberately broken, and the governed
// model is the narrower of the two.
//
// WHO IS AFFECTED: a principal holding the technician compatibility Role AND an active
// PARTS_MANAGER/WAREHOUSE_MANAGER operational role loses these capabilities through the governed
// feed until granted the governed manager Role. Measured in eos-platform-sandbox: NO principal is
// in that state (the technician persona has operationalRoles: [], and the two manager personas hold
// no assignment to `technician`), so the live effect there is nil. Production was NOT measured and
// nothing is deployed by this change.
//
// The INACTIVE-employment and broken-linkage DENY fixtures for the same capabilities are KEPT: they
// still hold, and they still prove the fail-closed contract they were written for.
export const PARITY_FIXTURES: readonly ShadowComparisonInput[] = Object.freeze([
  // --- admin / dispatcher: Customer + Issue #175 governed field ---
  {
    fixtureLabel: "admin: governed field write",
    permissionId: "customer.governedField.write",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "customer.governedField.write",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: governed field write (Issue #175 withheld)",
    permissionId: "customer.governedField.write",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "customer.governedField.write",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: Customer record read",
    permissionId: "customer.record.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "customer.record.read",
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
  // by the distinct customer.governedField.write permission/Condition,
  // already covered above; customer.record.create/update themselves are
  // unconditional admin/dispatcher grants in compatibilityRoles.ts's shared
  // base, matching the Rules' base isAdminOrDispatcher() gate exactly).
  // `delete` has no corresponding permission id -- firestore.rules denies it
  // unconditionally (`allow delete: if false`) for every role, so there is
  // nothing for the resolver to parity-check.
  {
    fixtureLabel: "admin: Customer record read",
    permissionId: "customer.record.read",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "customer.record.read",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "admin: Customer record create",
    permissionId: "customer.record.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "customer.record.create",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "admin: Customer record update",
    permissionId: "customer.record.update",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "customer.record.update",
      assignments: [assignment("admin")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: Customer record create",
    permissionId: "customer.record.create",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "customer.record.create",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "dispatcher: Customer record update",
    permissionId: "customer.record.update",
    legacyDecision: "ALLOW",
    resolverInput: {
      permissionId: "customer.record.update",
      assignments: [assignment("dispatcher")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician (no operational role): Customer record create",
    permissionId: "customer.record.create",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "customer.record.create",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician (no operational role): Customer record update",
    permissionId: "customer.record.update",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "customer.record.update",
      assignments: [assignment("technician")],
      roles: COMPATIBILITY_ROLES,
      currentAccessVersion: 1,
      target: target(),
    },
  },
  {
    fixtureLabel: "technician (no operational role): Customer governed field write",
    permissionId: "customer.governedField.write",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "customer.governedField.write",
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
    permissionId: "customer.record.read",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "customer.record.read",
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
    permissionId: "customer.record.read",
    legacyDecision: "DENY",
    resolverInput: {
      permissionId: "customer.record.read",
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
