// GENERATED FILE — DO NOT EDIT.
//
// Generated from the canonical EOS access contract by scripts/syncAccessContracts.mjs.
// Edit the canonical source under functions/src/access/ and re-run the generator;
// edits made here are overwritten and CI fails on drift.

// Enterprise Access & Administration Platform (Issue #226) -- seeded
// admin/dispatcher/technician compatibility Roles. Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md §7
// and sequenced by docs/implementation-plans/enterprise-access-and-
// administration-platform.md (Row 2 / Task 7).
//
// These Role definitions are the parity oracle (Spec §7): every later
// shadow-mode comparison (Implementation Plan Row 4) is scored against
// this exact mapping, not a re-derived interpretation. Sourced directly
// from docs/assessments/enterprise-access-and-administration-platform.md's
// current-state matrix (§1) and "Inventory domain audit" table, and the
// live `firestore.rules` grants they describe.
//
// PURE, dependency-free data module -- declaring these Role objects
// grants nothing to anyone; no Rule/Function/claim reads this yet.
// `admin`/`dispatcher`/`technician` keep authorizing exactly as they do
// today via `users/{uid}.role` until a later, separately-authorized row
// activates the Permission engine for any domain.
//
// Recorded scope decision from Row 2 (now resolved by Row 7 / Task 12):
// the `admin.*` Permission ids (functions/src/access/permissionCatalog.ts)
// were deliberately withheld from every Role until "the Admin Portal /
// trusted-writer rows (5, 7, 10-12) actually ship." Row 7 is that row --
// the three ids Row 7's trusted-writer commands actually check
// (admin.userStatus.write, admin.roleAssignment.write,
// admin.accessRequest.decide) are now granted, to `admin` ONLY, never
// `dispatcher` (Assessment/Spec describe no Admin Portal authority for
// dispatcher). `audit.event.read` remains deferred to Row 11 (the Admin
// Portal's own read surface), since Row 7 does not consume it.
//
// SHARED EOS ACCESS CONTRACT. This module exists in both the Functions and
// frontend packages because there is no shared-module tooling in this repo. It is
// maintained as ONE canonical source and mechanically synchronized by
// scripts/syncAccessContracts.mjs -- never by hand-editing two copies.
import type { Role } from "../types/access";
import { PERMISSION_CATALOG } from "./permissionCatalog.ts";

