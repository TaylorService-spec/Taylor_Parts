// The CURRENT Functional Roles of one Employee -- the one place that knows how "currently holds" is computed.
//
// Here, beside contextualAuthorization's eligibility/scope readers, because eosOps is where the RUNTIME reads the
// eos_workforce authority tables; the Workforce read layer stays private to its transport.
//
// CURRENT = the assignment has started and not ended (effective_from <= now < effective_to, or open), AND the catalog
// entry is ACTIVE (defence in depth: deactivation is already refused while a holder exists). A scheduled or ended
// assignment is history, never a fact the workflow engine may rely on.
//
// Consumers (both READ ONLY, neither derives a capability):
//   explainEffectiveAccess            shows them as an EMPLOYEE FACT (employeeFacts.functionalRoles)
//   the workflow engine               a FUNCTIONAL_ROLE binding NARROWS an action (workflowEngine.authorizeWorkflowAction)
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export interface CurrentFunctionalRole {
  readonly functionalRoleId: string;
  readonly key: string;
  readonly name: string;
  readonly assignmentId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export const CURRENT_FUNCTIONAL_ROLE_PREDICATE = `a.effective_from <= now() AND (a.effective_to IS NULL OR a.effective_to > now()) AND r.status = 'ACTIVE'`;

export async function listCurrentFunctionalRoles(db: Queryable, tenantId: string, employeeId: string): Promise<readonly CurrentFunctionalRole[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.functional_role_id, a.effective_from, a.effective_to, r.key, r.name
       FROM eos_workforce.employee_functional_role_assignments a
       JOIN eos_workforce.functional_roles r ON r.tenant_id = a.tenant_id AND r.id = a.functional_role_id
      WHERE a.tenant_id = $1 AND a.employee_id = $2 AND ${CURRENT_FUNCTIONAL_ROLE_PREDICATE}
      ORDER BY r.key`,
    [tenantId, employeeId],
  );
  return rows.map((r) => Object.freeze({
    functionalRoleId: String(r.functional_role_id), key: String(r.key), name: String(r.name), assignmentId: String(r.id),
    effectiveFrom: (r.effective_from as Date).toISOString(), effectiveTo: r.effective_to ? (r.effective_to as Date).toISOString() : null,
  }));
}

/** What the workflow engine asks: the acting Principal's linked Employee, and the Functional Roles it holds now. */
export interface WorkflowFunctionalRoleFacts {
  currentFunctionalRoles(): Promise<{ readonly employeeId: string | null; readonly functionalRoleIds: readonly string[] }>;
}

/**
 * The PostgreSQL facts for ONE acting Principal. The Employee is found through the ACTIVE principal link only -- the
 * Principal id never stands in for an Employee id -- and a Principal with no link holds no Functional Role.
 */
export function postgresWorkflowFunctionalRoleFacts(db: Queryable, tenantId: string, principalId: string): WorkflowFunctionalRoleFacts {
  return {
    async currentFunctionalRoles() {
      const link = await db.query(
        `SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`,
        [tenantId, principalId],
      );
      const employeeId = link.rows.length === 1 ? String(link.rows[0].employee_id) : null;
      if (!employeeId) return { employeeId: null, functionalRoleIds: [] };
      const current = await listCurrentFunctionalRoles(db, tenantId, employeeId);
      return { employeeId, functionalRoleIds: current.map((c) => c.functionalRoleId) };
    },
  };
}
