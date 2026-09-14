// The governed PostgreSQL accountability writer: an accountable-person change and its history, atomically.
//
// Owner ruling 2026-09-14, activation blocker #1 (Option B): PostgreSQL is the governed accountability AUDIT
// AUTHORITY. The audit record of an accountability change is its append-only `eos_commercial.accountability_handoffs`
// row (migration 020, with `action` and `source` from 021), written in the SAME transaction as the
// `accountable_employee_id` it describes -- the shape `transferCommercialOwnership` gives ownership. There is no
// Firestore AuditAction for accountability and there must not be one.
//
// WHAT THIS MODULE DOES NOT DECIDE. Who may act, whether the person resolves, and whether they are currently
// eligible are the governed establishment / handoff orchestration's questions, answered by the mint. This writer
// accepts ONLY a minted `EstablishedAccountablePerson` and persists what it says; it performs no Employee lookup
// of its own (OD-7: resolution happens once).
//
// WHAT IT REFUSES, all before any mutation:
//   * a family outside OD-16, a missing record id, tenant or actor;
//   * a value the mint did not produce (a bare id, a plain object, a serialized copy);
//   * a person minted in ANOTHER tenant;
//   * ESTABLISHMENT on a record that already has an accountable person (that is a handoff, and must say so);
//   * HANDOFF on a record that has none (a first accountable person is an establishment, never a handoff);
//   * HANDOFF to the person already accountable, or with a derived source (derivation is initialization only);
//   * HANDOFF whose stated expected predecessor is not the one read under lock.
//
// NOT EXPORTED FROM index.ts and imported by no callable. Wiring a live commercial write path to it is
// activation blocker #2, and blocker #2 must move that path to PostgreSQL rather than weaken atomicity.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { AccountabilityFamily } from "../responsibility/accountabilityFamilyScope";
import {
  accountablePersonStorage,
  isGovernedAccountablePerson,
  type AccountablePersonSource,
  type EstablishedAccountablePerson,
} from "../responsibility/accountablePersonStorage";

const HISTORY_TABLE = "eos_commercial.accountability_handoffs";

/** The two kinds of accountability change, exactly as migration 021 generates them. */
export const ACCOUNTABILITY_HISTORY_ACTIONS = Object.freeze(["ESTABLISHMENT", "HANDOFF"] as const);
export type AccountabilityHistoryAction = (typeof ACCOUNTABILITY_HISTORY_ACTIONS)[number];

/** family -> the history column that names the record. Exactly one is non-null per row (migration 020). */
const HISTORY_RECORD_COLUMN: Readonly<Record<AccountabilityFamily, string>> = Object.freeze({
  opportunity: "opportunity_id",
  salesAgreement: "sales_agreement_id",
  salesOrder: "sales_order_id",
});

export type CommercialAccountabilityWriteRefusal =
  | "REQUEST_INVALID"
  | "FAMILY_NOT_ACCOUNTABLE"
  | "ACCOUNTABLE_PERSON_NOT_GOVERNED"
  | "ACCOUNTABLE_PERSON_OTHER_TENANT"
  | "RECORD_NOT_FOUND"
  | "ALREADY_ESTABLISHED"
  | "NOTHING_TO_HAND_OFF"
  | "HANDOFF_IS_NO_OP"
  | "HANDOFF_SOURCE_NOT_EXPLICIT"
  | "PRECONDITION_FAILED";

export class CommercialAccountabilityWriteError extends Error {
  constructor(readonly code: CommercialAccountabilityWriteRefusal, message: string) {
    super(message);
    this.name = "CommercialAccountabilityWriteError";
  }
}

const refuse = (code: CommercialAccountabilityWriteRefusal, message: string): never => {
  throw new CommercialAccountabilityWriteError(code, message);
};

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export interface CommercialAccountabilityChangeInput {
  readonly family: AccountabilityFamily;
  readonly recordId: string;
  /** The mint's output. Nothing else is accepted. */
  readonly accountablePerson: EstablishedAccountablePerson;
  readonly reason?: string | null;
  /** HANDOFF only: the predecessor the decision was made against. Refused if the locked row disagrees. */
  readonly expectedPreviousAccountableEmployeeId?: string;
}

/** One accountability history row, as recorded. */
export interface CommercialAccountabilityHistoryRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly family: AccountabilityFamily;
  readonly recordId: string;
  readonly action: AccountabilityHistoryAction;
  readonly source: AccountablePersonSource;
  readonly previousAccountableEmployeeId: string | null;
  readonly newAccountableEmployeeId: string;
  readonly eligibilityPolicyId: string;
  readonly reason: string | null;
  readonly recordedBy: string;
  readonly effectiveAt: Date;
  readonly recordedAt: Date;
}

type Queryable = Pick<PoolClient, "query">;

/**
 * Stage ONE accountability change onto the caller's open transaction: lock the record, refuse or mutate the
 * accountable person, append its history. The caller commits or rolls back -- which is what lets a future
 * PostgreSQL commercial create path put the record, the establishment and the history in one transaction.
 */
