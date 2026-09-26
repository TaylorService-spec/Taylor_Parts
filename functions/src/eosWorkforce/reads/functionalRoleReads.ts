// The governed PostgreSQL FUNCTIONAL ROLE reads. Visibility reuses employee.record.read -- reading an Employee's
// business responsibilities is the same business visibility as reading the Employee record, exactly as the Job Role and
// Work Eligibility reads do; no extra read capability is invented. Every read is one READ ONLY snapshot through the
// shared Employee read kernel, tenant-scoped by the actor.
//
//   listFunctionalRoles             the tenant catalog (ACTIVE and INACTIVE), each with its current holder count
//   listFunctionalRoleHolders       one Functional Role's current and scheduled holders
//   listEmployeeFunctionalRoles     one Employee's current, scheduled and past assignments
//   listFunctionalRoleHistory       one Functional Role's audit history: catalog changes and assignment changes
//
// A Functional Role read returns business responsibility only. It names no Security Role, capability or permission,
// and nothing here derives one.
import {
  acceptOnly, isoOf, refuse, requireEmployeeId, runEmployeeRead, type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import { EMPLOYEE_DIRECTORY_COLUMNS, directoryItemOf, type EmployeeDirectoryItem } from "./employeeRecordProjection";
import { EMPLOYEE_RECORD_READ } from "./employeeDirectoryReads";
import {
  FUNCTIONAL_ROLE_ASSIGN_ACTION, FUNCTIONAL_ROLE_AUDIT_TARGET_KIND, FUNCTIONAL_ROLE_CATALOG_CREATE_ACTION,
  FUNCTIONAL_ROLE_CATALOG_STATUS_ACTION, FUNCTIONAL_ROLE_CATALOG_UPDATE_ACTION, FUNCTIONAL_ROLE_END_ACTION,
  FUNCTIONAL_ROLE_ID_SHAPE, FUNCTIONAL_ROLE_STATUSES,
} from "../functionalRoleVocabulary";

const MAX_CATALOG = 200;
const MAX_HOLDERS = 500;
const MAX_HISTORY = 100;

function requireFunctionalRoleId(value: unknown): string {
  if (typeof value !== "string" || !FUNCTIONAL_ROLE_ID_SHAPE.test(value)) {
    refuse("FUNCTIONAL_ROLE_ID_INVALID", "INVALID_INPUT", "functionalRoleId must be a governed Functional Role id");
  }
  return value as string;
}

function requireLimit(value: unknown): number {
  if (value === undefined || value === null) return MAX_HISTORY;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_HISTORY) {
    refuse("LIMIT_INVALID", "INVALID_INPUT", `limit must be an integer from 1 to ${MAX_HISTORY}`);
  }
  return value as number;
}

