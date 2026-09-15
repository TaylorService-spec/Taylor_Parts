// The governed REPORTING RELATIONSHIP writer (Owner ruling D) -- establish / end, internal commands.
//
// NOT wired into any transport in this lane: an internal command a trusted boundary may call with an already-resolved
// actor. It requires the EXISTING capability `admin.employeeProfile.write` -- the same authority the Firestore profile
// command already requires to change managerEmployeeId (access/employeeProfileCommands.ts EMPLOYEE_PROFILE_CAPABILITY).
// No new write id is invented.
//
// ONE transaction per command, READ COMMITTED with row locks:
//   * active Principal + active tenant membership (in the transaction)
//   * both Employees exist in the ACTOR's tenant (any lifecycle status) -- a foreign-tenant Employee is NOT_FOUND, and
//     the same-tenant composite FKs make a cross-tenant row unrepresentable anyway
//   * self-management refused (the source command's rule, employeeProfileCommands.ts:535-537)
//   * establish with the SAME current manager is NO_CHANGE and writes nothing
//   * establish with a DIFFERENT current manager ENDS the current row (effective_to, ended_by, ended_at) and inserts a
//     new current row in the same transaction -- history is preserved, never rewritten or deleted
//   * end with no current relationship refuses REPORTING_RELATIONSHIP_NOT_FOUND
//   * every change appends one eos_policy.audit_events row naming the EOS Principal
// established_by / ended_by / actor_uid are the EOS Principal id -- never a Firebase uid.
//
// No cycle rule is invented: the source command refuses only self-management, and a stricter rule here would refuse
// records its source accepts.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { EmployeeReadErrorCategory } from "../reads/employeeReadKernel";

export const EMPLOYEE_PROFILE_WRITE = "admin.employeeProfile.write";

export class EmployeeCommandError extends Error {
  constructor(readonly code: string, readonly category: EmployeeReadErrorCategory, message: string) {
    super(message);
    this.name = "EmployeeCommandError";
  }
}
const refuse = (code: string, category: EmployeeReadErrorCategory, message: string): never => {
  throw new EmployeeCommandError(code, category, message);
};

export interface EmployeeCommandActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface EmployeeCommandDeps {
  readonly pool: Pool;
  readonly now?: () => Date;
}

const ID_SHAPE = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

function requireId(value: unknown, field: string): string {
  if (!ID_SHAPE(value)) refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", `${field} is required and must be a governed Employee id`);
  return value as string;
}

function optionalReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > 500) {
    refuse("REASON_INVALID", "INVALID_INPUT", "reason must be a trimmed, non-empty string of at most 500 characters");
  }
  return value as string;
}

function acceptOnly(input: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input!).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  return input!;
}

async function runEmployeeCommand<P, R>(
  deps: EmployeeCommandDeps,
  actor: EmployeeCommandActor,
  prepare: () => P,
  body: (client: PoolClient, prepared: P, at: Date) => Promise<R>,
): Promise<R> {
  let client: PoolClient | undefined;
  try {
    if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
      refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
    }
    if (!actor.capabilities.has(EMPLOYEE_PROFILE_WRITE)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${EMPLOYEE_PROFILE_WRITE}`);
    const prepared = prepare();
    client = await deps.pool.connect();
    await client.query("BEGIN");
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [actor.tenantId, actor.principalId],
    );
    if (member.rows.length === 0) refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
    const result = await body(client, prepared, deps.now?.() ?? new Date());
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof EmployeeCommandError) throw err;
    if ((err as { code?: string })?.code === "23505") {
      throw new EmployeeCommandError("REPORTING_CONCURRENT_CHANGE", "CONFLICT", "the reporting relationship changed concurrently; retry");
    }
    throw new EmployeeCommandError("COMMAND_FAILED", "FAILED", "the command could not be completed");
  } finally {
    client?.release();
  }
}

async function lockEmployee(db: PoolClient, tenantId: string, employeeId: string): Promise<void> {
  const { rows } = await db.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, employeeId]);
  if (rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
}

async function currentRelationship(db: PoolClient, tenantId: string, employeeId: string) {
  const { rows } = await db.query(
    `SELECT id, manager_employee_id FROM eos_workforce.employee_reporting_relationships
      WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL FOR UPDATE`,
    [tenantId, employeeId],
  );
  return rows[0] as { id: string; manager_employee_id: string } | undefined;
}

async function endRow(db: PoolClient, tenantId: string, id: string, principalId: string, at: Date): Promise<void> {
  await db.query(
    `UPDATE eos_workforce.employee_reporting_relationships SET effective_to = $3, ended_by = $4, ended_at = $3
      WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
    [tenantId, id, at, principalId],
  );
}

