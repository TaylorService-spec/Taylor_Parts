"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPATIBILITY_ROLES = exports.TECHNICIAN_ROLE = exports.DISPATCHER_ROLE = exports.ADMIN_ROLE = void 0;
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
    "account.record.read",
    "account.record.create",
    "account.record.update",
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
];
// reorder.purchaseOrder.void is double-gated in firestore.rules
// (current `main`, ~L794-798): `isAdminOrDispatcher() AND
// request.auth.uid == resource.data.assignedToUserId` -- even
// admin/dispatcher must be the request's own recorded assignee, not
// just hold the security role. Both compatibility Roles carry this
// Condition.
const SHARED_ADMIN_DISPATCHER_CONDITIONS = {
    "reorder.purchaseOrder.void": [{ kind: "isOwnAssignment", params: {} }],
};
// Assessment §1: admin has every capability audited there, including the
// Issue #175 governed-field write withheld from dispatcher, plus the
// Row 7 Admin Portal / trusted-writer authorities.
exports.ADMIN_ROLE = Object.freeze({
    id: "admin",
    name: "Administrator (compatibility)",
    description: "Seeded compatibility Role reproducing today's admin security-role matrix exactly.",
    systemSeed: true,
    compatibility: true,
    // Privileged (Spec sec2.4 / ADR-005 sec2.4): granting/revoking this
    // Role requires a second, distinct authorized approver, and it is
    // never eligible for the single-admin assignApprovedRole path (Row 7).
    privileged: true,
    permissions: [
        ...SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS,
        "account.governedField.write",
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
    ],
    conditionsByPermission: SHARED_ADMIN_DISPATCHER_CONDITIONS,
});
// Assessment §1: dispatcher matches the shared base exactly -- no
// governed-field write (Issue #175), no Admin Portal / trusted-writer
// authority (Row 7).
exports.DISPATCHER_ROLE = Object.freeze({
    id: "dispatcher",
    name: "Dispatcher (compatibility)",
    description: "Seeded compatibility Role reproducing today's dispatcher security-role matrix exactly.",
    systemSeed: true,
    compatibility: true,
    permissions: [...SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS],
    conditionsByPermission: SHARED_ADMIN_DISPATCHER_CONDITIONS,
});
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
exports.TECHNICIAN_ROLE = Object.freeze({
    id: "technician",
    name: "Technician (compatibility)",
    description: "Seeded compatibility Role reproducing today's technician security-role matrix exactly, with Issue #100 operational-role grants expressed as Conditions.",
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
});
exports.COMPATIBILITY_ROLES = Object.freeze({
    admin: exports.ADMIN_ROLE,
    dispatcher: exports.DISPATCHER_ROLE,
    technician: exports.TECHNICIAN_ROLE,
});
//# sourceMappingURL=compatibilityRoles.js.map