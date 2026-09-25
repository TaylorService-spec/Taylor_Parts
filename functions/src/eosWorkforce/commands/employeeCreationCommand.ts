// THE GOVERNED POSTGRESQL EMPLOYEE CREATION WRITER -- the one permanent way an Employee comes into
// existence in eos_workforce.employees.
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// Before this command the ONLY things that `INSERT INTO eos_workforce.employees` were
// the synthetic nonprod workforce seed and the Sample Company seed under functions/scripts -- two direct-insert
// FIXTURE seeds -- and scripts/provisionEmployeeAccess.js, which writes FIRESTORE. There was a
// governed writer for an Employee's profile facts (employeeProfileCommand.ts), lifecycle facts
// (employeeLifecycleCommand.ts), manager (reportingRelationshipCommands.ts), Job Role
// (employeeJobRoleCommands.ts), qualifications and scopes -- and none at all for the Employee. The
// Owner ruled that a product defect: every governed fact about an Employee had an authority except
// the Employee's own existence, which only a fixture could assert.
//
// ════════════════════ WHAT IT WRITES ════════════════════
//
//   createEmployee { employeeId, employmentStatus, operatingCompanyId, profile?, reason }
//
// ONE row in eos_workforce.employees, in the ACTOR's tenant, plus ONE audit event. The two NOT NULL
// columns migration 1759104000000 deliberately gave no DEFAULT -- `employment_status` and
// `operating_company_id` -- are therefore REQUIRED here and never inferred; that migration's header
// states the reason for the second in so many words ("a DEFAULT lets a writer that never decided a
// company still produce a row that claims one, and after the fact that is indistinguishable from a
// deliberate assignment"), and the first is a LIFECYCLE fact nobody but the caller knows.
//
// `profile` is OPTIONAL and closed to the seventeen profile field keys, normalized by the SAME
// employeeProfileVocabulary the governed profile writer uses (employeeProfileCommand.prepareProfileFields),
// so a created Employee and an edited Employee cannot disagree about what a valid value is. An
// Employee with no profile fact at all is legitimate: this command fabricates no display name, no
// employee number, no hire date and no email.
//
// ════════════════════ CREATING AN EMPLOYEE CREATES NO AUTHORITY ════════════════════
//
// This is the load-bearing prohibition, and it is why the statement list in this file is exactly one
// INSERT into eos_workforce.employees and one audit append. Creating an Employee does NOT create:
//
//   * a Security Role, a Role assignment (eos_policy.user_role_assignments) or a capability grant
//     (eos_policy.role_capabilities, eos_policy.principal_capabilities)
//   * a Principal, a tenant membership, or an Employee<->Principal link
//     (eos_policy.employee_principal_links -- that is linkEmployeePrincipal, a separate command with
//     its own expected-current-value protection)
//   * a Job Role (eos_workforce.employee_job_role_assignments -- that is assignEmployeeJobRole,
//     under admin.employeeJobRole.write, which this command deliberately does not hold and
//     deliberately does not call; a Job Role hidden inside a create would make an Employee's business
//     function a side effect of its existence)
//   * a Work Eligibility (eos_workforce.employee_work_eligibility) or an Operational Scope
//     (eos_workforce.employee_operational_scopes)
//   * a manager / reporting relationship, an ownership row, an accountability row or an assignment
//
// A new Employee therefore exists, can be read, and can do NOTHING. Every one of those facts is
// added afterwards by the authority that owns it, each with its own capability and its own audit
// event. That is the whole design: existence is not authority.
//
// ════════════════════ DUPLICATES ARE REFUSED, NOT ABSORBED ════════════════════
//
// An `employeeId` that already names a row REFUSES with EMPLOYEE_ALREADY_EXISTS (CONFLICT). It is
// NOT idempotent, and the choice is deliberate:
//
//   * `employees.id` is a GLOBAL PRIMARY KEY, not a tenant-scoped one (migration 1759104000000: the
//     bare-id key is what the resolution lookup uses). An id already taken in ANOTHER tenant is not
//     "the same Employee submitted twice", it is a different person entirely -- and a create that
//     absorbed it would have to either write across a tenant boundary or lie about having written.
//   * "Idempotent" would have to mean "the stored row already equals the requested one" over two
//     lifecycle facts and seventeen nullable profile columns. Any drift in any one of them -- a
//     display name corrected last week -- makes a resubmitted create either a silent failure or a
//     silent overwrite. A create that overwrites is a generic patch with a friendlier name.
//   * The governed way to change an existing Employee already exists and is audited as a change:
//     updateEmployeeProfile, changeEmploymentStatus, changeOperatingCompany. A caller that meant to
//     change one should be told so, by name.
//
// The pre-check is a locked SELECT, and the PRIMARY KEY is the last line of defence for a genuine
// race, mapped to the SAME refusal so a concurrent create and a resubmitted one read alike.
//
// ════════════════════ AUTHORITY ════════════════════
//
// `admin.employeeProfile.write` -- the EXISTING capability the catalog describes as "Edit an
// Employee's profile and employment record", held today by the `admin` and `owner` Security Roles.
// NO CAPABILITY IS ADDED BY THIS LANE (Owner: "Do not change capability authority in this wave"), so
// nonprod stays at 79 capabilities / 413 role_capabilities. An ACTIVE Principal with an ACTIVE
// membership in the actor's tenant, re-read inside the command's own transaction by the shared
// kernel. DIRECT Principal grants count (withDirectCapabilityGrants); Firebase is nowhere in this
// decision.
import type { PoolClient } from "pg";
import {
  EmployeeCommandError, acceptOnly, appendEmployeeAudit, refuse, requireId, runEmployeeCommand,
  EMPLOYEE_PROFILE_WRITE, type EmployeeCommandActor, type EmployeeCommandDeps,
} from "./employeeCommandKernel";
import { prepareProfileFields, type ProfileFieldValues } from "./employeeProfileCommand";
import { EMPLOYMENT_STATUS_VALUES } from "../../employeeIdentity/employeeAuthority";
import { withDirectCapabilityGrants } from "./employeeAdministrationAuthority";
import { requireGovernedReason } from "./employeeAdministrationInput";

