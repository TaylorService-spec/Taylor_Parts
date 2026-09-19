// Step C: the governed PostgreSQL WORK ELIGIBILITY writers -- an Employee's qualifications.
//
// A qualification answers ONE question: "is this Employee QUALIFIED to perform this kind of operational work?"
// It is NOT a Security Role, NOT a capability, NOT a permission, NOT a Job Role, NOT ownership, NOT an assignment,
// NOT a manager/reporting fact and NOT an operating-company fact. A qualification GRANTS NO APPLICATION ACCESS: it is
// only ever a SECONDARY business restriction layered on top of a security capability, which remains the FIRST boundary.
//
//   assignEmployeeWorkEligibility  { employeeId, qualificationCode, reason? }   open a current qualification
//   endEmployeeWorkEligibility     { employeeId, qualificationCode, reason? }   end the current qualification
//
// Both require admin.employeeWorkEligibility.write (Owner ruling: NOT admin.employeeProfile.write and NOT
// admin.employeeJobRole.write), an ACTIVE Principal and an ACTIVE tenant membership, re-read inside the command's own
// transaction. Caller-supplied tenant, actor, role, capability or audit identity is refused as unknown input.
//
// MULTIPLE CONCURRENT QUALIFICATIONS ARE NORMAL. The vocabulary's two codes are independent; holding one says nothing
// about the other, and an Employee may hold both, one or none. Re-assigning a qualification the Employee already holds
// currently is NO_CHANGE -- it never opens a second row, and it never rewrites the effective_from of the existing one.
//
// NOTHING IS INFERRED. The qualification code arrives from the caller and is checked against the platform vocabulary.
// It is never derived from Job Role, Security Role, title, manager, operating company, uid, assignment, activity,
// permissions or a legacy operationalRoles value. The two legacy values the ruling allows as deterministic migration
// candidates are applied only by the step D/E dry-run tooling, never here.
//
// ONE transaction per command: lock the Employee (actor tenant) -> lock the current row for that code -> decide ->
// write -> ONE audit event -> commit. Any failure -- including the audit insert -- rolls back every effect.
import { randomUUID } from "node:crypto";
import {
  EmployeeCommandError, acceptOnly, appendEmployeeAudit, lockEmployee, optionalReason, refuse, requireId,
  runEmployeeCommand, type EmployeeCommandDeps, type EmployeeCommandActor,
} from "./employeeCommandKernel";
import {
  EMPLOYEE_WORK_ELIGIBILITY_WRITE, WORK_ELIGIBILITY_ASSIGN_ACTION, WORK_ELIGIBILITY_END_ACTION, WORK_ELIGIBILITY_CODES,
  isWorkEligibilityCode, type WorkEligibilityCode,
} from "../workEligibilityVocabulary";

function requireQualificationCode(value: unknown): WorkEligibilityCode {
  if (!isWorkEligibilityCode(value)) {
    refuse("WORK_ELIGIBILITY_CODE_INVALID", "INVALID_INPUT", `qualificationCode must be one of ${WORK_ELIGIBILITY_CODES.join(", ")}`);
  }
  return value as WorkEligibilityCode;
}

/**
 * The partial unique index is the last line of defence against two concurrent assignments of the SAME code. The
 * command pre-empts it by locking the current row, so reaching here means a genuine race, not a duplicate request.
 */
const eligibilityConflict = (_err: { constraint?: string }) =>
  new EmployeeCommandError("WORK_ELIGIBILITY_CONCURRENT_CHANGE", "CONFLICT", "the Employee's qualifications changed concurrently; retry");

export interface WorkEligibilityChangeResult {
  readonly outcome: "ASSIGNED" | "ENDED" | "NO_CHANGE";
  readonly employeeId: string;
  readonly qualificationCode: WorkEligibilityCode;
  readonly qualificationId: string;
}

/**
 * Open a CURRENT qualification for the Employee. Already holding it currently is NO_CHANGE. A previously ended
 * qualification is never reopened -- a new row is appended, so the history keeps both periods.
 */
export function assignEmployeeWorkEligibility(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<WorkEligibilityChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "qualificationCode", "reason"]);
      return { employeeId: requireId(i.employeeId, "employeeId"), code: requireQualificationCode(i.qualificationCode), reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      const { rows } = await db.query(
        `SELECT id FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL FOR UPDATE`,
        [actor.tenantId, p.employeeId, p.code],
      );
      const current = rows[0] as { id: string } | undefined;
      if (current) return { outcome: "NO_CHANGE", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: current.id };
      const id = `ewe_${randomUUID()}`;
      await db.query(
        `INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, actor.tenantId, p.employeeId, p.code, at, actor.principalId, p.reason],
      );
      await appendEmployeeAudit(db, actor.tenantId, actor.principalId, WORK_ELIGIBILITY_ASSIGN_ACTION, p.employeeId,
        null, { qualificationCode: p.code, qualificationId: id }, p.reason, at);
      return { outcome: "ASSIGNED", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: id };
    },
    eligibilityConflict, EMPLOYEE_WORK_ELIGIBILITY_WRITE);
}

/**
 * End the Employee's CURRENT qualification for a code. Not currently holding it is NO_CHANGE -- ending is idempotent,
 * and it never deletes: the ended row stays as history, immutable from then on.
 */
export function endEmployeeWorkEligibility(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<WorkEligibilityChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "qualificationCode", "reason"]);
      return { employeeId: requireId(i.employeeId, "employeeId"), code: requireQualificationCode(i.qualificationCode), reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      const { rows } = await db.query(
        `SELECT id FROM eos_workforce.employee_work_eligibility
          WHERE tenant_id = $1 AND employee_id = $2 AND qualification_code = $3 AND effective_to IS NULL FOR UPDATE`,
        [actor.tenantId, p.employeeId, p.code],
      );
      const current = rows[0] as { id: string } | undefined;
      if (!current) return { outcome: "NO_CHANGE", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: "" };
      await db.query(
        `UPDATE eos_workforce.employee_work_eligibility SET effective_to = $3, ended_by = $4, ended_at = $3
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
        [actor.tenantId, current.id, at, actor.principalId],
      );
      await appendEmployeeAudit(db, actor.tenantId, actor.principalId, WORK_ELIGIBILITY_END_ACTION, p.employeeId,
        { qualificationCode: p.code, qualificationId: current.id }, null, p.reason, at);
      return { outcome: "ENDED", employeeId: p.employeeId, qualificationCode: p.code, qualificationId: current.id };
    },
    eligibilityConflict, EMPLOYEE_WORK_ELIGIBILITY_WRITE);
}
