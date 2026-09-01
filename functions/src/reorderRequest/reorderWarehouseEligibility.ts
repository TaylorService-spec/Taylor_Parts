// Reorder warehouse eligibility -- ONE governed answer to ONE question (Owner ruling R-17, 2026-08-31).
//
//     can this principal raise a reorder for THIS warehouse?
//
// Both `listReorderWarehouseOptions` and `createReorderRequest` resolve it HERE. That is the whole
// point of the module existing: the ruling's invariant is that every warehouse the picker offers
// must be accepted by the create for that same principal, and that a caller cannot bypass the
// picker by posting a warehouseId their scope does not permit. Two implementations of one predicate
// would agree today and drift later, and the drift would be silent in the direction that matters --
// a picker that offers more than the command accepts.
//
//     The selector is UX. The create callable is enforcement.
//
// ============================ WHERE THE SCOPE COMES FROM ============================
//
// Nowhere new. This mirrors the warehouse-read authority `firestore.rules` already states:
//
//     allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId)
//
// admin/dispatcher hold unscoped warehouse authority; a WAREHOUSE_MANAGER holds exactly the
// warehouses named on their own linked Employee's `assignedWarehouseIds` (Issue #226), under the
// same fail-closed contract -- reciprocal link, ACTIVE employment, role membership, and a list that
// actually contains the id. Absent, empty or malformed assignment denies EVERY warehouse. It is
// never "all warehouses", for any role.
//
// The ruling forbids inventing scope, so nothing here does. What this module adds over the Rules
// predicate is the ability to answer it as a SET (which warehouses) rather than one at a time,
// because a picker needs the set.
//
// ============================ THE PARTS_MANAGER SCOPE: RULED, NOT YET BUILT ============================
//
// `reorder.request.create.manual` is held by admin, dispatcher, and an active PARTS_MANAGER or
// WAREHOUSE_MANAGER. When R-17 wrote this module, three of those four had a governed warehouse scope
// and a PARTS_MANAGER had none, so this resolver returned NONE with the reason
// PARTS_MANAGER_SCOPE_UNDEFINED -- a named state rather than a silent zero.
//
// OWNER RULING R-29 (DECISIONS #150) HAS SINCE ANSWERED THE SCOPE QUESTION. The canonical authority is
// `RoleAssignment.scope` with type "location" and value = a governed warehouseId, and a PARTS_MANAGER
// MAY hold warehouse scope through such an assignment. `employees.assignedWarehouseIds` is demoted to a
// derived projection of that authority; it is no longer an independent grant.
//
// THE BEHAVIOUR BELOW IS DELIBERATELY UNCHANGED. This resolver still returns NONE for a PARTS_MANAGER,
// because the location-scoped consumer R-29 requires does not exist yet: no caller in this repository
// constructs a non-global TargetContext, so the location arm of resolveEffectivePermission.scopeMatches()
// is implemented and unreached. What changed is the MEANING of the constant, and the meaning is the
// point of the constant existing:
//
//     PARTS_MANAGER_SCOPE_UNDEFINED now reads NOT YET BUILT, not UNDEFINED.
//
// Whoever builds it implements R-29 §1/§3 -- resolve the principal's location-scoped assignments that
// carry this capability, and confine the command to those warehouseIds. They do not get to choose a
// scope meaning, and the two shortcuts R-17 refused are still refused: granting every warehouse, or
// reading assignedWarehouseIds as if it were the grant.
//
// PURE. No Firestore, no clock, no throwing -- every malformed input resolves to a denial.
import { evaluateOperationalRoleActive, type OperationalRoleResolutionFacts } from "../access/operationalRoleContext";

/** `users/{uid}.role` values that carry unscoped warehouse authority -- the server-side mirror of
 *  firestore.rules' isAdminOrDispatcher(). */
const UNSCOPED_SECURITY_ROLES = ["admin", "dispatcher"] as const;

const WAREHOUSE_MANAGER = "WAREHOUSE_MANAGER";
const PARTS_MANAGER = "PARTS_MANAGER";

export const REORDER_WAREHOUSE_SCOPE = {
  /** Every governed warehouse. admin / dispatcher. */
  ALL_GOVERNED: "ALL_GOVERNED",
  /** Exactly the ids in `warehouseIds`, and nothing else. */
  ASSIGNED: "ASSIGNED",
  /** No warehouse at all. The fail-closed default, and the only outcome that is ever assumed. */
  NONE: "NONE",
} as const;
export type ReorderWarehouseScopeKind = (typeof REORDER_WAREHOUSE_SCOPE)[keyof typeof REORDER_WAREHOUSE_SCOPE];

export const REORDER_WAREHOUSE_SCOPE_REASON = {
  /** users/{uid}.role is admin or dispatcher. */
  UNSCOPED_SECURITY_ROLE: "UNSCOPED_SECURITY_ROLE",
  /** An active, reciprocally-linked WAREHOUSE_MANAGER with a usable assignedWarehouseIds list. */
  WAREHOUSE_MANAGER_ASSIGNMENT: "WAREHOUSE_MANAGER_ASSIGNMENT",
  /** The role is held, but the assignment is absent, empty or malformed. Denies every warehouse. */
  WAREHOUSE_MANAGER_WITHOUT_ASSIGNMENT: "WAREHOUSE_MANAGER_WITHOUT_ASSIGNMENT",
  /** RULED BUT NOT YET BUILT. R-29 defines the scope (RoleAssignment.scope.location); the
   *  location-scoped consumer does not exist yet, so a Parts Manager still resolves to NONE. */
  PARTS_MANAGER_SCOPE_UNDEFINED: "PARTS_MANAGER_SCOPE_UNDEFINED",
  /** Nothing about this principal grants any warehouse. */
  NO_GOVERNED_WAREHOUSE_AUTHORITY: "NO_GOVERNED_WAREHOUSE_AUTHORITY",
} as const;
export type ReorderWarehouseScopeReason =
  (typeof REORDER_WAREHOUSE_SCOPE_REASON)[keyof typeof REORDER_WAREHOUSE_SCOPE_REASON];