export const EMPLOYEE_CREATE_ACTION = "employee.record.create";

/** The same slug shape employees_operating_company_shape accepts, and the same one the lifecycle writer checks. */
const COMPANY_ID_SHAPE = /^[a-z][a-z0-9_-]{1,62}$/;

export interface EmployeeCreationResult {
  readonly outcome: "CREATED";
  readonly employeeId: string;
  readonly employmentStatus: string;
  readonly operatingCompanyId: string;
  /** The profile field keys this creation actually stated, in the fixed vocabulary order. Never fabricated. */
  readonly profileFields: readonly string[];
  readonly auditEventId: string;
  /**
   * What a created Employee deliberately has NONE of. Returned so a caller (and the operator
   * wrapper's report) reads the prohibition as an assertion rather than having to trust a comment.
   */
  readonly grantedAuthority: readonly [];
}

/**
 * A unique violation the body did not pre-empt. Only three unique constraints can fire on this
 * INSERT, and each one is a caller-visible refusal rather than an internal failure.
 */
const creationConflict = (err: { constraint?: string }) =>
  err.constraint === "employees_employee_number_unique_per_tenant"
    ? new EmployeeCommandError("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number")
    : new EmployeeCommandError("EMPLOYEE_ALREADY_EXISTS", "CONFLICT",
      "an Employee with that id already exists; creating one never changes an existing Employee");

interface PreparedCreation {
  readonly employeeId: string;
  readonly employmentStatus: string;
  readonly operatingCompanyId: string;
  readonly profile: ProfileFieldValues;
  readonly reason: string;
}

/** Validate a creation input. Pure; runs before any connection is opened. */
export function prepareEmployeeCreation(input: Record<string, unknown>): PreparedCreation {
  const i = acceptOnly(input, ["employeeId", "employmentStatus", "operatingCompanyId", "profile", "reason"]);
  if (typeof i.employmentStatus !== "string" || !(EMPLOYMENT_STATUS_VALUES as readonly string[]).includes(i.employmentStatus)) {
    refuse("EMPLOYMENT_STATUS_INVALID", "INVALID_INPUT", `employmentStatus is required and must be one of ${EMPLOYMENT_STATUS_VALUES.join(", ")}`);
  }
  if (typeof i.operatingCompanyId !== "string" || !COMPANY_ID_SHAPE.test(i.operatingCompanyId)) {
    refuse("OPERATING_COMPANY_INVALID", "INVALID_INPUT", "operatingCompanyId is required and must be a well-formed operating company id");
  }
  return {
    employeeId: requireId(i.employeeId, "employeeId"),
    employmentStatus: i.employmentStatus as string,
    operatingCompanyId: i.operatingCompanyId as string,
    // An absent `profile` is an Employee with no profile fact, which is legitimate. A PRESENT but
    // empty one is accepted as the same thing rather than refused: the caller said "no facts" twice.
    profile: prepareProfileFields(i.profile === undefined ? {} : i.profile, { allowEmpty: true }),
    reason: requireGovernedReason(i.reason),
  };
}