export interface FunctionalRoleItem {
  readonly functionalRoleId: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly currentHolderCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const CURRENT = `a.effective_from <= now() AND (a.effective_to IS NULL OR a.effective_to > now())`;

export function listFunctionalRoles(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{ readonly items: FunctionalRoleItem[] }> {
  return runEmployeeRead(deps, actor,
    () => {
      acceptOnly(input, ["status"]);
      const status = input?.status;
      if (status !== undefined && !(FUNCTIONAL_ROLE_STATUSES as readonly unknown[]).includes(status)) {
        refuse("FUNCTIONAL_ROLE_STATUS_INVALID", "INVALID_INPUT", `status must be one of ${FUNCTIONAL_ROLE_STATUSES.join(", ")}`);
      }
      return (status as string | undefined) ?? null;
    },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, status) => {
      const { rows } = await db.query(
        `SELECT r.id, r.key, r.name, r.description, r.status, r.created_at, r.updated_at,
                (SELECT count(*)::int FROM eos_workforce.employee_functional_role_assignments a
                  WHERE a.tenant_id = r.tenant_id AND a.functional_role_id = r.id AND ${CURRENT}) AS holders
           FROM eos_workforce.functional_roles r
          WHERE r.tenant_id = $1 AND ($2::text IS NULL OR r.status = $2)
          ORDER BY lower(r.name), r.id LIMIT $3`,
        [tenantId, status, MAX_CATALOG],
      );
      return {
        items: rows.map((r) => ({
          functionalRoleId: r.id, key: r.key, name: r.name, description: r.description ?? null, status: r.status,
          currentHolderCount: r.holders, createdAt: isoOf(r.created_at)!, updatedAt: isoOf(r.updated_at)!,
        })),
      };
    });
}

export interface FunctionalRoleAssignmentItem {
  readonly assignmentId: string;
  readonly functionalRoleId: string;
  readonly key: string;
  readonly name: string;
  readonly functionalRoleStatus: string;
  /** CURRENT (started, not ended), SCHEDULED (starts later) or ENDED. */
  readonly state: "CURRENT" | "SCHEDULED" | "ENDED";
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly assignmentSource: string;
  readonly reason: string;
  readonly endReason: string | null;
}

const STATE = `CASE WHEN a.effective_from > now() AND (a.effective_to IS NULL OR a.effective_to > a.effective_from) THEN 'SCHEDULED'
                    WHEN ${CURRENT} THEN 'CURRENT' ELSE 'ENDED' END`;

const assignmentOf = (r: Record<string, unknown>): FunctionalRoleAssignmentItem => ({
  assignmentId: String(r.id), functionalRoleId: String(r.functional_role_id), key: String(r.key), name: String(r.name),
  functionalRoleStatus: String(r.role_status), state: r.state as FunctionalRoleAssignmentItem["state"],
  effectiveFrom: isoOf(r.effective_from as Date)!, effectiveTo: isoOf((r.effective_to as Date | null) ?? null),
  assignmentSource: String(r.assignment_source), reason: String(r.reason), endReason: (r.end_reason as string | null) ?? null,
});

const ASSIGNMENT_COLUMNS = `a.id, a.functional_role_id, r.key, r.name, r.status AS role_status, ${STATE} AS state,
  a.effective_from, a.effective_to, a.assignment_source, a.reason, a.end_reason`;

export function listEmployeeFunctionalRoles(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly employeeId: string;
  readonly current: FunctionalRoleAssignmentItem[];
  readonly scheduled: FunctionalRoleAssignmentItem[];
  readonly items: FunctionalRoleAssignmentItem[];
  readonly truncated: boolean;
}> {
  return runEmployeeRead(deps, actor, () => { acceptOnly(input, ["employeeId"]); return requireEmployeeId(input?.employeeId); }, () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, employeeId) => {
      const employee = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
      if (employee.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      const { rows } = await db.query(
        `SELECT ${ASSIGNMENT_COLUMNS}
           FROM eos_workforce.employee_functional_role_assignments a
           JOIN eos_workforce.functional_roles r ON r.tenant_id = a.tenant_id AND r.id = a.functional_role_id
          WHERE a.tenant_id = $1 AND a.employee_id = $2
          ORDER BY a.effective_from DESC, a.id DESC LIMIT $3`,
        [tenantId, employeeId, MAX_HISTORY + 1],
      );
      const items = rows.slice(0, MAX_HISTORY).map(assignmentOf);
      return {
        employeeId,
        current: items.filter((i) => i.state === "CURRENT"),
        scheduled: items.filter((i) => i.state === "SCHEDULED"),
        items,
        truncated: rows.length > MAX_HISTORY,
      };
    });
}

export interface FunctionalRoleHolder extends FunctionalRoleAssignmentItem {
  readonly employee: EmployeeDirectoryItem;
}

export function listFunctionalRoleHolders(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly functionalRoleId: string;
  readonly holders: FunctionalRoleHolder[];
  readonly truncated: boolean;
}> {
  return runEmployeeRead(deps, actor, () => { acceptOnly(input, ["functionalRoleId"]); return requireFunctionalRoleId(input?.functionalRoleId); },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, functionalRoleId) => {
      const role = await db.query(`SELECT 1 FROM eos_workforce.functional_roles WHERE tenant_id = $1 AND id = $2`, [tenantId, functionalRoleId]);
      if (role.rows.length === 0) refuse("FUNCTIONAL_ROLE_NOT_FOUND", "NOT_FOUND", "the Functional Role does not exist in this tenant");
      const { rows } = await db.query(
        `SELECT ${ASSIGNMENT_COLUMNS}, ${EMPLOYEE_DIRECTORY_COLUMNS}, a.id AS assignment_row_id
           FROM eos_workforce.employee_functional_role_assignments a
           JOIN eos_workforce.functional_roles r ON r.tenant_id = a.tenant_id AND r.id = a.functional_role_id
           JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.employee_id
          WHERE a.tenant_id = $1 AND a.functional_role_id = $2 AND (a.effective_to IS NULL OR a.effective_to > now())
            AND (a.effective_to IS NULL OR a.effective_to > a.effective_from)
          ORDER BY a.effective_from, a.id LIMIT $3`,
        [tenantId, functionalRoleId, MAX_HOLDERS + 1],
      );
      const holders = rows.slice(0, MAX_HOLDERS).map((r) => ({
        ...assignmentOf({ ...r, id: r.assignment_row_id }),
        employee: directoryItemOf(r),
      }));
      return { functionalRoleId, holders, truncated: rows.length > MAX_HOLDERS };
    });
}

