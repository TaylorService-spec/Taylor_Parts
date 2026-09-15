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
// else's. It is not a general Employee read and confers none (another Employee is EMP-RT-01, under employee.record.read).
//
// FAIL CLOSED:
//   no active link in this tenant                    -> 404 EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND
//   more than one active link (either direction)     -> 409 EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS
//   the linked Employee is not this tenant's          -> 412 EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED
// Every lifecycle status resolves: a TERMINATED or RETIRED Employee is still that person, and eligibility is a policy
// layer's answer, not this read's.
//
// WHAT IT RETURNS. The caller's Employee BUSINESS record (the same projection readEmployee returns: lifecycle, operating
// company, profile facts, current manager) plus the provenance of the caller's own governed link. operationalRoles is not
// migrated and not returned (Owner ruling E); no Job Role is returned (EMP-RT-08 is not implemented).
// eos_policy.principals.display_name is an identity fact about the Principal and is never offered as the Employee's name.
import {
  acceptOnly, isoOf, refuse, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import { CURRENT_MANAGER_JOIN, EMPLOYEE_RECORD_COLUMNS, employeeRecordOf, type EmployeeRecordProjection } from "./employeeRecordProjection";

export interface MyEmployeeProfile {
  readonly employee: EmployeeRecordProjection;
  /** The governed Employee <-> Principal link that resolved this Employee. Provenance only; the caller's own. */
  readonly principalLink: {
    readonly linkId: string;
    readonly principalId: string;
    readonly linkSource: string;
    readonly linkedAt: string;
    readonly assertedBy: string | null;
  };
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
        `SELECT ${EMPLOYEE_RECORD_COLUMNS}
           FROM eos_workforce.employees e
           ${CURRENT_MANAGER_JOIN}
          WHERE e.tenant_id = $1 AND e.id = $2`,
        [tenantId, link.employee_id],
      );
      if (employees.rows.length === 0) refuse("EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED", "PRECONDITION_FAILED", "the linked Employee does not resolve in this tenant");
      return {
        employee: employeeRecordOf(employees.rows[0]),
        principalLink: {
          linkId: link.id, principalId: link.principal_id, linkSource: link.link_source, linkedAt: isoOf(link.created_at)!,
          assertedBy: link.asserted_by ?? null,
        },
      };
    });
}
