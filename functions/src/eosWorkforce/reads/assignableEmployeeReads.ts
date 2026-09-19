// Step G: the governed PostgreSQL ASSIGNABLE-EMPLOYEE read -- who may be offered work of a given kind.
//
// It replaces the legacy client query `buildAssignableEmployeesQuery`, which asked Firestore for
// `employmentStatus == ACTIVE AND operationalRoles array-contains <VALUE> AND userId != null`. That one predicate
// fused three separate questions; this read asks them separately, against the governed authorities.
//
// ════════════════════ THE THREE FACTS, KEPT SEPARATE ════════════════════
//
//   LIFECYCLE      eos_workforce.employees.employment_status -- what the Employee's employment IS
//   QUALIFICATION  eos_workforce.employee_work_eligibility   -- what kind of work they are QUALIFIED for
//   ACCOUNT        eos_policy.employee_principal_links       -- whether work can be assigned TO a login at all
//
// ════════════════════ ELIGIBILITY IS A POLICY, DECLARED HERE, NOT A SCHEMA FLAG ════════════════════
//
// The Employee migration's own ruling (#186/#189) forbids storing eligibility and forbids treating
// `status != ACTIVE` as "not eligible" unless a governed policy for THAT operation says so. So this operation
// states its policy explicitly, and states why it is what it is:
//
//   ASSIGNABLE_EMPLOYMENT_STATUSES = ['ACTIVE']
//
// ACTIVE ALONE, because that is exactly what the legacy query did. This is a semantics-preserving migration: adding
// ON_LEAVE or CONTRACTOR here would be a BUSINESS CHANGE dressed as a refactor, and widening who may be assigned
// work is not something a cutover gets to decide. Changing the policy is a separate, reviewed decision, which is
// why the list is a named constant rather than an inline comparison.
//
// ════════════════════ WHAT IT DOES NOT DO ════════════════════
//
// NO SCOPE IS INFERRED. Holding WAREHOUSE_OPERATIONS says nothing about WHICH warehouse, so this read never adds a
// scope predicate on its own. A caller whose workflow is genuinely about one warehouse passes that warehouse
// explicitly and gets the scope checked; every other caller gets qualification alone, because that is all its
// current behaviour required.
//
// NO QUALIFICATION IS INFERRED FROM JOB ROLE. `Parts / Warehouse` is presentation. An Employee holding that Job
// Role and no WAREHOUSE_OPERATIONS qualification is NOT assignable, and the read never consults job_roles.
//
// THE LINKED PRINCIPAL IS MANDATORY, AND NOT A CALLER'S CHOICE. The legacy query ALWAYS required `userId != null`,
// so exposing a flag that turns the predicate off would let a caller obtain Employees the legacy path never returned
// -- a behavioural widening introduced by a migration, which is precisely what a cutover may not do. There is no
// input that disables it. If a workflow ever genuinely needs to assign work to an Employee with no login, that is a
// separate business-policy decision and a separate reviewed read contract, not a parameter on this one.
//
// WHAT "LINKED" MEANS HERE IS WHAT IT ALREADY MEANT. readEmployeePrincipalLink answers `userAccess: "LINKED"` for an
// ACTIVE link row in the actor's tenant, so this read uses exactly that and nothing more:
//
//   STRUCTURAL, NOT DUPLICATED   the link's composite FK (tenant_id, principal_id) -> tenant_memberships already
//                                guarantees the Principal EXISTS and is a MEMBER OF THIS TENANT. A row cannot be
//                                written otherwise, so re-checking it here would assert what the database enforces.
//   CHECKED HERE                 `status = 'active'`. The table keeps revoked links as history, and a revoked link is
//                                not a login -- "some link row exists" is the wrong question.
//   DELIBERATELY NOT CHECKED     the Principal's own status and its membership STATUS. readEmployeePrincipalLink
//                                REPORTS both and filters on neither, so filtering here would invent a NARROWER
//                                eligibility rule than either the legacy path or the established authority. This
//                                migration preserves semantics; it does not tighten them either.
//
// NO SECURITY IS CONFERRED. Being assignable is not permission to act: every governed command still checks its own
// capability. Visibility here reuses employee.record.read, the same business visibility as the Employee directory.
import {
  acceptOnly, decodeEmployeeCursor, encodeEmployeeCursor, refuse, requirePageSize, runEmployeeRead,
  type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import { EMPLOYEE_DIRECTORY_COLUMNS, directoryItemOf, type EmployeeDirectoryItem } from "./employeeRecordProjection";
import { EMPLOYEE_RECORD_READ } from "./employeeDirectoryReads";
import { WORK_ELIGIBILITY_CODES, isWorkEligibilityCode, type WorkEligibilityCode } from "../workEligibilityVocabulary";
import { OPERATIONAL_SCOPE_TYPES } from "../operationalScopeVocabulary";

/**
 * The employment lifecycle values this OPERATION treats as assignable.
 *
 * Exactly the legacy query's rule, preserved deliberately. Not a schema fact, not reusable as "eligibility" by any
 * other operation, and not widened by a migration.
 */
export const ASSIGNABLE_EMPLOYMENT_STATUSES = Object.freeze(["ACTIVE"] as const);

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

export interface AssignableEmployeesResult {
  readonly qualificationCode: WorkEligibilityCode;
  /** The warehouse the caller required scope for, or null when the workflow required none. */
  readonly scopedToWarehouseId: string | null;
  readonly items: EmployeeDirectoryItem[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

/**
 * Employees who may currently be offered work of `qualificationCode`.
 *
 * `warehouseId` is OPTIONAL and adds the third predicate: a current governed WAREHOUSE Operational Scope for that
 * exact warehouse. It is passed only by a workflow that is genuinely about one warehouse. The three predicates are
 * independently load-bearing -- an Employee missing any one of them does not appear -- and each is read from its own
 * authority, never derived from another.
 */
export function listAssignableEmployees(
  deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>,
): Promise<AssignableEmployeesResult> {
  const scope = "assignable-employees";
  return runEmployeeRead(deps, actor,
    () => {
      acceptOnly(input, ["qualificationCode", "warehouseId", "limit", "cursor"]);
      const code = input?.qualificationCode;
      if (!isWorkEligibilityCode(code)) {
        refuse("WORK_ELIGIBILITY_CODE_INVALID", "INVALID_INPUT", `qualificationCode must be one of ${WORK_ELIGIBILITY_CODES.join(", ")}`);
      }
      const warehouseId = input?.warehouseId;
      if (warehouseId !== undefined && warehouseId !== null && !ID_SHAPE(warehouseId)) {
        refuse("WAREHOUSE_ID_INVALID", "INVALID_INPUT", "warehouseId must be a governed warehouse id");
      }
      return {
        code: code as WorkEligibilityCode,
        warehouseId: ID_SHAPE(warehouseId) ? warehouseId : null,
        limit: requirePageSize(input?.limit),
        cursor: decodeEmployeeCursor(scope, input?.cursor),
      };
    },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, p) => {
      // QUALIFICATION: a CURRENT row for this exact code. An ended qualification is not a qualification.
      const qualified = `EXISTS (SELECT 1 FROM eos_workforce.employee_work_eligibility q
                                  WHERE q.tenant_id = e.tenant_id AND q.employee_id = e.id
                                    AND q.qualification_code = $2 AND q.effective_to IS NULL)`;
      // ACCOUNT: work is assigned to someone who can log in and act on it. ALWAYS applied, never optional, and
      // ACTIVE-only -- the table keeps revoked links as history and a revoked link is not a login.
      const linked = `EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                               WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active')`;
      // SCOPE: only when the workflow named a warehouse. Never added because the Employee happens to be qualified.
      //
      // Null-guarded rather than omitted, so $5 is always bound: a predicate built by string concatenation that
      // sometimes drops a placeholder is how a parameter-count mismatch becomes a runtime-only failure.
      const scoped = `($5::text IS NULL OR EXISTS (SELECT 1 FROM eos_workforce.employee_operational_scopes s
                               WHERE s.tenant_id = e.tenant_id AND s.employee_id = e.id
                                 AND s.scope_type = '${OPERATIONAL_SCOPE_TYPES[0]}' AND s.scope_id = $5
                                 AND s.effective_to IS NULL))`;
      const predicates = [
        `e.tenant_id = $1`,
        // Compared as TEXT, matching employeeDirectoryReads: the enum type lives in the eos_workforce schema and
        // naming it unqualified here would depend on a search_path this read deliberately does not set.
        `e.employment_status::text = ANY($3::text[])`,
        qualified,
        linked,
        scoped,
        `($4::text IS NULL OR e.id > $4::text)`,
      ];
      const { rows } = await db.query(
        `SELECT ${EMPLOYEE_DIRECTORY_COLUMNS} FROM eos_workforce.employees e
          WHERE ${predicates.join(" AND ")}
          ORDER BY e.id ASC LIMIT ${p.limit + 1}`,
        [tenantId, p.code, [...ASSIGNABLE_EMPLOYMENT_STATUSES], p.cursor?.id ?? null, p.warehouseId],
      );
      const truncated = rows.length > p.limit;
      const kept = rows.slice(0, p.limit);
      const last = kept[kept.length - 1];
      return {
        qualificationCode: p.code,
        scopedToWarehouseId: p.warehouseId,
        items: kept.map(directoryItemOf),
        truncated,
        nextCursor: truncated && last ? encodeEmployeeCursor(scope, { number: last.id, id: last.id }) : null,
      };
    });
}
