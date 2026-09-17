// EMP-RT-08: the governed PostgreSQL JOB ROLE reads. Visibility reuses employee.record.read -- reading an Employee's
// business function is the same business visibility as reading the Employee record; no extra read capability is
// invented (Owner ruling). Every read is a READ ONLY snapshot through the shared Employee read kernel.
//
//   listJobRoles                  the tenant catalog, ACTIVE and INACTIVE (history names inactive roles)
//   listEmployeeJobRoleHistory    one Employee's assignments, newest first; the open row is `current`
//   listEmployeesWithoutJobRole   the Administration remediation set: Employees with no current Job Role, plus a count
//
// A Job Role read returns business function only. It names no Security Role, permission, ownership, assignment,
// manager or operating-company authority, and it infers nothing.
import {
  acceptOnly, decodeEmployeeCursor, encodeEmployeeCursor, isoOf, refuse, requireEmployeeId, requirePageSize, runEmployeeRead,
  type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import { EMPLOYEE_DIRECTORY_COLUMNS, directoryItemOf, type EmployeeDirectoryItem } from "./employeeRecordProjection";
import { EMPLOYEE_RECORD_READ } from "./employeeDirectoryReads";
const MAX_CATALOG = 200;
const MAX_HISTORY = 100;

export interface JobRoleItem {
  readonly jobRoleId: string;
  readonly displayName: string;
  readonly status: string;
}

export function listJobRoles(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{ readonly items: JobRoleItem[] }> {
  return runEmployeeRead(deps, actor, () => acceptOnly(input, []), () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId) => {
      const { rows } = await db.query(
        `SELECT id, display_name, status FROM eos_workforce.job_roles WHERE tenant_id = $1 ORDER BY lower(display_name), id LIMIT $2`,
        [tenantId, MAX_CATALOG],
      );
      return { items: rows.map((r) => ({ jobRoleId: r.id, displayName: r.display_name, status: r.status })) };
    });
}

export interface JobRoleHistoryItem {
  readonly assignmentId: string;
  readonly jobRoleId: string;
  readonly displayName: string;
  readonly jobRoleStatus: string;
  readonly current: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly reason: string | null;
}

export function listEmployeeJobRoleHistory(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly employeeId: string;
  readonly current: JobRoleHistoryItem | null;
  readonly items: JobRoleHistoryItem[];
  readonly truncated: boolean;
}> {
  return runEmployeeRead(deps, actor, () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); }, () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, employeeId) => {
      const employee = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
      if (employee.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      const { rows } = await db.query(
        `SELECT a.id, a.job_role_id, r.display_name, r.status, a.effective_from, a.effective_to, a.reason
           FROM eos_workforce.employee_job_role_assignments a
           JOIN eos_workforce.job_roles r ON r.tenant_id = a.tenant_id AND r.id = a.job_role_id
          WHERE a.tenant_id = $1 AND a.employee_id = $2
          ORDER BY a.effective_from DESC, a.id DESC
          LIMIT $3`,
        [tenantId, employeeId, MAX_HISTORY + 1],
      );
      const items: JobRoleHistoryItem[] = rows.slice(0, MAX_HISTORY).map((r) => ({
        assignmentId: r.id, jobRoleId: r.job_role_id, displayName: r.display_name, jobRoleStatus: r.status,
        current: r.effective_to === null, effectiveFrom: isoOf(r.effective_from)!, effectiveTo: isoOf(r.effective_to), reason: r.reason ?? null,
      }));
      return { employeeId, current: items.find((i) => i.current) ?? null, items, truncated: rows.length > MAX_HISTORY };
    });
}

export function listEmployeesWithoutJobRole(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly count: number;
  readonly items: EmployeeDirectoryItem[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}> {
  const scope = "without-job-role";
  return runEmployeeRead(deps, actor,
    () => { acceptOnly(input, ["limit", "cursor"]); return { limit: requirePageSize(input?.limit), cursor: decodeEmployeeCursor(scope, input?.cursor) }; },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, o) => {
      const missing = `NOT EXISTS (SELECT 1 FROM eos_workforce.employee_job_role_assignments a
                                    WHERE a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.effective_to IS NULL)`;
      const count = (await db.query(`SELECT count(*)::int AS n FROM eos_workforce.employees e WHERE e.tenant_id = $1 AND ${missing}`, [tenantId])).rows[0].n as number;
      const { rows } = await db.query(
        `SELECT ${EMPLOYEE_DIRECTORY_COLUMNS} FROM eos_workforce.employees e
          WHERE e.tenant_id = $1 AND ${missing} AND ($2::text IS NULL OR e.id > $2::text)
          ORDER BY e.id ASC LIMIT $3`,
        [tenantId, o.cursor?.id ?? null, o.limit + 1],
      );
      const truncated = rows.length > o.limit;
      const kept = rows.slice(0, o.limit);
      const last = kept[kept.length - 1];
      return {
        count,
        items: kept.map(directoryItemOf),
        truncated,
        nextCursor: truncated && last ? encodeEmployeeCursor(scope, { number: last.id, id: last.id }) : null,
      };
    });
}
