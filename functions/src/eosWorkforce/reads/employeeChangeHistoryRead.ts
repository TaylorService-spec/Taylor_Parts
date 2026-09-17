// EMP-RT-H1: listEmployeeChangeHistory -- the GOVERNED PostgreSQL Employee change history.
//
// Every governed Workforce change appends one eos_policy.audit_events row with target_kind = 'employee',
// target_id = the Employee id and actor_uid = the EOS Principal id (eosWorkforce/commands, appendEmployeeAudit). This
// read exposes those rows for ONE Employee, and nothing else:
//
//   * CLOSED ACTION ALLOW-LIST. Only the six Employee actions below. Any other audit row -- a tenant reconciliation,
//     a Job Role catalog change, a policy mutation, a future action nobody has reviewed -- is not history here, even
//     if it happens to carry target_kind 'employee'. Adding an action is a code change with a test.
//   * CLOSED VALUE PROJECTION. `before` / `after` are NOT the stored JSON verbatim: each action projects only its
//     named keys (profile: the seventeen PROFILE_FIELD_MAP keys; reporting: the manager; lifecycle: the status or
//     company; Job Role: the role). Internal row ids (relationshipId, assignmentId) and any unknown key are dropped.
//     Readable names are resolved in the same snapshot, from sources employee.record.read already exposes:
//     managerDisplayName (the manager Employee's CURRENT derived display name, eos_workforce.employees) and
//     jobRoleDisplayName (eos_workforce.job_roles). Operating company and employment status stay governed codes the
//     client already labels.
//   * VISIBILITY = THE RECORD'S. employee.record.read, the capability that reads the Employee record itself. The
//     Employee must exist in the ACTOR's tenant (any lifecycle status); a foreign-tenant, Principal or unknown id is
//     EMPLOYEE_NOT_FOUND. No new capability.
//   * WHO CHANGED IT. `changedBy` is { displayName } from eos_policy.principals.display_name ONLY when the caller ALSO
//     holds admin.principalAccess.read (the capability that already reveals Principal identity, EMP-RT-02), and only
//     when a name is recorded; otherwise null. The Principal id, provider and subject are never returned.
//   * READ ONLY. One REPEATABLE READ READ ONLY snapshot through the shared Employee read kernel; newest first by
//     (occurred_at DESC, id DESC) with an opaque keyset cursor bound to this Employee.
import {
  acceptOnly, decodeEmployeeCursor, encodeEmployeeCursor, isoOf, refuse, requireEmployeeId, requirePageSize, runEmployeeRead,
  type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";
import { deriveEmployeeDisplayName } from "./employeeRecordProjection";
import { EMPLOYEE_RECORD_READ } from "./employeeDirectoryReads";
import { PROFILE_FIELD_MAP } from "../employeeProfileVocabulary";

/** The capability that reveals who a Principal is. Holding it adds the actor's display name to each history item. */
export const PRINCIPAL_ACCESS_READ = "admin.principalAccess.read";

type Json = Record<string, unknown>;
type Projector = (value: unknown) => Json | null;

const PROFILE_KEYS: readonly string[] = Object.freeze(PROFILE_FIELD_MAP.map(([key]) => key));

const asObject = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function pick(keys: readonly string[]): Projector {
  return (value) => {
    const o = asObject(value);
    if (!o) return null;
    const out: Json = {};
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(o, key)) out[key] = stringOrNull(o[key]);
    return out;
  };
}

/** Closed. The action names are the commands' own audit actions (asserted equal by test). */
const ACTIONS = Object.freeze({
  "employee.profile.update": pick(PROFILE_KEYS),
  "employee.reportingRelationship.establish": pick(["managerEmployeeId"]),
  "employee.reportingRelationship.end": pick(["managerEmployeeId"]),
  "employee.employmentStatus.change": pick(["employmentStatus"]),
  "employee.operatingCompany.change": pick(["operatingCompanyId"]),
  "employee.jobRole.assign": pick(["jobRoleId"]),
} as const satisfies Record<string, Projector>);

export type EmployeeChangeAction = keyof typeof ACTIONS;
export const EMPLOYEE_CHANGE_HISTORY_ACTIONS = Object.freeze(Object.keys(ACTIONS) as EmployeeChangeAction[]);

export interface EmployeeChangeHistoryItem {
  readonly eventId: string;
  readonly action: EmployeeChangeAction;
  readonly occurredAt: string;
  readonly before: Json | null;
  readonly after: Json | null;
  readonly reason: string | null;
  readonly changedBy: { readonly displayName: string } | null;
}

