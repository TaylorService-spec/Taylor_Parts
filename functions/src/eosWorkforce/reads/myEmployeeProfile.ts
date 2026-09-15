// EMP-RT-07 readMyEmployeeProfile -- the caller's OWN Employee, resolved the one governed way.
//
//   CREDENTIAL -> PRINCIPAL -> EMPLOYEE LINK -> EMPLOYEE      (#185; migration 019's header)
//
// The transport resolves the Credential to an EOS Principal (resolveOperationalContext). This read takes that
// Principal id and NOTHING about the credential: it joins eos_policy.employee_principal_links (migration 008) on
// (tenant_id = actor tenant, principal_id = actor Principal, status = 'active'), then eos_workforce.employees
// (migration 019) on (tenant_id = actor tenant, id = link.employee_id). It never matches an Employee by external
// subject, Firebase uid, technician id or Principal id, so an Employee whose id happens to equal a subject or a
// Principal id is not thereby "you".
//
// CAPABILITY. None beyond an active resolved Principal with an active tenant membership and exactly one governed
// active link: this read returns ONLY the caller's own Employee and accepts no selector, so it cannot reach anyone
// else's. It is not a general Employee read and confers none (EMP-RT-01 stays blocked on a missing capability).
//
// FAIL CLOSED:
//   no active link in this tenant                    -> 404 EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND
//   more than one active link (either direction)     -> 409 EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS
//   the linked Employee is not this tenant's          -> 412 EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED
// Every lifecycle status resolves: a TERMINATED or RETIRED Employee is still that person, and eligibility is a policy
// layer's answer, not this read's.
//
// WHAT POSTGRESQL DOES NOT HOLD. eos_workforce.employees carries id, tenant, lifecycle status and operating company
// only (migration 019). Every other profile fact the Firestore Employee record carries
// (access/employeeProfileCommands.ts EDITABLE_EMPLOYEE_FIELDS) is named in `factsNotInPostgres` rather than read from
// anywhere else -- there is no Firestore fallback. eos_policy.principals.display_name is an identity fact about the
// Principal, not the Employee's name, and is deliberately not offered as one.
import {
  acceptOnly, isoOf, refuse, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";

export const EMPLOYEE_FACT_NOT_IN_POSTGRES = "EMPLOYEE_FACT_NOT_IN_POSTGRES";

/** Firestore-only Employee profile facts: no PostgreSQL column holds any of them. */
export const EMPLOYEE_FACTS_NOT_IN_POSTGRES = Object.freeze([
  "displayName", "firstName", "middleName", "lastName", "preferredName", "employeeNumber", "workEmail", "workPhone",
  "mobilePhone", "address", "jobTitle", "managerEmployeeId", "hireDate", "separationDate", "operationalRoles",
] as const);

export interface MyEmployeeProfile {
  readonly employee: {
    readonly employeeId: string;
    readonly employmentStatus: string;
    readonly operatingCompanyId: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  /** The governed Employee <-> Principal link that resolved this Employee. Provenance only. */
  readonly principalLink: {
    readonly linkId: string;
    readonly principalId: string;
    readonly linkSource: string;
    readonly linkedAt: string;
    readonly assertedBy: string | null;
  };
  readonly factsNotInPostgres: { readonly code: typeof EMPLOYEE_FACT_NOT_IN_POSTGRES; readonly facts: readonly string[] };
}

export function readMyEmployeeProfile(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<MyEmployeeProfile> {
  return runEmployeeRead(deps, actor, () => acceptOnly(input, []), () => [],
    async (db, tenantId, principalId) => {
      const links = await db.query(
        `SELECT l.id, l.principal_id, l.employee_id, l.link_source, l.created_at, l.asserted_by
           FROM eos_policy.employee_principal_links l
          WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'
          ORDER BY l.id
          LIMIT 2`,
        [tenantId, principalId],
      );
      if (links.rows.length === 0) refuse("EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND", "NOT_FOUND", "no governed Employee link exists for this principal in this tenant");
      if (links.rows.length > 1) refuse("EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS", "CONFLICT", "the principal has more than one active Employee link");
      const link = links.rows[0];
      const reverse = await db.query(
        `SELECT count(*)::int AS n FROM eos_policy.employee_principal_links
          WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`,
        [tenantId, link.employee_id],
      );
      if (reverse.rows[0].n !== 1) refuse("EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS", "CONFLICT", "the linked Employee has more than one active principal link");
      const employees = await db.query(
        `SELECT e.id, e.employment_status::text AS employment_status, e.operating_company_id, e.created_at, e.updated_at
           FROM eos_workforce.employees e
          WHERE e.tenant_id = $1 AND e.id = $2`,
        [tenantId, link.employee_id],
      );
      if (employees.rows.length === 0) refuse("EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED", "PRECONDITION_FAILED", "the linked Employee does not resolve in this tenant");
      const e = employees.rows[0];
      return {
        employee: {
          employeeId: e.id, employmentStatus: e.employment_status, operatingCompanyId: e.operating_company_id,
          createdAt: isoOf(e.created_at)!, updatedAt: isoOf(e.updated_at)!,
        },
        principalLink: {
          linkId: link.id, principalId: link.principal_id, linkSource: link.link_source, linkedAt: isoOf(link.created_at)!,
          assertedBy: link.asserted_by ?? null,
        },
        factsNotInPostgres: { code: EMPLOYEE_FACT_NOT_IN_POSTGRES, facts: [...EMPLOYEE_FACTS_NOT_IN_POSTGRES] },
      };
    });
}
