// EMP-RT-02 readEmployeePrincipalLink -- ANOTHER Employee's governed Principal linkage, under admin.principalAccess.read
// (Owner ruling B). Never under employee.record.read.
//
// Returns the active eos_policy.employee_principal_links row for this Employee in the actor's tenant, with the linked
// Principal's display name and status and its membership status in this tenant -- the access-state facts
// admin.principalAccess.read already confers. It returns NO external subject, identity provider or Role assignment.
// No active link reads UNLINKED with `link: null`; more than one refuses EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS.
import { acceptOnly, isoOf, refuse, requireEmployeeId, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps } from "./employeeReadKernel";

export const PRINCIPAL_ACCESS_READ = "admin.principalAccess.read";

export interface EmployeePrincipalLinkRead {
  readonly employeeId: string;
  readonly userAccess: "LINKED" | "UNLINKED";
  readonly link: {
    readonly linkId: string;
    readonly principalId: string;
    readonly principalDisplayName: string | null;
    readonly principalStatus: string;
    readonly membershipStatus: string;
    readonly linkSource: string;
    readonly linkedAt: string;
    readonly assertedBy: string | null;
  } | null;
}

export function readEmployeePrincipalLink(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<EmployeePrincipalLinkRead> {
  return runEmployeeRead(deps, actor, () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); }, () => [PRINCIPAL_ACCESS_READ],
    async (db, tenantId, _principalId, employeeId) => {
      const employee = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
      if (employee.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      const { rows } = await db.query(
        `SELECT l.id, l.principal_id, l.link_source, l.created_at, l.asserted_by,
                p.display_name AS principal_display_name, p.status::text AS principal_status, m.status::text AS membership_status
           FROM eos_policy.employee_principal_links l
           JOIN eos_policy.principals p ON p.id = l.principal_id
           JOIN eos_policy.tenant_memberships m ON m.tenant_id = l.tenant_id AND m.principal_id = l.principal_id
          WHERE l.tenant_id = $1 AND l.employee_id = $2 AND l.status = 'active'
          ORDER BY l.id
          LIMIT 2`,
        [tenantId, employeeId],
      );
      if (rows.length > 1) refuse("EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS", "CONFLICT", "the Employee has more than one active principal link");
      if (rows.length === 0) return { employeeId, userAccess: "UNLINKED", link: null };
      const r = rows[0];
      return {
        employeeId,
        userAccess: "LINKED",
        link: {
          linkId: r.id, principalId: r.principal_id, principalDisplayName: r.principal_display_name ?? null, principalStatus: r.principal_status,
          membershipStatus: r.membership_status, linkSource: r.link_source, linkedAt: isoOf(r.created_at)!, assertedBy: r.asserted_by ?? null,
        },
      };
    });
}