const PARTS_MANAGER_ONLY = { role: "PARTS_MANAGER" };
const PARTS_ASSOCIATE_ONLY = { role: "PARTS_ASSOCIATE" };
const WAREHOUSE_MANAGER_ONLY = { role: "WAREHOUSE_MANAGER" };
const MANAGER_OR_WAREHOUSE = { roles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER"] };

// Shared base: every Permission both admin and dispatcher hold today,
// per the Assessment's current-state matrix. Not exported -- ADMIN_ROLE
// and DISPATCHER_ROLE each derive their own final list from this base
// PLUS their own additions, rather than one being derived by filtering
// the other -- so adding an admin-only id to ADMIN_ROLE can never leak
// into DISPATCHER_ROLE by accident (the failure mode a filter-based
// derivation would risk).
const SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS = [
  "customer.record.read",
  "customer.record.create",
  "customer.record.update",
  "workOrder.create",
  "workOrder.transition",
  "workOrder.cancel",
  "reorder.request.read.queue",
  "reorder.request.read.own",
  "reorder.request.create.manual",
  "reorder.request.create.system",
  "reorder.request.assign",
  "reorder.request.startPurchasing",
  "reorder.request.postPurchasingUpdate",
  "reorder.request.recordPurchaseOrder",
  "reorder.request.markReceived",
  "reorder.request.approve",
  "reorder.request.reject",
  "reorder.request.cancel",
  "reorder.purchaseOrder.read",
  "reorder.purchaseOrder.create",
  "reorder.purchaseOrder.void",
  "inventory.analytics.read",
  "inventory.transaction.read",
  "inventory.action.read",
  "inventory.action.create",
  // Wave 6 Owner Decision (2026-08-15): trusted Manufacturer catalog read, direct grant to admin +
  // dispatcher (both spread this base); Owner inherits by composition. See the operational-role note
  // near TECHNICIAN_ROLE.conditionsByPermission below.
  "inventory.catalog.read",
  // EI Phase-2 Receiving -- Capability Grant Gate. DIRECT grant to the governed ADMIN + DISPATCHER roles
  // (both spread this shared base). The governed OWNER role INHERITS it too by explicit composition
  // (OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...reports], i.e. owner >= admin), so the effective
  // holder set is {admin, dispatcher, owner} -- Owner-ratified (Codex round 1). Technician + operational
  // roles do NOT hold it; PARTS_ASSOCIATE remains DEFERRED until a separately ratified scoped model or an
  // explicit Owner acceptance of global Receiving authority. Uses the existing E1 global capability
  // target; accessVersion + active-status revocation are enforced by resolveEffectivePermission.
  "inventory.stock.receive",
  // Spec §27.3 -- additive-only: reproduces admin/dispatcher's already-
  // existing, unchanged `warehouses`/`stock_locations`/`transfer_orders`
  // read grant (Epic 4), not a new capability. Required to keep this
  // parity oracle accurate and resolveEffectivePermission.test.mjs's own
  // A3 acceptance test passing (every catalog id must be granted by at
  // least one compatibility Role).
  "warehouse.record.read",
  "warehouse.stockLocation.read",
  "warehouse.transferOrder.read",
  // Sales/Fulfillment spine -- OPERATIONAL grant (per-environment-capability-
  // activation-spec Phase 6a, Owner-directed 2026-08-14). Granted directly to
  // ADMIN + DISPATCHER (both spread this base); OWNER inherits by composition
  // (OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...]). Technician does NOT
  // hold these. GRANT != ACTIVATION: these ids are registered `active: false`,
  // so resolveEffectivePermission still DENIES them everywhere the per-
  // environment activation override is off -- i.e. in production (role-keyed
  // off) they remain inactivePermission DENY regardless of this grant. They
  // become exercisable ONLY where activation is on (platform-sandbox). This is
  // the spec's "grant globally in code, activate per-environment" model.
  "opportunity.write",
  "opportunity.read",
  "opportunity.createSalesOrder",
  "salesOrder.read",
  "salesOrder.write",
  "salesOrder.fulfill",
  "salesOrder.service",
  // Sales Agreement (Slice 4) -- same posture as the spine ids above: granted here so ADMIN and
  // DISPATCHER hold them and OWNER inherits by composition, and so the catalog acceptance test
  // ("every catalog id is granted by at least one compatibility Role") stays true. Technician does
  // NOT hold these. GRANT != ACTIVATION: all four are registered active:false, so they deny
  // everywhere the per-environment override is off -- production included, role-keyed off.
  "salesAgreement.create",
  "salesAgreement.updateDraft",
  "salesAgreement.accept",
  "salesAgreement.read",
  // Coordinated Operations fidelity fix, grant step (Owner ruling, grantable-governed-roles
  // workstream). `fulfillment.coordinatedVisit.read` was registered active:false and ALREADY
  // eligible for per-environment activation (environmentCapabilityOverrides.ts), but held by NO
  // Role at all -- so Coordinated Visits (Service/Dispatch) and Coordinated Mission (Technician)
  // stayed inert even where activation was on, for every principal including Owner. Owner's
  // proposed grant set is exactly {owner, admin, operationsManager, fieldManager, dispatcher};
  // granted here to the shared admin/dispatcher base so both compatibility Roles hold it AND
  // Owner inherits it by composition (OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...]) --
  // operationsManager and fieldManager are granted directly in governedBusinessRoles.ts. Grant is
  // NOT activation: this id stays active:false, so it denies everywhere the per-environment
  // override is off (i.e. everywhere except platform-sandbox), exactly like the spine ids above.
  "fulfillment.coordinatedVisit.read",
] as const;

// reorder.purchaseOrder.void is double-gated in firestore.rules
// (current `main`, ~L794-798): `isAdminOrDispatcher() AND
// request.auth.uid == resource.data.assignedToUserId` -- even
// admin/dispatcher must be the request's own recorded assignee, not
// just hold the security role. Both compatibility Roles carry this
// Condition.
const SHARED_ADMIN_DISPATCHER_CONDITIONS = {
  "reorder.purchaseOrder.void": [{ kind: "isOwnAssignment" as const, params: {} }],
};

// Every capability admin holds by CURATION -- each entry below was granted by a
// specific decision, and the comments are the record of those decisions. Kept
// verbatim so the reasoning survives; see ADMIN_ALL_PERMISSIONS beneath it for
// what admin actually resolves with.
const ADMIN_CURATED_PERMISSIONS = [
    ...SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS,
    "customer.governedField.write",
    "admin.userStatus.write",
    "admin.roleAssignment.write",
    "admin.accessRequest.decide",
    // Sales/Fulfillment/Finance spine -- FINANCE grant (Phase 6a). ADMIN-only
    // (NOT in the shared base) so DISPATCHER does not hold billing/AR authority;
    // OWNER inherits these via OWNER_PERMISSIONS composition. Same GRANT !=
    // ACTIVATION property as the operational spine above: registered
    // `active: false`, so DENIED in production regardless of this grant, and
    // exercisable only where the per-environment activation override is on
    // (platform-sandbox).
    "finance.invoice.issue",
    "finance.payment.apply",
    "finance.adjustment.record",
    "finance.refund.record",
    "finance.read",
    // CRM activity -- Owner ruling 2026-08-19, closing the finding in
    // docs/governance/crm-activity-admin-authority-proposal.md. Exactly one Role
    // carried these ids (crmActivityContributor), so canonical admin authority did
    // not include them: a dispatcher holding that operational Role could read CRM
    // notes on an Account while the admin could not, and OWNER inherited the same
    // gap through OWNER_PERMISSIONS composition. The proposal explicitly REJECTED
    // assigning crmActivityContributor to admin as the durable fix -- that turns
    // canonical authority into accumulated operational-role workarounds. Granting
    // on ADMIN_ROLE is the durable form, and Owner ruled admin holds the full set,
    // not read alone.
    //
    // ADMIN-only (NOT the shared base) so DISPATCHER does not gain crm.activity.create
    // as a side effect -- dispatcher already holds both by its own governed
    // crmActivityContributor assignment, which stays the audited path for anyone else.
    // Owner inherits both automatically via OWNER_PERMISSIONS composition.
    //
    // GRANT != ACTIVATION, unchanged: both ids remain per-environment activated
    // (environmentCapabilityOverrides.ts) and production stays triple-blocked.
    "crm.activity.create",
    "crm.activity.read",
    // Catalog curation -- Owner ruling 2026-08-19. inventory.catalog.manage creates and
    // edits the canonical Part and Manufacturer records every stock movement, Work Order
    // line and Purchase Order keys off. Before this, exactly two Roles carried it:
    // inventoryCatalogAdministrator (durable) and inventoryCreateExecutor (a one-run
    // temporary elevation) -- so canonical admin authority did NOT include the ability to
    // fix a catalog record, while a Parts Manager holding the operational Role did.
    //
    // ADMIN-only, deliberately NOT on SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS: dispatcher
    // gains nothing. Owner inherits via OWNER_PERMISSIONS composition.
    //
    // MANAGE only, NOT inventory.catalog.activate. Creating and correcting reference data
    // is a different authority from changing its lifecycle status, and activate stays with
    // inventoryCatalogAdministrator. admin already holds inventory.catalog.read through the
    // shared base, so read+manage is a coherent pair -- curating a Part against a
    // manufacturer list you cannot see is not (the same reasoning that added the read to
    // inventoryCatalogAdministrator).
    "inventory.catalog.manage",
];

// OWNER RULING (2026-08-19): "Admin and Owner have full access to all possible
// features and permissions." So admin holds the ENTIRE catalog, not a hand-kept
// subset of it.
//
// WHY THIS IS DERIVED AND NOT A LONGER HAND LIST. The curated list above had
// drifted 60 ids behind the catalog. Nobody removed them; the catalog simply grew
// and the list did not, and the gap was invisible until an admin went looking for
// a screen and found nothing. A literal list of 110 ids would be correct on the
// day it was written and wrong again at the next capability added. Deriving it
// means a new capability is admin's the moment it is registered, which is exactly
// what the ruling says.
//
// GRANT IS STILL NOT ACTIVATION. Holding an id that is registered `active: false`
// resolves DENY with reason `inactivePermission` regardless. This widens WHO holds
// a capability; it does not turn any capability on, in any environment.
//
// SEPARATION-OF-DUTIES NOTE, deliberately recorded rather than silently applied:
// this puts inventory.cycleCount.create/submit/reconcile in one Role, so an admin
// can reconcile a count they themselves submitted, and it grants audit.event.read.
// Both follow from the ruling as stated. If internal controls should override the
// ruling for those specific ids, they belong in an explicit exclusion list here --
// not as an accident of the list being out of date.
const ADMIN_ALL_PERMISSIONS = [
  ...ADMIN_CURATED_PERMISSIONS,
  ...PERMISSION_CATALOG.map((permission) => permission.id).filter(
    (id) => !ADMIN_CURATED_PERMISSIONS.includes(id),
  ),
];

// Assessment §1: admin has every capability audited there, including the
// Issue #175 governed-field write withheld from dispatcher, plus the
// Row 7 Admin Portal / trusted-writer authorities.
export const ADMIN_ROLE: Role = Object.freeze({

  id: "admin",
  name: "Administrator (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's admin security-role matrix exactly.",
  systemSeed: true,
  compatibility: true,
  // Privileged (Spec sec2.4 / ADR-005 sec2.4): granting/revoking this
  // Role requires a second, distinct authorized approver, and it is
  // never eligible for the single-admin assignApprovedRole path (Row 7).
  privileged: true,
  permissions: ADMIN_ALL_PERMISSIONS,
  conditionsByPermission: SHARED_ADMIN_DISPATCHER_CONDITIONS,
}) as Role;

// Assessment §1: dispatcher matches the shared base exactly -- no
// governed-field write (Issue #175), no Admin Portal / trusted-writer
// authority (Row 7).
export const DISPATCHER_ROLE: Role = Object.freeze({
  id: "dispatcher",
  name: "Dispatcher (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's dispatcher security-role matrix exactly.",
  systemSeed: true,
  compatibility: true,
  permissions: [...SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS],
  conditionsByPermission: SHARED_ADMIN_DISPATCHER_CONDITIONS,
}) as Role;

// Assessment's Inventory domain audit table: a pure technician has none
// of the admin/dispatcher-only actions (no Customer access, no
// approve/reject/cancel/void-without-assignment, no system-path
// create); the Issue #100 operational-role grants are expressed here
// as Conditions on `operationalRoleActive`, never as unconditioned
// Permissions -- an operationalRole never becomes a security Permission
// by itself (Spec §9).
//
// `workOrder.transition` is granted unconditioned: the *specific*
// forward/backward direction a technician may invoke is still decided
// by transitionEngine.ts's own ACTION_PERMISSIONS table (Spec §12 lists
// "existing Cloud-Function-owned lifecycle e.g. transitionWorkOrder" as
// trusted-Function-authoritative territory this resolver does not take
// over) -- the fixed ConditionKind set (Spec §5.5) has no
// "action-direction" predicate, and inventing one is out of Row 2's
// scope.
export const TECHNICIAN_ROLE: Role = Object.freeze({
  id: "technician",
  name: "Technician (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's technician security-role matrix exactly, with Issue #100 operational-role grants expressed as Conditions.",
  systemSeed: true,
  compatibility: true,
  permissions: [
    "workOrder.transition",
    "reorder.request.read.queue",
    "reorder.request.read.own",
    "reorder.request.create.manual",
    "reorder.request.assign",
    "reorder.request.startPurchasing",
    "reorder.request.postPurchasingUpdate",
    "reorder.request.recordPurchaseOrder",
    "reorder.request.markReceived",
    "reorder.purchaseOrder.read",
    "reorder.purchaseOrder.create",
    "inventory.transaction.read",
    "inventory.action.read",
    // Wave 6 Owner Decision (2026-08-15): declared for parity with the two capabilities directly
    // above (same operational-role-conditioned shape below), matching the Owner's requested reader
    // list (active Parts Manager / Warehouse Manager). NOTE: like its siblings, this DENIES today
    // through resolveEffectiveAccess's coarse feed (effectiveAccessFeed.ts always passes an empty
    // condition context by design -- no callable in this repo has ever supplied a populated
    // operationalRoleActive resolver). Declared here so the grant is documented and consistent with
    // existing precedent, not silently omitted; see manufacturerReadService.ts's header comment.
    "inventory.catalog.read",
  ],
  // reorder.purchaseOrder.void is deliberately NOT granted to technician
  // at all -- firestore.rules (current `main`) keeps Void gated to
  // isAdminOrDispatcher() + assignee only, with its own inline comment
  // that this is NOT extended to PARTS_ASSOCIATE even though it is
  // already the assignee (matching the Assessment's Inventory domain
  // audit table: "no operational role gets Approve/Reject/Cancel/Void").
  conditionsByPermission: {
    "reorder.request.read.queue": [
      { kind: "operationalRoleActive", params: PARTS_MANAGER_ONLY },
    ],
    "reorder.request.read.own": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.create.manual": [
      { kind: "operationalRoleActive", params: MANAGER_OR_WAREHOUSE },
    ],
    "reorder.request.assign": [
      { kind: "operationalRoleActive", params: PARTS_MANAGER_ONLY },
    ],
    "reorder.request.startPurchasing": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.postPurchasingUpdate": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.recordPurchaseOrder": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.markReceived": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.purchaseOrder.read": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.purchaseOrder.create": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "inventory.transaction.read": [
      { kind: "operationalRoleActive", params: MANAGER_OR_WAREHOUSE },
    ],
    "inventory.action.read": [
      { kind: "operationalRoleActive", params: WAREHOUSE_MANAGER_ONLY },
    ],
    "inventory.catalog.read": [
      { kind: "operationalRoleActive", params: MANAGER_OR_WAREHOUSE },
    ],
  },
}) as Role;

export const COMPATIBILITY_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  admin: ADMIN_ROLE,
  dispatcher: DISPATCHER_ROLE,
  technician: TECHNICIAN_ROLE,
});
