// Step C: the governed PostgreSQL WORK ELIGIBILITY reads.
//
// Visibility reuses employee.record.read -- reading which kinds of work an Employee is qualified for is the same
// business visibility as reading the Employee record, so no extra read capability is invented (the Owner ruling
// already settled this for Job Role). Every read is a READ ONLY snapshot through the shared Employee read kernel.
//
//   listEmployeeWorkEligibility         one Employee's CURRENT qualifications (the Administration surface's list)
//   listEmployeeWorkEligibilityHistory  one Employee's full history, newest first; open rows are `current`
//
// A qualification read returns qualification facts ONLY. It names no Security Role, capability, permission, Job Role,
// ownership, assignment, manager or operating-company authority, and it infers nothing -- an Employee with no
// qualifications reads as an empty list, never as a code derived from Job Role, title or a legacy operationalRole.
import {
  acceptOnly, isoOf, refuse, requireEmployeeId, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import { EMPLOYEE_RECORD_READ } from "./employeeDirectoryReads";
import { WORK_ELIGIBILITY_LABEL, type WorkEligibilityCode } from "../workEligibilityVocabulary";

const MAX_HISTORY = 100;

export interface WorkEligibilityItem {
  readonly qualificationId: string;
  readonly qualificationCode: WorkEligibilityCode;
  /** Administration display text for the code. Presentation only -- never a persona and never an authorization fact. */
  readonly label: string;
  readonly current: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reason: string | null;
}

const itemOf = (r: Record<string, unknown>): WorkEligibilityItem => ({
  qualificationId: r.id as string,
  qualificationCode: r.qualification_code as WorkEligibilityCode,
  label: WORK_ELIGIBILITY_LABEL[r.qualification_code as WorkEligibilityCode],
  current: r.effective_to === null,
  effectiveFrom: isoOf(r.effective_from as Date)!,
  effectiveTo: isoOf(r.effective_to as Date | null),
  reason: (r.reason as string | null) ?? null,
});

async function requireEmployee(db: { query: (t: string, v: unknown[]) => Promise<{ rows: unknown[] }> }, tenantId: string, employeeId: string): Promise<void> {
  const { rows } = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
  if (rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
}

/**
 * The Employee's CURRENT qualifications. An Employee may hold several at once, or none -- both are ordinary, and an
 * empty list is a real answer, never a reason to fall back to any other authority.
 */
export function listEmployeeWorkEligibility(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly employeeId: string;
  readonly items: WorkEligibilityItem[];
}> {
  return runEmployeeRead(deps, actor,
    () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, employeeId) => {
      await requireEmployee(db, tenantId, employeeId);
      const { rows } = await db.query(
        `SELECT id, qualification_code, effective_from, effective_to, reason
           FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL
          ORDER BY qualification_code`,
        [tenantId, employeeId],
      );
      return { employeeId, items: rows.map(itemOf) };
    });
}

/** The Employee's full qualification history, newest first. Ended periods are kept: the table refuses DELETE. */
export function listEmployeeWorkEligibilityHistory(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly employeeId: string;
  readonly current: WorkEligibilityItem[];
  readonly items: WorkEligibilityItem[];
  readonly truncated: boolean;
}> {
  return runEmployeeRead(deps, actor,
    () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, employeeId) => {
      await requireEmployee(db, tenantId, employeeId);
      const { rows } = await db.query(
        `SELECT id, qualification_code, effective_from, effective_to, reason
           FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2
          ORDER BY effective_from DESC, id DESC
          LIMIT $3`,
        [tenantId, employeeId, MAX_HISTORY + 1],
      );
      const items = rows.slice(0, MAX_HISTORY).map(itemOf);
      return { employeeId, current: items.filter((i) => i.current), items, truncated: rows.length > MAX_HISTORY };
    });
}
