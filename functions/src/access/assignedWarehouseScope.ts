// THE WAREHOUSE MANAGER'S GOVERNED WAREHOUSE SCOPE — server-derived, never supplied.
//
// ════════════════════ WHAT THIS MIRRORS, AND WHY IT IS THIS FIELD ════════════════════
//
// A byte-for-byte mirror of the retired `firestore.rules` predicate:
//
//   function isAssignedToWarehouse(warehouseId) {
//     let employeeId = linkedEmployeeId();
//     let employee = get(/databases/$(database)/documents/employees/$(employeeId)).data;
//     return isSignedIn()
//       && employeeId != null
//       && employee.userId == request.auth.uid
//       && employee.employmentStatus == "ACTIVE"
//       && employee.operationalRoles is list
//       && employee.operationalRoles.hasAny(["WAREHOUSE_MANAGER"])
//       && employee.assignedWarehouseIds is list
//       && employee.assignedWarehouseIds.hasAny([warehouseId]);
//   }
//
// ════════════════════ WHY NOT THE GOVERNED RoleAssignment SCOPE ════════════════════
//
// Because it is not provably the same population, and the platform already measured that.
//
// R-32 moved the reorder CREATE authority onto governed location-scoped RoleAssignments and stated
// plainly that `employees.assignedWarehouseIds` "is NOT read here, by anything, ever again" -- while
// deliberately leaving the Rules' own warehouse-READ arms on that field, exactly as they were. The
// two authorities have coexisted since, describing the same business fact through different
// records.
//
// `functions/scripts/r32ProductionExposureCensus.js` compares them per manager and can report
// MATCH, GOVERNED_ONLY, ASSIGNEDWAREHOUSE_ONLY or CONTRADICTORY -- and calls the comparison
// "diagnostic only, never a defect on its own". A census that admits CONTRADICTORY is a census that
// has not established equivalence. Substituting one for the other during a parity migration would
// therefore change WHICH RECORDS a manager can see, silently, in whichever direction the data
// happens to disagree.
//
// So this migration preserves the OLD EFFECTIVE SCOPE, server-side, and says so:
//
//   TRANSITIONAL SCOPE PLUMBING. `employees.assignedWarehouseIds` is read HERE and nowhere else in
//   the read path. It is not authority -- the CAPABILITY decides whether a principal may read
//   warehouse data at all; this only answers WHICH records, and only for a principal already
//   authorized. The day the governed RoleAssignment scope is proven equivalent to this population,
//   this module is the single thing that changes.
//
// The browser decides neither. Nothing in any input shape accepts a warehouse id as scope.
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const USERS = "users";
const EMPLOYEES = "employees";
const ACTIVE_EMPLOYMENT_STATUS = "ACTIVE";
const WAREHOUSE_MANAGER = "WAREHOUSE_MANAGER";

/** The raw facts the retired predicate read. Kept as a value so the judgement below stays pure. */
export interface AssignedWarehouseFacts {
  readonly uid: string;
  readonly userEmployeeId: unknown;
  readonly employeeExists: boolean;
  readonly employeeUserId: unknown;
  readonly employeeEmploymentStatus: unknown;
  readonly employeeOperationalRoles: unknown;
  readonly employeeAssignedWarehouseIds: unknown;
}

/**
 * PURE. The warehouse ids this principal is assigned to, or an EMPTY LIST.
 *
 * Empty is the only failure mode: every malformed, missing or contradictory input yields no
 * warehouses rather than an error or a wildcard. A scope that cannot be established is a scope of
 * nothing, which is what makes a caller holding the capability but lacking an assignment see an
 * empty list rather than everything.
 *
 * The `hasAny` mirror is exact-equality membership, so a non-string entry in the stored array
 * simply never matches -- it does not throw and does not widen.
 */
export function resolveAssignedWarehouseIds(facts: AssignedWarehouseFacts): readonly string[] {
  if (typeof facts.uid !== "string" || facts.uid.length === 0) return [];
  const employeeId =
    typeof facts.userEmployeeId === "string" && facts.userEmployeeId.length > 0
      ? facts.userEmployeeId
      : null;
  if (employeeId === null) return [];
  if (!facts.employeeExists) return [];
  // GOVERNED reciprocal field ONLY -- exact match, no alias fields.
  if (facts.employeeUserId !== facts.uid) return [];
  if (facts.employeeEmploymentStatus !== ACTIVE_EMPLOYMENT_STATUS) return [];
  if (!Array.isArray(facts.employeeOperationalRoles)) return [];
  if (!facts.employeeOperationalRoles.includes(WAREHOUSE_MANAGER)) return [];
  if (!Array.isArray(facts.employeeAssignedWarehouseIds)) return [];
  return facts.employeeAssignedWarehouseIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

/**
 * Read the facts for one principal. FAILS CLOSED: any read error yields an empty scope.
 *
 * Two reads at most -- `users/{uid}` for the linkage, then the linked employee record. Zero when
 * there is no linkage to follow.
 */
export async function loadAssignedWarehouseScope(
  uid: string,
  deps: { db?: Firestore } = {},
): Promise<readonly string[]> {
  const db = deps.db ?? getFirestore();
  try {
    const userSnap = await db.collection(USERS).doc(uid).get();
    const userEmployeeId = userSnap.exists
      ? (userSnap.data() as Record<string, unknown>).employeeId
      : undefined;
    const employeeId =
      typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
    if (employeeId === null) {
      return resolveAssignedWarehouseIds({
        uid,
        userEmployeeId,
        employeeExists: false,
        employeeUserId: undefined,
        employeeEmploymentStatus: undefined,
        employeeOperationalRoles: undefined,
        employeeAssignedWarehouseIds: undefined,
      });
    }
    const employeeSnap = await db.collection(EMPLOYEES).doc(employeeId).get();
    const employee = employeeSnap.exists
      ? (employeeSnap.data() as Record<string, unknown>)
      : undefined;
    return resolveAssignedWarehouseIds({
      uid,
      userEmployeeId,
      employeeExists: employeeSnap.exists,
      employeeUserId: employee?.userId,
      employeeEmploymentStatus: employee?.employmentStatus,
      employeeOperationalRoles: employee?.operationalRoles,
      employeeAssignedWarehouseIds: employee?.assignedWarehouseIds,
    });
  } catch (err) {
    console.error("[warehouseScope] assignment resolution failed", err);
    return [];
  }
}