export interface EmployeeChangeHistoryPage {
  readonly employeeId: string;
  readonly items: EmployeeChangeHistoryItem[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

export function listEmployeeChangeHistory(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<EmployeeChangeHistoryPage> {
  return runEmployeeRead(deps, actor,
    () => {
      acceptOnly(input, ["employeeId", "limit", "cursor"]);
      const employeeId = requireEmployeeId(input?.employeeId);
      const scope = `change-history:${employeeId}`;
      return { employeeId, scope, limit: requirePageSize(input?.limit), cursor: decodeEmployeeCursor(scope, input?.cursor) };
    },
    () => [EMPLOYEE_RECORD_READ],
    async (db, tenantId, _principalId, p) => {
      const exists = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, p.employeeId]);
      if (exists.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      const namesActors = actor.capabilities.has(PRINCIPAL_ACCESS_READ);
      // The cursor position is the exact stored timestamp (microseconds) as text, so paging never skips or repeats a row.
      const { rows } = await db.query(
        `SELECT a.id, a.action, a.occurred_at, a.before, a.after, a.reason,
                to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position,
                ${namesActors ? "pr.display_name" : "NULL::text"} AS changed_by_name
           FROM eos_policy.audit_events a
           ${namesActors ? "LEFT JOIN eos_policy.principals pr ON pr.id = a.actor_uid" : ""}
          WHERE a.tenant_id = $1 AND a.target_kind = 'employee' AND a.target_id = $2 AND a.action = ANY($3::text[])
            AND ($4::timestamptz IS NULL OR (a.occurred_at, a.id) < ($4::timestamptz, $5::text))
          ORDER BY a.occurred_at DESC, a.id DESC
          LIMIT $6`,
        [tenantId, p.employeeId, EMPLOYEE_CHANGE_HISTORY_ACTIONS, p.cursor?.number ?? null, p.cursor?.id ?? null, p.limit + 1],
      );
      const truncated = rows.length > p.limit;
      const kept = rows.slice(0, p.limit);

      const projected = kept.map((r) => {
        const project = ACTIONS[r.action as EmployeeChangeAction];
        return { row: r, before: project(r.before), after: project(r.after) };
      });

      // Readable names for the ids this page mentions, resolved in the same snapshot and the same tenant.
      const managerIds = new Set<string>();
      const jobRoleIds = new Set<string>();
      for (const { before, after } of projected) {
        for (const side of [before, after]) {
          if (typeof side?.managerEmployeeId === "string") managerIds.add(side.managerEmployeeId);
          if (typeof side?.jobRoleId === "string") jobRoleIds.add(side.jobRoleId);
        }
      }
      const managerNames = new Map<string, string | null>();
      if (managerIds.size > 0) {
        const found = await db.query(
          `SELECT id, preferred_name, display_name, first_name, last_name FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[])`,
          [tenantId, [...managerIds]],
        );
        for (const m of found.rows) managerNames.set(m.id, deriveEmployeeDisplayName(m));
      }
      const roleNames = new Map<string, string>();
      if (jobRoleIds.size > 0) {
        const found = await db.query(`SELECT id, display_name FROM eos_workforce.job_roles WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, [...jobRoleIds]]);
        for (const r of found.rows) roleNames.set(r.id, r.display_name);
      }
      const named = (side: Json | null): Json | null => {
        if (!side) return null;
        const out: Json = { ...side };
        if (typeof side.managerEmployeeId === "string") out.managerDisplayName = managerNames.get(side.managerEmployeeId) ?? null;
        if (typeof side.jobRoleId === "string") out.jobRoleDisplayName = roleNames.get(side.jobRoleId) ?? null;
        return out;
      };

      const items: EmployeeChangeHistoryItem[] = projected.map(({ row: r, before, after }) => ({
        eventId: r.id,
        action: r.action,
        occurredAt: isoOf(r.occurred_at)!,
        before: named(before),
        after: named(after),
        reason: r.reason ?? null,
        changedBy: namesActors && typeof r.changed_by_name === "string" && r.changed_by_name.trim() !== "" ? { displayName: r.changed_by_name } : null,
      }));
      const last = kept[kept.length - 1];
      return {
        employeeId: p.employeeId,
        items,
        truncated,
        nextCursor: truncated && last ? encodeEmployeeCursor(p.scope, { number: last.position, id: last.id }) : null,
      };
    });
}
