// Reorder warehouse authority -- ONE governed answer to ONE question (Owner rulings R-17, R-32):
//
//     may this principal raise a reorder for THIS warehouse?
//
// Both `listReorderWarehouseOptions` and `createReorderRequest` resolve it HERE. That is the whole
// point of the module existing: every warehouse the picker offers must be accepted by the create
// for that same principal, and a caller must not be able to bypass the picker by posting a
// warehouseId their scope does not permit. Two implementations of one predicate would agree today
// and drift later, and the drift would be silent in the direction that matters -- a picker that
// offers more than the command accepts.
//
//     The selector is UX. The create callable is enforcement.
//
// ============================ WHAT CHANGED IN R-32, AND WHY ============================
//
// This REPLACES reorderWarehouseEligibility.ts, which answered the same question from
// `employees.assignedWarehouseIds` gated on WAREHOUSE_MANAGER membership -- a second, parallel
// scope authority that no other governed capability consulted, and that could say nothing at all
// about a Parts Manager (the named PARTS_MANAGER_SCOPE_UNDEFINED gap).
//
// The authority is now the governed one, and Reorder is its FIRST consumer:
//
//     RoleAssignment -> Role -> Permission binding -> binding scope policy -> assignment scope
//                    -> TargetContext { type: "location", value: warehouseId }
//
// `employees.assignedWarehouseIds` is NOT read here, by anything, ever again. It remains untouched
// on employee records because `firestore.rules` still consumes it for its own warehouse-read arms
// (R-32 section 8 keeps that projection exactly as it is); it simply no longer authorizes a
// Function. A principal carrying wh-main in that field and no qualifying RoleAssignment is refused.
//
// ============================ WHY A PREDICATE AND NOT A SET ============================
//
// The governed resolver answers per TARGET. A location-scoped assignment names one warehouse, so
// "which warehouses may this principal use" is not a value the model holds -- it is a question
// asked once per candidate. Loading the principal's state ONCE and returning a closure keeps that
// honest: one set of reads, N pure decisions, and the create asks the identical question about the
// one warehouse it was given.
//
// FAILS CLOSED. A read that throws yields an authority that allows nothing -- an authorization
// question that cannot be answered has been answered.
import type { Firestore } from "firebase-admin/firestore";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles";
import { resolveEffectivePermission } from "../access/resolveEffectivePermission";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides";
import { isValidAccessVersionValue } from "../access/compactClaims";
import { buildOperationalRoleActiveResolverFromEmployeeId } from "../access/operationalRoleContext";
import type { Role, RoleAssignment } from "../types/access";

const USERS = "users";
const ROLE_ASSIGNMENTS = "roleAssignments";

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

/** Why a principal's list came back empty. Reported to the caller, never used to decide anything --
 *  the decision is `allows`. "You may not do this" and "you may, but no warehouse is governed to
 *  you" are different sentences and a UI should be able to tell them apart. */
export const REORDER_WAREHOUSE_AUTHORITY_REASON = {
  /** At least one warehouse resolved ALLOW. */
  GOVERNED_ASSIGNMENT: "GOVERNED_ASSIGNMENT",
  /** The principal's state loaded, but no warehouse resolved ALLOW. */
  NO_GOVERNED_WAREHOUSE_AUTHORITY: "NO_GOVERNED_WAREHOUSE_AUTHORITY",
  /** A read failed. Fail-closed, and distinguishable from a genuine empty scope. */
  AUTHORITY_UNRESOLVED: "AUTHORITY_UNRESOLVED",
} as const;
export type ReorderWarehouseAuthorityReason =
  (typeof REORDER_WAREHOUSE_AUTHORITY_REASON)[keyof typeof REORDER_WAREHOUSE_AUTHORITY_REASON];

export interface ReorderWarehouseAuthority {
  /** The one decision. PURE once loaded: no I/O, no throwing, no clock. */
  readonly allows: (warehouseId: unknown) => boolean;
  readonly reason: ReorderWarehouseAuthorityReason;
}

const DENY_ALL: ReorderWarehouseAuthority = Object.freeze({
  allows: () => false,
  reason: REORDER_WAREHOUSE_AUTHORITY_REASON.AUTHORITY_UNRESOLVED,
});

/** Every Role the resolver may match. The same union the effective-access feed resolves against --
 *  compatibility Roles carry admin/dispatcher's global authority, governed Roles carry the
 *  manager authority R-32 moved onto them. */
function allRoles(): Readonly<Record<string, Role>> {
  return { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
}

/**
 * Load the principal's governed state ONCE, and return the predicate both consumers share.
 *
 * Reads: `users/{uid}` (authoritative accessVersion + employee link), the principal's ACTIVE
 * `roleAssignments`, and -- only when a candidate employee link exists -- one `employees/{id}` for
 * the operational-role condition resolver. Deliberately OUTSIDE any transaction: warehouse status
 * is read transactionally by the create because a concurrent deactivation must conflict the commit,
 * but a principal's own role assignment changing mid-command is not that kind of hazard, and paying
 * for it in every transaction would be cost without a failure mode to prevent.
 *
 * The operational-role resolver is supplied even though no Role conditions
 * `reorder.request.create.manual` after R-32 moved the manager grants onto unconditioned governed
 * Roles. Supplying it costs one read that is already being made for the employee link and means a
 * future Condition on this binding resolves correctly instead of silently denying -- the exact
 * defect Wave 7 PART 4 had to correct in the effective-access feed.
 */
export async function loadReorderWarehouseAuthority(
  db: Firestore,
  uid: string,
  capabilityId: string,
): Promise<ReorderWarehouseAuthority> {
  try {
    const [userSnap, assignmentsSnap] = await Promise.all([
      db.collection(USERS).doc(uid).get(),
      db.collection(ROLE_ASSIGNMENTS).where("principalUid", "==", uid).where("status", "==", "active").get(),
    ]);

    const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown> | undefined) : undefined;
    const rawVersion = userData?.accessVersion;
    let accessVersion = 0;
    if (rawVersion !== undefined && rawVersion !== null) {
      // Malformed access data is a denial, never a default -- treating it as 0 would silently
      // qualify assignments that the real version would have aged out.
      if (!isValidAccessVersionValue(rawVersion)) return DENY_ALL;
      accessVersion = rawVersion as number;
    }

    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as unknown as RoleAssignment[];
    const operationalRoleActive = await buildOperationalRoleActiveResolverFromEmployeeId(
      db,
      uid,
      userData?.employeeId,
    );
    const roles = allRoles();
    const activationOverrides = resolveRuntimeCapabilityOverrides();

    const allows = (warehouseId: unknown): boolean => {
      if (typeof warehouseId !== "string" || warehouseId.trim().length === 0) return false;
      return (
        resolveEffectivePermission({
          permissionId: capabilityId,
          assignments,
          roles,
          currentAccessVersion: accessVersion,
          target: {
            scope: { type: "location", value: warehouseId.trim() },
            condition: { operationalRoleActive },
          },
          activationOverrides,
        }).decision === "ALLOW"
      );
    };

    return { allows, reason: REORDER_WAREHOUSE_AUTHORITY_REASON.NO_GOVERNED_WAREHOUSE_AUTHORITY };
  } catch (err) {
    console.error("[reorder] warehouse authority resolution failed", err);
    return DENY_ALL;
  }
}