/** The facts the operational-role mirror needs, plus the two this module adds. Raw document values:
 *  the caller reads, this module decides, and every field is `unknown` because a stored value is
 *  whatever is stored. */
export interface ReorderWarehouseScopeFacts extends OperationalRoleResolutionFacts {
  /** `users/{uid}.role` -- the legacy security role, the same field firestore.rules reads. */
  userSecurityRole: unknown;
  /** `employees/{employeeId}.assignedWarehouseIds` (Issue #226). */
  employeeAssignedWarehouseIds: unknown;
}

export interface ReorderWarehouseScope {
  readonly kind: ReorderWarehouseScopeKind;
  readonly reason: ReorderWarehouseScopeReason;
  /** Populated ONLY for ASSIGNED. `null` for ALL_GOVERNED (unbounded) and for NONE (nothing). */
  readonly warehouseIds: readonly string[] | null;
}

const deny = (reason: ReorderWarehouseScopeReason): ReorderWarehouseScope => ({
  kind: REORDER_WAREHOUSE_SCOPE.NONE,
  reason,
  warehouseIds: null,
});

/** A stored id is usable only if it is a non-blank string. A malformed entry is DROPPED rather than
 *  poisoning the whole list -- but a list that drops to empty denies everything, so dropping can
 *  only ever narrow the scope. */
function usableWarehouseIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id.length > 0) seen.add(id);
  }
  return [...seen];
}

/**
 * The one scope decision. Never throws.
 *
 * ORDER MATTERS. WAREHOUSE_MANAGER is tested before PARTS_MANAGER so that someone holding both roles
 * gets their real, governed scope rather than falling into the undefined-scope gap.
 */
export function resolveReorderWarehouseScope(facts: ReorderWarehouseScopeFacts): ReorderWarehouseScope {
  if (facts === null || typeof facts !== "object") return deny(REORDER_WAREHOUSE_SCOPE_REASON.NO_GOVERNED_WAREHOUSE_AUTHORITY);

  const securityRole = facts.userSecurityRole;
  if (typeof securityRole === "string" && (UNSCOPED_SECURITY_ROLES as readonly string[]).includes(securityRole)) {
    return { kind: REORDER_WAREHOUSE_SCOPE.ALL_GOVERNED, reason: REORDER_WAREHOUSE_SCOPE_REASON.UNSCOPED_SECURITY_ROLE, warehouseIds: null };
  }

  if (evaluateOperationalRoleActive(facts, WAREHOUSE_MANAGER)) {
    const warehouseIds = usableWarehouseIds(facts.employeeAssignedWarehouseIds);
    if (warehouseIds.length === 0) return deny(REORDER_WAREHOUSE_SCOPE_REASON.WAREHOUSE_MANAGER_WITHOUT_ASSIGNMENT);
    return { kind: REORDER_WAREHOUSE_SCOPE.ASSIGNED, reason: REORDER_WAREHOUSE_SCOPE_REASON.WAREHOUSE_MANAGER_ASSIGNMENT, warehouseIds };
  }

  if (evaluateOperationalRoleActive(facts, PARTS_MANAGER)) {
    return deny(REORDER_WAREHOUSE_SCOPE_REASON.PARTS_MANAGER_SCOPE_UNDEFINED);
  }

  return deny(REORDER_WAREHOUSE_SCOPE_REASON.NO_GOVERNED_WAREHOUSE_AUTHORITY);
}

/** Is this one warehouse inside the resolved scope? The predicate `createReorderRequest` enforces
 *  and `listReorderWarehouseOptions` filters by -- the same call, so they cannot disagree. */
export function isWarehouseInReorderScope(scope: ReorderWarehouseScope, warehouseId: unknown): boolean {
  if (scope === null || typeof scope !== "object") return false;
  if (typeof warehouseId !== "string" || warehouseId.trim().length === 0) return false;
  if (scope.kind === REORDER_WAREHOUSE_SCOPE.ALL_GOVERNED) return true;
  if (scope.kind === REORDER_WAREHOUSE_SCOPE.ASSIGNED) return (scope.warehouseIds ?? []).includes(warehouseId.trim());
  return false;
}

/** The projection the picker receives. Deliberately two fields: the identity the create needs, and
 *  the label a human chooses by.
 *
 *  NOT RETURNED, though every one of them sits on the warehouse document the server just read:
 *  operatingCompanyId (the client must never hold the company as an authority -- it is derived
 *  server-side, and shipping it would invite a caller to send it back), status, inventory, staffing,
 *  address, provenance and every other operational or company-private fact. A picker needs a name
 *  and an id; anything more is warehouse browsing under another name. */
export interface ReorderWarehouseOption {
  readonly warehouseId: string;
  readonly label: string;
}

/** Label resolution, with the document id as the last resort -- the same fallback the Receiving
 *  option service and the client's warehouses view already use. A blank or non-string name is not an
 *  error; it is a warehouse nobody has named yet. */
export function reorderWarehouseOptionLabel(name: unknown, warehouseId: string): string {
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : warehouseId;
}
