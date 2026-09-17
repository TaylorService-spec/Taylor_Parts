// The shared transaction kernel of the governed PostgreSQL Workforce commands (reporting relationship, Employee profile).
//
// Internal commands a trusted boundary calls with an ALREADY-RESOLVED actor. The actor is authority only through the
// checks here: `admin.employeeProfile.write` must be in the resolved capability set, and the Principal must be ACTIVE with
// an ACTIVE membership in the named tenant -- re-read inside the command's own transaction. Nothing a caller puts in the
// command INPUT is ever authority: tenant, actor, role and capability keys are refused as unknown input by each command.
//
// ONE transaction per command, READ COMMITTED with row locks; any failure rolls back every effect, including the audit row.
// Every change appends eos_policy.audit_events rows naming the EOS Principal -- never a Firebase uid.
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
export const refuse = (code: string, category: EmployeeReadErrorCategory, message: string): never => {
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

export const ID_SHAPE = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

export function requireId(value: unknown, field: string): string {
  if (!ID_SHAPE(value)) refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", `${field} is required and must be a governed Employee id`);
  return value as string;
}

export function optionalReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > 500) {
    refuse("REASON_INVALID", "INVALID_INPUT", "reason must be a trimmed, non-empty string of at most 500 characters");
  }
  return value as string;
}

export function acceptOnly(input: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input!).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  return input!;
}

/**
 * Run one command: actor + capability check, prepare (pure validation, before any connection), then BEGIN -> active
 * Principal + membership -> body -> COMMIT. A unique violation (23505) the body did not pre-empt is mapped by
 * `onUniqueViolation`; every other unexpected error is COMMAND_FAILED with no database detail.
 */
export async function runEmployeeCommand<P, R>(
  deps: EmployeeCommandDeps,
  actor: EmployeeCommandActor,
  prepare: () => P,
  body: (client: PoolClient, prepared: P, at: Date) => Promise<R>,
  onUniqueViolation: () => EmployeeCommandError,
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
    if ((err as { code?: string })?.code === "23505") throw onUniqueViolation();
    throw new EmployeeCommandError("COMMAND_FAILED", "FAILED", "the command could not be completed");
  } finally {
    client?.release();
  }
}

/** Lock the Employee row in the ACTOR's tenant. A foreign-tenant, Principal or provider id is simply NOT_FOUND. */
export async function lockEmployee(db: PoolClient, tenantId: string, employeeId: string): Promise<void> {
  const { rows } = await db.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, employeeId]);
  if (rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
}

export async function appendEmployeeAudit(
  db: PoolClient, tenantId: string, principalId: string, action: string, employeeId: string,
  before: unknown, after: unknown, reason: string | null, at: Date,
): Promise<string> {
  const id = `audit_${randomUUID()}`;
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, 'employee', $5, $6, $7, $8, $9)`,
    [id, tenantId, action, principalId, employeeId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), at, reason],
  );
  return id;
}