async function audit(db: PoolClient, tenantId: string, principalId: string, action: string, employeeId: string, before: unknown, after: unknown, reason: string | null, at: Date) {
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, 'employee', $5, $6, $7, $8, $9)`,
    [`audit_${randomUUID()}`, tenantId, action, principalId, employeeId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), at, reason],
  );
}

export interface ReportingChangeResult {
  readonly outcome: "ESTABLISHED" | "CHANGED" | "NO_CHANGE" | "ENDED";
  readonly employeeId: string;
  readonly managerEmployeeId: string | null;
  readonly relationshipId: string | null;
  readonly endedRelationshipId: string | null;
}

/** Make `managerEmployeeId` the CURRENT manager of `employeeId`, ending any different current relationship. */
export function establishReportingRelationship(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<ReportingChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "managerEmployeeId", "reason"]);
      const employeeId = requireId(i.employeeId, "employeeId");
      const managerEmployeeId = requireId(i.managerEmployeeId, "managerEmployeeId");
      if (employeeId === managerEmployeeId) refuse("REPORTING_SELF_MANAGER", "INVALID_INPUT", "an Employee cannot be their own manager");
      return { employeeId, managerEmployeeId, reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      const manager = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, p.managerEmployeeId]);
      if (manager.rows.length === 0) refuse("MANAGER_NOT_FOUND", "NOT_FOUND", "the manager is not an Employee of this tenant");
      const current = await currentRelationship(db, actor.tenantId, p.employeeId);
      if (current && current.manager_employee_id === p.managerEmployeeId) {
        return { outcome: "NO_CHANGE", employeeId: p.employeeId, managerEmployeeId: p.managerEmployeeId, relationshipId: current.id, endedRelationshipId: null };
      }
      if (current) await endRow(db, actor.tenantId, current.id, actor.principalId, at);
      const id = `err_${randomUUID()}`;
      await db.query(
        `INSERT INTO eos_workforce.employee_reporting_relationships
           (id, tenant_id, employee_id, manager_employee_id, effective_from, established_by, established_at, source, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $5, 'GOVERNED_COMMAND', $7)`,
        [id, actor.tenantId, p.employeeId, p.managerEmployeeId, at, actor.principalId, p.reason],
      );
      await audit(db, actor.tenantId, actor.principalId, "employee.reportingRelationship.establish", p.employeeId,
        current ? { managerEmployeeId: current.manager_employee_id, relationshipId: current.id } : null,
        { managerEmployeeId: p.managerEmployeeId, relationshipId: id }, p.reason, at);
      return { outcome: current ? "CHANGED" : "ESTABLISHED", employeeId: p.employeeId, managerEmployeeId: p.managerEmployeeId, relationshipId: id, endedRelationshipId: current?.id ?? null };
    });
}

/** End the CURRENT reporting relationship of `employeeId`. The row stays, with effective_to set. */
export function endReportingRelationship(deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>): Promise<ReportingChangeResult> {
  return runEmployeeCommand(deps, actor,
    () => {
      const i = acceptOnly(input, ["employeeId", "reason"]);
      return { employeeId: requireId(i.employeeId, "employeeId"), reason: optionalReason(i.reason) };
    },
    async (db, p, at) => {
      await lockEmployee(db, actor.tenantId, p.employeeId);
      const current = await currentRelationship(db, actor.tenantId, p.employeeId);
      if (!current) refuse("REPORTING_RELATIONSHIP_NOT_FOUND", "NOT_FOUND", "the Employee has no current reporting relationship");
      await endRow(db, actor.tenantId, current!.id, actor.principalId, at);
      await audit(db, actor.tenantId, actor.principalId, "employee.reportingRelationship.end", p.employeeId,
        { managerEmployeeId: current!.manager_employee_id, relationshipId: current!.id }, null, p.reason, at);
      return { outcome: "ENDED", employeeId: p.employeeId, managerEmployeeId: null, relationshipId: null, endedRelationshipId: current!.id };
    });
}