export async function stageCommercialAccountablePersonChange(
  db: Queryable,
  tenantId: string,
  actorId: string,
  action: AccountabilityHistoryAction,
  input: CommercialAccountabilityChangeInput,
): Promise<CommercialAccountabilityHistoryRecord> {
  if (!ACCOUNTABILITY_HISTORY_ACTIONS.includes(action)) refuse("REQUEST_INVALID", `unknown accountability action ${String(action)}`);
  if (!nonEmpty(tenantId) || !nonEmpty(actorId) || !input || !nonEmpty(input.recordId)) {
    refuse("REQUEST_INVALID", "tenantId, actorId and recordId are required");
  }
  const storage = accountablePersonStorage(input.family);
  if (!storage) {
    return refuse("FAMILY_NOT_ACCOUNTABLE", `${String(input.family)} carries no governed accountability (#189 OD-16)`);
  }
  const person = input.accountablePerson;
  if (!isGovernedAccountablePerson(person)) {
    refuse("ACCOUNTABLE_PERSON_NOT_GOVERNED", "only a value minted by the governed establishment or handoff may be persisted (#184)");
  }
  if (person.tenantId !== tenantId) {
    refuse("ACCOUNTABLE_PERSON_OTHER_TENANT", `the accountable person was resolved in another tenant than ${tenantId}`);
  }
  if (action === "HANDOFF" && person.source !== "EXPLICIT") {
    refuse("HANDOFF_SOURCE_NOT_EXPLICIT", "a handoff names its new accountable person explicitly; derivation from the owner is initialization only (#181)");
  }

  const current = await db.query<{ accountable: string | null }>(
    `SELECT ${storage.column} AS accountable FROM ${storage.table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, input.recordId],
  );
  if (current.rows.length === 0) refuse("RECORD_NOT_FOUND", `no ${input.family} ${input.recordId} in this tenant`);
  const previous = current.rows[0].accountable;

  if (action === "ESTABLISHMENT" && previous !== null) {
    refuse("ALREADY_ESTABLISHED", `${input.family} ${input.recordId} already has an accountable person; changing it is a HANDOFF`);
  }
  if (action === "HANDOFF") {
    if (previous === null) refuse("NOTHING_TO_HAND_OFF", `${input.family} ${input.recordId} has no accountable person; a first accountable person is an ESTABLISHMENT`);
    if (previous === person.accountableEmployeeId) refuse("HANDOFF_IS_NO_OP", `${person.accountableEmployeeId} is already accountable`);
    if (input.expectedPreviousAccountableEmployeeId !== undefined && input.expectedPreviousAccountableEmployeeId !== previous) {
      refuse("PRECONDITION_FAILED", "the accountable person changed since the handoff was decided");
    }
  }

  await db.query(
    `UPDATE ${storage.table} SET ${storage.column} = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, input.recordId, person.accountableEmployeeId, actorId],
  );
  const inserted = await db.query<{
    id: string;
    action: AccountabilityHistoryAction;
    source: AccountablePersonSource;
    previous_accountable_employee_id: string | null;
    new_accountable_employee_id: string;
    eligibility_policy_id: string;
    reason: string | null;
    recorded_by: string;
    effective_at: Date;
    recorded_at: Date;
  }>(
    `INSERT INTO ${HISTORY_TABLE}
       (id, tenant_id, ${HISTORY_RECORD_COLUMN[storage.family]}, previous_accountable_employee_id,
        new_accountable_employee_id, eligibility_policy_id, source, reason, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, action, source, previous_accountable_employee_id, new_accountable_employee_id,
               eligibility_policy_id, reason, recorded_by, effective_at, recorded_at`,
    [
      `ach_${randomUUID()}`, tenantId, input.recordId, previous, person.accountableEmployeeId,
      person.eligibilityPolicyId, person.source, input.reason ?? null, actorId,
    ],
  );
  const row = inserted.rows[0];
  return {
    id: row.id,
    tenantId,
    family: storage.family,
    recordId: input.recordId,
    action: row.action,
    source: row.source,
    previousAccountableEmployeeId: row.previous_accountable_employee_id,
    newAccountableEmployeeId: row.new_accountable_employee_id,
    eligibilityPolicyId: row.eligibility_policy_id,
    reason: row.reason,
    recordedBy: row.recorded_by,
    effectiveAt: row.effective_at,
    recordedAt: row.recorded_at,
  };
}

async function inOwnTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** First governed accountable person on a record that has none -- at creation or later. One transaction. */
export function establishCommercialAccountablePerson(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CommercialAccountabilityChangeInput,
): Promise<CommercialAccountabilityHistoryRecord> {
  return inOwnTransaction(pool, (client) => stageCommercialAccountablePersonChange(client, tenantId, actorId, "ESTABLISHMENT", input));
}

/** Change a record's accountable person to a different governed eligible Employee. One transaction. */
export function handOffCommercialAccountablePerson(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CommercialAccountabilityChangeInput,
): Promise<CommercialAccountabilityHistoryRecord> {
  return inOwnTransaction(pool, (client) => stageCommercialAccountablePersonChange(client, tenantId, actorId, "HANDOFF", input));
}
