// Step C: the governed PostgreSQL OPERATIONAL SCOPE reads.
//
// Visibility reuses employee.record.read, for the same reason Job Role and Work Eligibility do: reading which
// warehouses an Employee covers is the same business visibility as reading the Employee record. Every read is a
// READ ONLY snapshot through the shared Employee read kernel.
//
//   listEmployeeOperationalScopes         one Employee's CURRENT scopes (the Administration surface's list)
//   listEmployeeOperationalScopeHistory   one Employee's full history, newest first; open rows are `current`
//
// A scope read returns scope facts ONLY. It names no Security Role, capability, permission, Job Role, qualification,
// ownership, assignment, manager or operating-company authority. It infers nothing: an Employee with no scopes reads
// as an empty list, never as a warehouse derived from a legacy role string, Job Role, manager or operating company.
//
// WHY THE WAREHOUSE STATUS IS RETURNED. A scope assigned while its warehouse was ACTIVE stays recorded if that
// warehouse is later deactivated -- the command deliberately performs no silent revocation. Surfacing
// `warehouseStatus` is what lets Administration SEE that remediation case instead of it hiding behind a name. The
// status is reported, never enforced here; a read decides nothing.
import {
  acceptOnly, isoOf, refuse, requireEmployeeId, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import { EMPLOYEE_RECORD_READ } from "./employeeDirectoryReads";
import { OPERATIONAL_SCOPE_TYPE_LABEL, type OperationalScopeType } from "../operationalScopeVocabulary";

const MAX_HISTORY = 100;

export interface OperationalScopeItem {
  readonly operationalScopeId: string;
  readonly scopeType: OperationalScopeType;
  readonly scopeId: string;
  /** Presentation only. The scope target's governed name, joined for display -- never matched on, never identity. */
  readonly scopeName: string;
  readonly scopeTypeLabel: string;
  /** ACTIVE or INACTIVE. Reported so Administration can see a scope whose warehouse was deactivated afterwards. */
  readonly warehouseStatus: string;
  readonly current: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reason: string | null;
}

const itemOf = (r: Record<string, unknown>): OperationalScopeItem => ({
  operationalScopeId: r.id as string,
  scopeType: r.scope_type as OperationalScopeType,
  scopeId: r.scope_id as string,
  scopeName: (r.warehouse_name as string | null) ?? (r.scope_id as string),
  scopeTypeLabel: OPERATIONAL_SCOPE_TYPE_LABEL[r.scope_type as OperationalScopeType],
  warehouseStatus: (r.warehouse_status as string | null) ?? "UNKNOWN",
  current: r.effective_to === null,
  effectiveFrom: isoOf(r.effective_from as Date)!,
  effectiveTo: isoOf(r.effective_to as Date | null),
  reason: (r.reason as string | null) ?? null,
});

// The join is tenant-safe on BOTH columns, matching the table's composite foreign key. LEFT, not INNER: a read must
// still report a scope row even if its target somehow cannot be resolved, rather than silently dropping it.
const SCOPE_SELECT = `SELECT s.id, s.scope_type, s.scope_id, s.effective_from, s.effective_to, s.reason,
                             w.name AS warehouse_name, w.status::text AS warehouse_status
                        FROM eos_workforce.employee_operational_scopes s
                        LEFT JOIN eos_ops.warehouses w ON w.tenant_id = s.tenant_id AND w.id = s.scope_id`;

async function requireEmployee(db: { query: (t: string, v: unknown[]) => Promise<{ rows: unknown[] }> }, tenantId: string, employeeId: string): Promise<void> {
  const { rows } = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
  if (rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
}

/** The Employee's CURRENT operational scopes. Several concurrent warehouses are ordinary; none is equally ordinary. */
export function listEmployeeOperationalScopes(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly employeeId: string;
  readonly items: OperationalScopeItem[];
}> {
  return runEmployeeRead(deps, actor,
    () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, employeeId) => {
      await requireEmployee(db, tenantId, employeeId);
      const { rows } = await db.query(
        `${SCOPE_SELECT} WHERE s.tenant_id = $1 AND s.employee_id = $2 AND s.effective_to IS NULL
          ORDER BY s.scope_type, lower(coalesce(w.name, s.scope_id)), s.scope_id`,
        [tenantId, employeeId],
      );
      return { employeeId, items: rows.map(itemOf) };
    });
}

/** The Employee's full scope history, newest first. Ended periods are kept: the table refuses DELETE. */
export function listEmployeeOperationalScopeHistory(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly employeeId: string;
  readonly current: OperationalScopeItem[];
  readonly items: OperationalScopeItem[];
  readonly truncated: boolean;
}> {
  return runEmployeeRead(deps, actor,
    () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, employeeId) => {
      await requireEmployee(db, tenantId, employeeId);
      const { rows } = await db.query(
        `${SCOPE_SELECT} WHERE s.tenant_id = $1 AND s.employee_id = $2
          ORDER BY s.effective_from DESC, s.id DESC LIMIT $3`,
        [tenantId, employeeId, MAX_HISTORY + 1],
      );
      const items = rows.slice(0, MAX_HISTORY).map(itemOf);
      return { employeeId, current: items.filter((i) => i.current), items, truncated: rows.length > MAX_HISTORY };
    });
}
