// EMP-RT-W2: the governed PostgreSQL Employee LIFECYCLE writer -- employment status and operating company.
//
// The lifecycle facts on eos_workforce.employees that the profile writer (W1A) deliberately refuses. Separate command,
// separate audit actions, same authority path: resolved EOS actor holding admin.employeeProfile.write (the capability
// the catalog describes as "Edit an Employee's profile and employment record", and the one the legacy Firestore command
// used for these two fields), ACTIVE Principal + ACTIVE membership re-checked inside the transaction.
//
// ════════════════════ WHAT IT CHANGES ════════════════════
//
//   changeEmploymentStatus   { employeeId, employmentStatus, reason? }   only along EMPLOYMENT_STATUS_TRANSITIONS
//   changeOperatingCompany   { employeeId, operatingCompanyId, reason? } only to a company ACTIVE and authorized for the
//                                                                          Employee's tenant (eos_policy.tenant_operating_companies)
//
// Nothing else: no profile fact, manager, Security Role, Job Role, User Access, ownership, accountability, assignment,
// credential or Firebase record. A caller-supplied actor, tenant, role, capability, company authority or audit identity
// is refused as unknown input. No generic patch.
//
// ════════════════════ OWNER RULINGS (2026-09-16) ════════════════════
//
//   * Transitions, option (a): LEGACY PARITY. EMPLOYMENT_STATUS_TRANSITIONS lets every canonical status move to every
//     OTHER canonical status. It is the ONE place a future lifecycle policy tightens the matrix; no restriction (e.g.
//     TERMINATED/RETIRED irreversible) is assumed before the Owner adopts it.
//   * Operating company, option (b): TENANT-SCOPED governed PostgreSQL authority. A code-recognised id is not enough;
//     the target must have an ACTIVE eos_policy.tenant_operating_companies row for the ACTOR's tenant (read FOR SHARE in
//     the same transaction). Not linked -- unknown, or linked only to another tenant -- and INACTIVE both fail closed.
//
// ════════════════════ TRANSACTION ════════════════════
//
// lock Employee (actor tenant) -> read current -> validate -> update + updated_at -> one audit event -> commit. The same
// value is NO_CHANGE: nothing written, nothing audited. Any failure rolls back every effect.
import type { PoolClient } from "pg";
import {
  acceptOnly, appendEmployeeAudit, lockEmployee, optionalReason, refuse, requireId, runEmployeeCommand,
  EmployeeCommandError, type EmployeeCommandActor, type EmployeeCommandDeps,
} from "./employeeCommandKernel";
import { EMPLOYMENT_STATUS_VALUES } from "../../employeeIdentity/employeeAuthority";

export type EmploymentStatus = (typeof EMPLOYMENT_STATUS_VALUES)[number];

export const EMPLOYMENT_STATUS_CHANGE_ACTION = "employee.employmentStatus.change";
export const OPERATING_COMPANY_CHANGE_ACTION = "employee.operatingCompany.change";

/** from -> allowed targets. Owner ruling (a), LEGACY PARITY: every canonical status to every other canonical status. */
export const EMPLOYMENT_STATUS_TRANSITIONS: Readonly<Record<EmploymentStatus, readonly EmploymentStatus[]>> = Object.freeze(
  Object.fromEntries(EMPLOYMENT_STATUS_VALUES.map((from) => [from, Object.freeze(EMPLOYMENT_STATUS_VALUES.filter((to) => to !== from))])) as
    Record<EmploymentStatus, readonly EmploymentStatus[]>,
);

export interface EmployeeLifecycleChangeResult {
  readonly outcome: "CHANGED" | "NO_CHANGE";
  readonly employeeId: string;
  readonly previous: string;
  readonly current: string;
  readonly auditEventId: string | null;
}

const isStatus = (v: unknown): v is EmploymentStatus => typeof v === "string" && (EMPLOYMENT_STATUS_VALUES as readonly string[]).includes(v);

