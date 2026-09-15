// EMP-RT-01 readEmployee / listEmployees and EMP-RT-06 listManagedEmployees -- under `employee.record.read`.
//
// SCOPE OF employee.record.read (Owner ruling A). An Employee BUSINESS record and a bounded directory projection. It
// returns NO Principal id, provider identity, Role assignment or account status: another person's Principal linkage is
// readEmployeePrincipalLink, under admin.principalAccess.read (ruling B).
//
// userAccess (ruling B, decided): readEmployee carries `userAccess: "LINKED" | "UNLINKED"`, derived ONLY from whether an
// ACTIVE eos_policy.employee_principal_links row exists for this Employee in this tenant. It reveals no id, no provider,
// no Role and no account status (a disabled Principal's Employee still reads LINKED: the fact is the governed linkage,
// not whether the account can sign in). It is the Employee-facing fact the UI already shows as "User Access linked".
//
// ALL SIX lifecycle statuses are readable; a former Employee stays resolvable. The tenant is the actor's; an Employee of
// another tenant is EMPLOYEE_NOT_FOUND. Lists are keyset-paginated by Employee id, bounded, deterministic.
//
// EMP-RT-06 reads eos_workforce.employee_reporting_relationships (CURRENT rows: effective_to IS NULL) -- a person-level
// reporting relation, NOT the Security Role hierarchy, NOT a Job Role, and not ownership, accountability or assignment.
import {
  acceptOnly, decodeEmployeeCursor, encodeEmployeeCursor, isoOf, refuse, requireEmployeeId, requirePageSize, runEmployeeRead,
  type EmployeeCursor, type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import {
  CURRENT_MANAGER_JOIN, directoryItemOf, EMPLOYEE_DIRECTORY_COLUMNS, EMPLOYEE_RECORD_COLUMNS, employeeRecordOf,
  type EmployeeDirectoryItem, type EmployeeRecordProjection,
} from "./employeeRecordProjection";

export const EMPLOYEE_RECORD_READ = "employee.record.read";
export const EMPLOYMENT_STATUSES = Object.freeze(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"] as const);

export type UserAccessLinkage = "LINKED" | "UNLINKED";

export interface EmployeeRecordRead extends EmployeeRecordProjection {
  readonly userAccess: UserAccessLinkage;
}

export function readEmployee(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<EmployeeRecordRead> {
  return runEmployeeRead(deps, actor, () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); }, () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, employeeId) => {
      const { rows } = await db.query(
        `SELECT ${EMPLOYEE_RECORD_COLUMNS},
                EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                         WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active') AS linked
           FROM eos_workforce.employees e
           ${CURRENT_MANAGER_JOIN}
          WHERE e.tenant_id = $1 AND e.id = $2`,
        [tenantId, employeeId],
      );
      if (rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      return { ...employeeRecordOf(rows[0]), userAccess: rows[0].linked ? "LINKED" : "UNLINKED" };
    });
}

export interface EmployeePage<Item> {
  readonly items: Item[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

function pageOf<Item>(scope: string, rows: readonly Record<string, any>[], limit: number, project: (r: Record<string, any>) => Item): EmployeePage<Item> {
  const truncated = rows.length > limit;
  const kept = rows.slice(0, limit);
  const last = kept[kept.length - 1];
  return { items: kept.map(project), truncated, nextCursor: truncated && last ? encodeEmployeeCursor(scope, { number: last.id, id: last.id }) : null };
}

interface DirectoryOptions {
  readonly limit: number;
  readonly statuses: string[] | null;
  readonly cursor: EmployeeCursor | null;
  readonly scope: string;
}

function prepareDirectory(input: Record<string, unknown> | undefined): DirectoryOptions {
  acceptOnly(input, ["limit", "cursor", "employmentStatus"]);
  let statuses: string[] | null = null;
  if (input?.employmentStatus !== undefined) {
    const v = input.employmentStatus;
    const values = typeof v === "string" ? [v] : v;
    if (!Array.isArray(values) || values.length === 0 || values.length > EMPLOYMENT_STATUSES.length
      || !values.every((s) => typeof s === "string" && (EMPLOYMENT_STATUSES as readonly string[]).includes(s))) {
      refuse("FILTER_INVALID", "INVALID_INPUT", `employmentStatus must be one of, or a non-empty array of, ${EMPLOYMENT_STATUSES.join(", ")}`);
    }
    statuses = [...new Set(values as string[])].sort();
  }
  const scope = `directory:${statuses ? statuses.join(",") : "*"}`;
  return { limit: requirePageSize(input?.limit), statuses, cursor: decodeEmployeeCursor(scope, input?.cursor), scope };
}

/** EMP-RT-01: every Employee of the tenant, any lifecycle status unless filtered, by id, bounded. */
export function listEmployees(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<EmployeePage<EmployeeDirectoryItem>> {
  return runEmployeeRead(deps, actor, () => prepareDirectory(input), () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, o) => {
      const { rows } = await db.query(
        `SELECT ${EMPLOYEE_DIRECTORY_COLUMNS}
           FROM eos_workforce.employees e
          WHERE e.tenant_id = $1
            AND ($2::text[] IS NULL OR e.employment_status::text = ANY($2::text[]))
            AND ($3::text IS NULL OR e.id > $3::text)
          ORDER BY e.id ASC
          LIMIT $4`,
        [tenantId, o.statuses, o.cursor?.id ?? null, o.limit + 1],
      );
      return pageOf(o.scope, rows, o.limit, directoryItemOf);
    });
}

export interface ManagedEmployeeItem extends EmployeeDirectoryItem {
  readonly reportingSince: string;
}

/** EMP-RT-06: the Employees whose CURRENT manager is this Employee, by id, bounded. */
export function listManagedEmployees(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<EmployeePage<ManagedEmployeeItem> & { readonly managerEmployeeId: string }> {
  return runEmployeeRead(deps, actor,
    () => {
      acceptOnly(input, ["managerEmployeeId", "limit", "cursor"]);
      const managerEmployeeId = requireEmployeeId(input?.managerEmployeeId);
      const scope = `managed:${managerEmployeeId}`;
      return { managerEmployeeId, limit: requirePageSize(input?.limit), cursor: decodeEmployeeCursor(scope, input?.cursor), scope };
    },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, o) => {
      const manager = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, o.managerEmployeeId]);
      if (manager.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      const { rows } = await db.query(
        `SELECT ${EMPLOYEE_DIRECTORY_COLUMNS}, rr.effective_from
           FROM eos_workforce.employee_reporting_relationships rr
           JOIN eos_workforce.employees e ON e.tenant_id = rr.tenant_id AND e.id = rr.employee_id
          WHERE rr.tenant_id = $1 AND rr.manager_employee_id = $2 AND rr.effective_to IS NULL
            AND ($3::text IS NULL OR e.id > $3::text)
          ORDER BY e.id ASC
          LIMIT $4`,
        [tenantId, o.managerEmployeeId, o.cursor?.id ?? null, o.limit + 1],
      );
      return { managerEmployeeId: o.managerEmployeeId, ...pageOf(o.scope, rows, o.limit, (r) => ({ ...directoryItemOf(r), reportingSince: isoOf(r.effective_from)! })) };
    });
}