type Json = Record<string, unknown>;
const HISTORY_KEYS = ["functionalRoleId", "functionalRoleKey", "key", "name", "description", "status", "assignmentId", "effectiveFrom", "effectiveTo"];
const project = (value: unknown): Json | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Json = {};
  for (const k of HISTORY_KEYS) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = (value as Json)[k] ?? null;
  return out;
};

/** The closed set of actions this history shows. Anything else is not Functional Role history. */
export const FUNCTIONAL_ROLE_HISTORY_ACTIONS = Object.freeze([
  FUNCTIONAL_ROLE_CATALOG_CREATE_ACTION, FUNCTIONAL_ROLE_CATALOG_UPDATE_ACTION, FUNCTIONAL_ROLE_CATALOG_STATUS_ACTION,
  FUNCTIONAL_ROLE_ASSIGN_ACTION, FUNCTIONAL_ROLE_END_ACTION,
] as const);

export interface FunctionalRoleHistoryItem {
  readonly action: string;
  readonly occurredAt: string;
  readonly employeeId: string | null;
  readonly before: Json | null;
  readonly after: Json | null;
  readonly reason: string | null;
}

export function listFunctionalRoleHistory(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<{
  readonly functionalRoleId: string;
  readonly items: FunctionalRoleHistoryItem[];
}> {
  return runEmployeeRead(deps, actor,
    () => { acceptOnly(input, ["functionalRoleId", "limit"]); return { id: requireFunctionalRoleId(input?.functionalRoleId), limit: requireLimit(input?.limit) }; },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, p) => {
      const role = await db.query(`SELECT 1 FROM eos_workforce.functional_roles WHERE tenant_id = $1 AND id = $2`, [tenantId, p.id]);
      if (role.rows.length === 0) refuse("FUNCTIONAL_ROLE_NOT_FOUND", "NOT_FOUND", "the Functional Role does not exist in this tenant");
      const { rows } = await db.query(
        `SELECT action, occurred_at, target_kind, target_id, before, after, reason FROM eos_policy.audit_events
          WHERE tenant_id = $1 AND action = ANY($3::text[])
            AND ((target_kind = $4 AND target_id = $2)
                 OR (target_kind = 'employee' AND (before ->> 'functionalRoleId' = $2 OR after ->> 'functionalRoleId' = $2)))
          ORDER BY occurred_at DESC, id DESC LIMIT $5`,
        [tenantId, p.id, [...FUNCTIONAL_ROLE_HISTORY_ACTIONS], FUNCTIONAL_ROLE_AUDIT_TARGET_KIND, p.limit],
      );
      return {
        functionalRoleId: p.id,
        items: rows.map((r) => ({
          action: r.action, occurredAt: isoOf(r.occurred_at)!,
          employeeId: r.target_kind === "employee" ? r.target_id : null,
          before: project(r.before), after: project(r.after), reason: r.reason ?? null,
        })),
      };
    });
}
