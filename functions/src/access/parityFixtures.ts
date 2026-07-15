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
]) as readonly ShadowComparisonInput[];
