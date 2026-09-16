// The governed PostgreSQL EMPLOYEE PROFILE writer (EMP-RT-W1A, #1931; parent #1930).
//
// The PostgreSQL successor of the Firestore profile command (access/employeeProfileCommands.ts updateEmployeeProfile) for
// the profile facts migration 1759838400000 placed on eos_workforce.employees. NOT wired into any transport in this lane:
// Render transport is W1B, the Administration edit cutover and Firestore writer retirement are W1C.
//
// ════════════════════ WHAT IT WRITES ════════════════════
//
// Exactly the seventeen profile columns, addressed by the SAME field keys the Firestore command and the Administration
// form use (displayName, address.city, hireDate, ...). The key -> column map and the normalization are
// employeeProfileVocabulary.ts PROFILE_FIELD_MAP / normalizeProfileValue -- the one Firebase-free statement of the command's
// validators the one-time profile copy also uses, so the copy and this writer cannot disagree:
//   * text: trimmed; "" and whitespace clear to null; at most 200 characters
//   * workEmail: structural shape; hireDate / separationDate: a real calendar day (YYYY-MM-DD)
//   * employeeNumber: ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$, clearable, unique CASE-INSENSITIVELY per tenant
//
// ════════════════════ WHAT IT REFUSES ════════════════════
//
//   * any key outside the seventeen -- INPUT_FIELD_NOT_ACCEPTED, naming it. That includes, deliberately:
//       managerEmployeeId    the reporting relationship is its own governed authority (reportingRelationshipCommands.ts)
//       employmentStatus,
//       operatingCompanyId   Employee LIFECYCLE / business authority facts, not profile facts; the profile copy never
//                            overwrites them either (employeeProfileCutover.ts reconciliation)
//       operationalRoles     Owner ruling E: not a Job Role, not a Security Role, not migrated
//       securityRole, role, userId, principalId, accessVersion, accountStatus, disabled, tenantId, actor*, capabilities
//                            access identity or authority -- never Employee profile input
//   * an Employee id that is not an Employee of the ACTOR's tenant -- EMPLOYEE_NOT_FOUND. A Principal id, a Firebase uid /
//     provider subject, or a foreign-tenant Employee id is never resolved to an Employee.
//   * an employee number another Employee of the tenant holds (any case) -- EMPLOYEE_NUMBER_TAKEN
//
// ════════════════════ TRANSACTION ════════════════════
//
// read current (row lock) -> diff -> update changed columns + updated_at -> ONE audit event, all in one transaction. A
// submission identical to the stored profile is NO_CHANGE: nothing is written, updated_at is not bumped and no audit row
// is appended (the Firestore command's `unchanged` convention). The audit event's before/after carry ONLY the changed
// field keys, and actor_uid is the EOS Principal id.
import type { PoolClient } from "pg";
import {
  EmployeeCommandError, acceptOnly, appendEmployeeAudit, lockEmployee, optionalReason, refuse, requireId, runEmployeeCommand,
  type EmployeeCommandActor, type EmployeeCommandDeps,
} from "./employeeCommandKernel";
import { PROFILE_FIELD_MAP, normalizeProfileValue, type ProfileColumn } from "../employeeProfileVocabulary";

export const EMPLOYEE_PROFILE_UPDATE_ACTION = "employee.profile.update";

/** The closed input vocabulary: Administration / Firestore-command field keys, in the fixed column order. */
export const EMPLOYEE_PROFILE_FIELD_KEYS: readonly string[] = Object.freeze(PROFILE_FIELD_MAP.map(([key]) => key));

const COLUMN_BY_KEY = new Map(PROFILE_FIELD_MAP.map(([key, column, kind]) => [key, { column, kind }]));

const NORMALIZATION_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  NOT_A_STRING: "must be a string or null",
  TOO_LONG: "exceeds 200 characters",
  EMAIL_SHAPE_INVALID: "is not a valid email address",
  CALENDAR_DATE_INVALID: "must be a calendar date (YYYY-MM-DD)",
  EMPLOYEE_NUMBER_SHAPE_INVALID: "must be 1-32 characters of letters, digits, dot, underscore or hyphen, starting with a letter or digit",
});

