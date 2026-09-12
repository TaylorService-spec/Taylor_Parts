// Employee ↔ Principal linkage — the POSTGRES repository.
//
// ════════════════════ THE ONLY WRITER OF eos_policy.employee_principal_links ════════════════════
//
// Migration 008 created the table; this module is the governed boundary in front of it. It takes a
// `pg` Pool (or a client inside a caller's transaction) and nothing else — no Firebase, no
// Firestore, no environment, no credentials. The connection is the caller's; the rules are this
// module's.
//
// ════════════════════ EVERY REFUSAL IS SAID TWICE, ON PURPOSE ════════════════════
//
// The shape and vocabulary checks in employeePrincipalLink.ts run here BEFORE the INSERT, and the
// database enforces the same rules as CHECK constraints and partial unique indexes. That is
// deliberate duplication, for the reason migration 007's header gives for its own: a caller that
// got it wrong should receive the sentence rather than a constraint name, and no code path may
// quietly supply a placeholder to get past a NOT NULL. The database layer is what protects the
// paths that never come through this module — a repair script, a psql prompt, a future service.
//
// ════════════════════ A UNIQUE VIOLATION IS NOT A CRASH ════════════════════
//
// The two partial unique indexes are the whole point of the table: one ACTIVE link per Employee,
// one ACTIVE link per principal. When one fires it means the caller is trying to make one person
// into two, or two people into one, and the answer is a NAMED conflict a human can read — not a
// leaked PostgresError with a constraint name in it. `establishLink` maps each index to the
// sentence that describes what it just prevented.
//
// ════════════════════ WHAT IT DOES NOT DO ════════════════════
//
// It never creates a principal, never creates a tenant membership, and never invents an operating
// company. A principal that is not a member of the tenant is refused by the composite foreign key
// (migration 003's Ruling B shape, reused by migration 008) and surfaced here as
// `NOT_A_TENANT_MEMBER` — because "add them to the tenant so the link works" is an authorization
// decision, and this module is not allowed to make it.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  assertValidLinkInput,
  type EmployeePrincipalLinkInput,
  type EmployeePrincipalLinkRecord,
  type EmployeePrincipalLinkSource,
  type EmployeePrincipalLinkStatus,
} from "./employeePrincipalLink.js";

const SCHEMA = "eos_policy";
const TABLE = `${SCHEMA}.employee_principal_links`;

/** A `pg` Pool or a PoolClient already inside the caller's transaction. Accepting both is what lets
 *  a larger command link an Employee in the SAME transaction that does everything else, rather than
 *  committing half a decision. */
export type LinkQueryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type LinkConflictCode =
  /** This Employee already has a different ACTIVE link. One Employee is not two logins. */
  | "EMPLOYEE_ALREADY_LINKED"
  /** This principal already has a different ACTIVE link. One login is not two Employees. */
  | "PRINCIPAL_ALREADY_LINKED"
  /** The principal holds no membership in this tenant, so the composite foreign key refused. */
  | "NOT_A_TENANT_MEMBER";

export class EmployeePrincipalLinkConflict extends Error {
  constructor(
    readonly code: LinkConflictCode,
    message: string,
  ) {
    super(message);
    this.name = "EmployeePrincipalLinkConflict";
  }
}

interface LinkRow {
  id: string;
  tenant_id: string;
  principal_id: string;
  employee_id: string;
  operating_company_id: string;
  link_source: string;
  status: string;
  asserted_by: string | null;
  assertion_reason: string | null;
}

const toRecord = (row: LinkRow): EmployeePrincipalLinkRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  principalId: row.principal_id,
  employeeId: row.employee_id,
  operatingCompanyId: row.operating_company_id,
  linkSource: row.link_source as EmployeePrincipalLinkSource,
  status: row.status as EmployeePrincipalLinkStatus,
  assertedBy: row.asserted_by,
  assertionReason: row.assertion_reason,
});

const SELECT_COLUMNS =
  "id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason";

/** The two partial unique indexes, by the name migration 008 gives them. Matched on the error's
 *  `constraint` field rather than on message text, because message text is a locale away from
 *  changing and a constraint name is part of the schema. */
const EMPLOYEE_INDEX = "employee_principal_links_one_active_per_employee";
const PRINCIPAL_INDEX = "employee_principal_links_one_active_per_principal";
const MEMBER_FK = "employee_principal_links_member_fk";

/**
 * Establish an ACTIVE link between one Employee and one principal.
 *
 * Refuses — never resolves — every ambiguity:
 *   * malformed input, or an OPERATOR_ASSERTED link with no author (assertValidLinkInput);
 *   * a second ACTIVE link for the Employee, or for the principal (the partial unique indexes);
 *   * a principal who is not a member of this tenant (the composite foreign key).
 *
 * IDEMPOTENCE IS NOT GUESSED EITHER. Re-establishing the exact same link is NOT silently accepted:
 * an existing ACTIVE row for this Employee that already names this principal is returned unchanged,
 * but one that names a DIFFERENT principal is a conflict. "Already true" and "now says something
 * else" are different answers and are never collapsed.
 */