async function assertOperatingCompanyAuthorized(db: PoolClient, tenantId: string, companyId: string): Promise<void> {
  // The SAME tenant-scoped governed authority changeOperatingCompany checks (Owner ruling (b),
  // 2026-09-16): a code-recognised id is not enough, the company must be ACTIVE for THIS tenant.
  const { rows } = await db.query(
    `SELECT status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 FOR SHARE`,
    [tenantId, companyId],
  );
  if (rows.length === 0) {
    refuse("OPERATING_COMPANY_NOT_AUTHORIZED_FOR_TENANT", "PRECONDITION_FAILED", "the operating company is not authorized for this tenant");
  }
  if (rows[0].status !== "ACTIVE") refuse("OPERATING_COMPANY_INACTIVE", "PRECONDITION_FAILED", "the operating company is inactive for this tenant");
}

/**
 * Create ONE Employee in the actor's tenant.
 *
 * One transaction: the id must be free (locked read over the GLOBAL key) -> the operating company
 * must be ACTIVE for this tenant -> the employee number, if stated, must be free in this tenant
 * (case-insensitively, exactly as the profile writer checks it) -> INSERT -> ONE audit event ->
 * COMMIT. Any failure, including the audit insert, rolls back the Employee with it.
 */
export async function createEmployee(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<EmployeeCreationResult> {
  const effective = await withDirectCapabilityGrants(deps.pool, actor, EMPLOYEE_PROFILE_WRITE);
  return runEmployeeCommand(deps, effective,
    () => prepareEmployeeCreation(input),
    async (db, p, at) => {
      // THE GLOBAL KEY, READ GLOBALLY. `employees.id` is the PRIMARY KEY, so an id taken in another
      // tenant is taken here too; the read says nothing about that other tenant beyond "not free".
      const existing = await db.query(`SELECT id FROM eos_workforce.employees WHERE id = $1 FOR UPDATE`, [p.employeeId]);
      if (existing.rows.length > 0) {
        refuse("EMPLOYEE_ALREADY_EXISTS", "CONFLICT",
          "an Employee with that id already exists; use updateEmployeeProfile, changeEmploymentStatus or changeOperatingCompany to change one");
      }
      await assertOperatingCompanyAuthorized(db, effective.tenantId, p.operatingCompanyId);

      const stated = [...p.profile].filter(([, c]) => c.value !== null);
      const number = p.profile.get("employeeNumber")?.value ?? null;
      if (number) {
        const held = await db.query(
          `SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND upper(employee_number) = upper($2)`,
          [effective.tenantId, number],
        );
        if (held.rows.length > 0) refuse("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number");
      }

      const columns = ["id", "tenant_id", "employment_status", "operating_company_id", "created_at", "updated_at",
        ...stated.map(([, c]) => c.column)];
      const values = [p.employeeId, effective.tenantId, p.employmentStatus, p.operatingCompanyId, at, at,
        ...stated.map(([, c]) => c.value)];
      await db.query(
        `INSERT INTO eos_workforce.employees (${columns.join(", ")})
         VALUES ($1, $2, $3::eos_workforce.workforce_employment_status, $4, $5, $6${stated.map((_, i) => `, $${i + 7}`).join("")})`,
        values,
      );
      const after: Record<string, string | null> = {
        employmentStatus: p.employmentStatus, operatingCompanyId: p.operatingCompanyId,
        ...Object.fromEntries(stated.map(([key, c]) => [key, c.value])),
      };
      // before is NULL, which is what "this Employee did not exist" looks like in the audit trail.
      const auditEventId = await appendEmployeeAudit(
        db, effective.tenantId, effective.principalId, EMPLOYEE_CREATE_ACTION, p.employeeId, null, after, p.reason, at);
      return {
        outcome: "CREATED" as const,
        employeeId: p.employeeId,
        employmentStatus: p.employmentStatus,
        operatingCompanyId: p.operatingCompanyId,
        profileFields: stated.map(([key]) => key),
        auditEventId,
        grantedAuthority: Object.freeze([]) as readonly [],
      };
    },
    creationConflict, EMPLOYEE_PROFILE_WRITE);
}