export interface EmployeeProfileChangeResult {
  readonly outcome: "UPDATED" | "NO_CHANGE";
  readonly employeeId: string;
  /** Field keys that actually changed, in the fixed vocabulary order. */
  readonly changedFields: readonly string[];
  readonly auditEventId: string | null;
}

type Changes = ReadonlyMap<string, { column: ProfileColumn; value: string | null }>;

function prepareChanges(raw: unknown): Changes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse("CHANGES_REQUIRED", "INVALID_INPUT", "changes must be an object of profile field keys");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) refuse("CHANGES_REQUIRED", "INVALID_INPUT", "changes must name at least one profile field");
  const unknown = entries.map(([k]) => k).filter((k) => !COLUMN_BY_KEY.has(k));
  if (unknown.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${unknown.sort().join(", ")}`);
  const out = new Map<string, { column: ProfileColumn; value: string | null }>();
  // Fixed vocabulary order, never the caller's key order, so the audit trail and result are deterministic.
  for (const key of EMPLOYEE_PROFILE_FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const { column, kind } = COLUMN_BY_KEY.get(key)!;
    const n = normalizeProfileValue(kind, (raw as Record<string, unknown>)[key]);
    if ("code" in n) refuse("PROFILE_FIELD_INVALID", "INVALID_INPUT", `${key} ${NORMALIZATION_MESSAGES[n.code] ?? "is invalid"}`);
    else out.set(key, { column, value: n.value });
  }
  return out;
}

async function currentProfile(db: PoolClient, tenantId: string, employeeId: string, columns: readonly ProfileColumn[]) {
  const select = columns.map((c) => (c === "hire_date" || c === "separation_date" ? `to_char(${c}, 'YYYY-MM-DD') AS ${c}` : c));
  const { rows } = await db.query(`SELECT ${select.join(", ")} FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
  return rows[0] as Record<ProfileColumn, string | null>;
}

/** Update governed profile facts of one Employee of the actor's tenant. */
export function updateEmployeeProfile(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<EmployeeProfileChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "changes", "reason"]);
      return { employeeId: requireId(i.employeeId, "employeeId"), changes: prepareChanges(i.changes), reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      const columns = [...p.changes.values()].map((c) => c.column);
      const current = await currentProfile(db, actor.tenantId, p.employeeId, columns);
      const changed = [...p.changes].filter(([, c]) => (current[c.column] ?? null) !== c.value);
      if (changed.length === 0) return { outcome: "NO_CHANGE", employeeId: p.employeeId, changedFields: [], auditEventId: null };

      const number = changed.find(([, c]) => c.column === "employee_number")?.[1].value;
      if (number) {
        const held = await db.query(
          `SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id <> $2 AND upper(employee_number) = upper($3)`,
          [actor.tenantId, p.employeeId, number],
        );
        if (held.rows.length > 0) refuse("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number");
      }

      await db.query(
        `UPDATE eos_workforce.employees SET ${changed.map(([, c], i) => `${c.column} = $${i + 3}`).join(", ")}, updated_at = $${changed.length + 3}
          WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, p.employeeId, ...changed.map(([, c]) => c.value), at],
      );
      const before = Object.fromEntries(changed.map(([key, c]) => [key, current[c.column] ?? null]));
      const after = Object.fromEntries(changed.map(([key, c]) => [key, c.value]));
      const auditEventId = await appendEmployeeAudit(db, actor.tenantId, actor.principalId, EMPLOYEE_PROFILE_UPDATE_ACTION, p.employeeId, before, after, p.reason, at);
      return { outcome: "UPDATED", employeeId: p.employeeId, changedFields: changed.map(([key]) => key), auditEventId };
    },
    () => new EmployeeCommandError("EMPLOYEE_NUMBER_TAKEN", "CONFLICT", "another Employee of this tenant holds that employee number"));
}