export async function establishLink(
  db: LinkQueryable,
  input: EmployeePrincipalLinkInput,
): Promise<EmployeePrincipalLinkRecord> {
  assertValidLinkInput(input);

  const existing = await readActiveLinkForEmployee(db, input.tenantId, input.employeeId);
  if (existing !== null) {
    if (existing.principalId === input.principalId) return existing;
    throw new EmployeePrincipalLinkConflict(
      "EMPLOYEE_ALREADY_LINKED",
      `employee ${input.employeeId} is already actively linked to principal ${existing.principalId} ` +
        `in tenant ${input.tenantId}; revoke that link before establishing another`,
    );
  }

  const id = `epl_${randomUUID()}`;
  try {
    const result = await db.query<LinkRow>(
      `INSERT INTO ${TABLE}
         (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status,
          asserted_by, assertion_reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, now(), now())
       RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        input.tenantId,
        input.principalId,
        input.employeeId,
        input.operatingCompanyId,
        input.linkSource,
        input.assertedBy ?? null,
        input.assertionReason ?? null,
      ],
    );
    return toRecord(result.rows[0]);
  } catch (error) {
    throw translateConstraintFailure(error, input);
  }
}

/** Map a Postgres integrity failure to the sentence describing what it prevented. Anything this
 *  module did not anticipate is re-thrown unchanged — swallowing an unknown database error would
 *  turn a real defect into a polite refusal. */
function translateConstraintFailure(error: unknown, input: EmployeePrincipalLinkInput): unknown {
  const constraint = (error as { constraint?: unknown } | null)?.constraint;
  if (constraint === EMPLOYEE_INDEX) {
    return new EmployeePrincipalLinkConflict(
      "EMPLOYEE_ALREADY_LINKED",
      `employee ${input.employeeId} already has an active link in tenant ${input.tenantId}`,
    );
  }
  if (constraint === PRINCIPAL_INDEX) {
    return new EmployeePrincipalLinkConflict(
      "PRINCIPAL_ALREADY_LINKED",
      `principal ${input.principalId} is already actively linked to a different Employee in tenant ` +
        `${input.tenantId}; one login is not two Employees`,
    );
  }
  if (constraint === MEMBER_FK) {
    return new EmployeePrincipalLinkConflict(
      "NOT_A_TENANT_MEMBER",
      `principal ${input.principalId} holds no membership in tenant ${input.tenantId}; granting one ` +
        "is an authorization decision this command does not make",
    );
  }
  return error;
}

/** The ACTIVE link for an Employee, or null. */
export async function readActiveLinkForEmployee(
  db: LinkQueryable,
  tenantId: string,
  employeeId: string,
): Promise<EmployeePrincipalLinkRecord | null> {
  const result = await db.query<LinkRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${TABLE}
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`,
    [tenantId, employeeId],
  );
  return result.rows.length === 1 ? toRecord(result.rows[0]) : null;
}

/** The ACTIVE link for a principal, or null. */
export async function readActiveLinkForPrincipal(
  db: LinkQueryable,
  tenantId: string,
  principalId: string,
): Promise<EmployeePrincipalLinkRecord | null> {
  const result = await db.query<LinkRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${TABLE}
      WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`,
    [tenantId, principalId],
  );
  return result.rows.length === 1 ? toRecord(result.rows[0]) : null;
}

/**
 * "Which Employee is this authenticated principal?" — the one question the runtime asks.
 *
 * Returns the Employee id or null. NULL IS A COMPLETE ANSWER: there is no fallback chain, and in
 * particular no fallback to `users/{uid}.technicianId` or to a `fieldops_technicians` id. A
 * principal with no link is not an Employee as far as this function is concerned, and a caller that
 * needs an Employee must fail closed on the null rather than reach for a second source.
 */
export async function resolveEmployeeIdForPrincipal(
  db: LinkQueryable,
  tenantId: string,
  principalId: string,
): Promise<string | null> {
  const link = await readActiveLinkForPrincipal(db, tenantId, principalId);
  return link?.employeeId ?? null;
}

/**
 * Revoke the ACTIVE link for an Employee. The row STAYS, with `status = 'revoked'` — the partial
 * unique indexes are declared `WHERE status = 'active'` precisely so history survives and a later
 * re-link is not blocked by it.
 *
 * Returns the revoked record, or null when there was no active link. Null rather than an error
 * because "there is nothing to revoke" is a legitimate end state for a caller that is making sure.
 */
export async function revokeLinkForEmployee(
  db: LinkQueryable,
  tenantId: string,
  employeeId: string,
): Promise<EmployeePrincipalLinkRecord | null> {
  const result = await db.query<LinkRow>(
    `UPDATE ${TABLE} SET status = 'revoked', updated_at = now()
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'
      RETURNING ${SELECT_COLUMNS}`,
    [tenantId, employeeId],
  );
  return result.rows.length === 1 ? toRecord(result.rows[0]) : null;
}

/** Every link for an Employee, active and revoked, oldest first. The audit view. */
export async function listLinkHistoryForEmployee(
  db: LinkQueryable,
  tenantId: string,
  employeeId: string,
): Promise<readonly EmployeePrincipalLinkRecord[]> {
  const result = await db.query<LinkRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${TABLE}
      WHERE tenant_id = $1 AND employee_id = $2
      ORDER BY created_at, id`,
    [tenantId, employeeId],
  );
  return result.rows.map(toRecord);
}