async function lockedLifecycle(db: PoolClient, tenantId: string, employeeId: string) {
  await lockEmployee(db, tenantId, employeeId);
  const { rows } = await db.query(
    `SELECT employment_status::text AS employment_status, operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`,
    [tenantId, employeeId],
  );
  return rows[0] as { employment_status: string; operating_company_id: string };
}

const COMPANY_ID_SHAPE = /^[a-z][a-z0-9_-]{1,62}$/;

const noUniqueConstraint = () => new EmployeeCommandError("COMMAND_FAILED", "FAILED", "the command could not be completed");

/** Change an Employee's employment status along an allowed transition. */
export function changeEmploymentStatus(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<EmployeeLifecycleChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "employmentStatus", "reason"]);
      if (!isStatus(i.employmentStatus)) {
        refuse("EMPLOYMENT_STATUS_INVALID", "INVALID_INPUT", `employmentStatus must be one of ${EMPLOYMENT_STATUS_VALUES.join(", ")}`);
      }
      return { employeeId: requireId(i.employeeId, "employeeId"), status: i.employmentStatus as EmploymentStatus, reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      const current = await lockedLifecycle(db, actor.tenantId, p.employeeId);
      const from = current.employment_status as EmploymentStatus;
      if (from === p.status) return { outcome: "NO_CHANGE", employeeId: p.employeeId, previous: from, current: from, auditEventId: null };
      if (!EMPLOYMENT_STATUS_TRANSITIONS[from]?.includes(p.status)) {
        refuse("EMPLOYMENT_STATUS_TRANSITION_NOT_ALLOWED", "PRECONDITION_FAILED", `${from} -> ${p.status} is not an allowed employment status transition`);
      }
      await db.query(
        `UPDATE eos_workforce.employees SET employment_status = $3::eos_workforce.workforce_employment_status, updated_at = $4 WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, p.employeeId, p.status, at],
      );
      const auditEventId = await appendEmployeeAudit(db, actor.tenantId, actor.principalId, EMPLOYMENT_STATUS_CHANGE_ACTION, p.employeeId,
        { employmentStatus: from }, { employmentStatus: p.status }, p.reason, at);
      return { outcome: "CHANGED", employeeId: p.employeeId, previous: from, current: p.status, auditEventId };
    },
    noUniqueConstraint);
}

/** Move an Employee to a governed, active operating company. */
export function changeOperatingCompany(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<EmployeeLifecycleChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "operatingCompanyId", "reason"]);
      if (typeof i.operatingCompanyId !== "string" || !COMPANY_ID_SHAPE.test(i.operatingCompanyId)) {
        refuse("OPERATING_COMPANY_INVALID", "INVALID_INPUT", "operatingCompanyId must be a well-formed operating company id");
      }
      return { employeeId: requireId(i.employeeId, "employeeId"), companyId: i.operatingCompanyId as string, reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      const current = await lockedLifecycle(db, actor.tenantId, p.employeeId);
      const link = await db.query(
        `SELECT status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 FOR SHARE`,
        [actor.tenantId, p.companyId],
      );
      if (link.rows.length === 0) {
        refuse("OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT", "PRECONDITION_FAILED", "the operating company is not authorized for this tenant");
      }
      if (link.rows[0].status !== "ACTIVE") refuse("OPERATING_COMPANY_INACTIVE", "PRECONDITION_FAILED", "the operating company is inactive for this tenant");
      const from = current.operating_company_id;
      if (from === p.companyId) return { outcome: "NO_CHANGE", employeeId: p.employeeId, previous: from, current: from, auditEventId: null };
      await db.query(
        `UPDATE eos_workforce.employees SET operating_company_id = $3, updated_at = $4 WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, p.employeeId, p.companyId, at],
      );
      const auditEventId = await appendEmployeeAudit(db, actor.tenantId, actor.principalId, OPERATING_COMPANY_CHANGE_ACTION, p.employeeId,
        { operatingCompanyId: from }, { operatingCompanyId: p.companyId }, p.reason, at);
      return { outcome: "CHANGED", employeeId: p.employeeId, previous: from, current: p.companyId, auditEventId };
    },
    noUniqueConstraint);
}
