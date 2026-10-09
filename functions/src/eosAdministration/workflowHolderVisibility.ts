// WHICH ROLE HOLDERS MAY THIS CALLER SEE, AS EMPLOYEES? (W01 holder lookup, 2026-10-09)
//
// listWorkflowActionRoleHolders (adminPolicy/workflowAdminApi.ts) names the Employees who hold a Security Role relevant
// to a workflow action. It must not become a second way to read the Employee directory, so this answers with the
// EXISTING Employee visibility and nothing else: the Workforce read kernel (runEmployeeRead) with employee.record.read,
// decided per operating company for a scoped holder (recordScope "operatingCompany") -- exactly the rule listEmployees
// and the Users roster apply. Composed by the server over the shared pool (src/adminPolicy never touches `pg`).
//
//   - The caller holds employee.record.read (flat): the requested Employees of this tenant are visible.
//   - Only within operating-company scopes: only Employees of those companies, each decided by the kernel.
//   - Not at all (or only behind an unsatisfied condition): NOTHING is visible -- `employeeReadHeld: false`.
//   - Anything else (the store, the context resolution): THROWS, and the lookup refuses. Never an empty answer that
//     would read as "nobody holds this Role".
//
// Returns display names only. Read-only; grants nothing.
import type { Pool } from "pg";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { resolveOperationalContextForPrincipal } from "../eosOps/capabilityAuthority";
import { postgresGrantConditionProvider } from "../eosOps/entitledActionAuthority";
import { EmployeeReadError, runEmployeeRead, type EmployeeReadActor } from "../eosWorkforce/reads/employeeReadKernel";
import { EMPLOYEE_RECORD_READ } from "../eosWorkforce/reads/employeeDirectoryReads";

export interface WorkflowHolderVisibility {
  /** False when the caller holds no usable employee.record.read: then no Employee is visible. */
  readonly employeeReadHeld: boolean;
  /** employeeId -> display name, for the requested Employees the caller may see. */
  readonly visible: ReadonlyMap<string, { readonly displayName: string | null }>;
}

export type WorkflowHolderVisibilityResolver =
  (tenantId: string, callerPrincipalId: string, employeeIds: readonly string[]) => Promise<WorkflowHolderVisibility>;

/** Refusals that mean "this caller may not read Employees" -- an answer (nothing visible), not a failure. */
const NO_EMPLOYEE_READ = new Set(["CAPABILITY_REQUIRED", "CAPABILITY_CONDITION_UNSATISFIED"]);

export function createWorkflowHolderVisibility(reader: PolicyReader, pool: Pool): WorkflowHolderVisibilityResolver {
  return async (tenantId, callerPrincipalId, employeeIds) => {
    const ids = [...new Set(employeeIds.filter((id) => typeof id === "string" && id !== ""))];
    const ctx = await resolveOperationalContextForPrincipal(reader, pool, callerPrincipalId, tenantId, postgresGrantConditionProvider(pool));
    const actor: EmployeeReadActor = Object.freeze({
      tenantId, principalId: callerPrincipalId, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
      scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements,
    });
    try {
      return await runEmployeeRead({ pool }, actor, () => null, () => [EMPLOYEE_RECORD_READ], async (client, tid, _p, _x, reach) => {
        const visible = new Map<string, { displayName: string | null }>();
        if (ids.length === 0) return { employeeReadHeld: true, visible };
        const { rows } = await client.query<{ id: string; display_name: string | null; operating_company_id: string | null }>(
          `SELECT id, display_name, operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[])`,
          [tid, ids],
        );
        for (const r of rows) {
          if (!reach.global) {
            // The kernel's own per-record decision: an out-of-reach Employee is refused exactly like a missing one.
            try { await reach.authorizeEmployee(r.operating_company_id); } catch (err) {
              if (err instanceof EmployeeReadError && (err.code === "EMPLOYEE_NOT_FOUND" || NO_EMPLOYEE_READ.has(err.code))) continue;
              throw err;
            }
          }
          visible.set(r.id, { displayName: r.display_name });
        }
        return { employeeReadHeld: true, visible };
      }, { recordScope: "operatingCompany" });
    } catch (err) {
      if (err instanceof EmployeeReadError && NO_EMPLOYEE_READ.has(err.code)) return { employeeReadHeld: false, visible: new Map() };
      throw err;
    }
  };
}
