// The eos_ops inventory COMMITMENT repository, and the Work Order inventory-effect REPLAY authority.
//
// ════════════════════ WHAT THIS IS, AND WHAT IT IS NOT ════════════════════
//
// This is the persistence boundary for migration 008's two tables. It is the Postgres target for the
// two census blockers that had none (NB-2: no eos_ops reservation table; NB-7: no home for
// `inventory_sync_status`), and nothing more. Like `cycleCountRepository.ts`, it is NOT wired to any
// HTTP operation, is NOT called by the deployed client, and no live writer is cut over to it.
//
// IT IS A COMMITMENT AUTHORITY, NOT AN AVAILABILITY AUTHORITY. It answers "how much of this Part is
// promised" and "what does this Work Order still hold". It deliberately does NOT answer "how much is
// available", and `reserve()` deliberately does NOT gate on availability — see the refusal below.
//
// ════════════════════ COMMITMENT IS NOT MOVEMENT ════════════════════
//
// RESERVED / RELEASED / CONSUMED are commitment lifecycle facts. They write to
// `eos_ops.inventory_commitments` and NEVER to `eos_ops.inventory_movements`; the three labels are
// not members of `ops_movement_type` and must never be added to it. Migration 008's header carries
// the full argument; the short version is that a reservation moves no stock, and a commitment row
// has no location to put in `inventory_movements`' NOT NULL location columns.
//
// ════════════════════ WHY THERE IS NO AVAILABILITY CHECK HERE ════════════════════
//
// `inventoryService.ts`'s `reserveParts()` refuses a reservation it cannot cover. Reproducing that
// here would require physical on-hand, and physical on-hand is a sum over `inventory_movements`
// restricted to ELIGIBLE locations — status==ACTIVE Warehouses, with MOBILE/truck stock excluded.
// eos_ops cannot express that restriction: migration 005 deliberately created no `locations` table
// (:32-43), so Warehouse status is still Firestore reference data. A sum over every location in the
// movement ledger would count truck stock as committable, which is EXACTLY the defect DECISIONS #165
// removed from the live path ("'all locations' counted truck stock as committable. Both are gone.").
//
// So this layer refuses to author a number it cannot author correctly. Availability gating belongs
// to the governed command that calls this repository, once the reference-data migration named in the
// cutover-boundary doc has given eos_ops a Warehouse authority to filter on.
//
// ════════════════════ WHY THERE IS NO PER-PART MUTEX TABLE ════════════════════
//
// The live path holds a per-part sentinel (`inventory_reservation_locks`, `inventoryService.ts:60-65`).
// That collection is a MUTEX, not a reservation: its own comment says it "contains no quantity and is
// never read for availability", and it exists only to force a competing reserve into the same
// Firestore transaction's read set so the availability check cannot be lost to a race. It holds no
// business fact, so it has NO target table here and must be RETIRED at cutover rather than migrated.
//
// Nothing replaces it yet because there is nothing to protect: a mutex guards a check-then-act, and
// this layer performs no check. When availability gating arrives, the Postgres primitive is a row
// lock or an advisory lock taken inside the same transaction as the insert — not a second table.

import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { type OperatingCompanyKey, requireOperatingCompanyKey } from "./operatingCompanyCustody.js";

const SCHEMA = "eos_ops";
const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

/** A `pg` handle that can run a query — the Pool itself, or a client inside an open transaction. */
export type Queryable = Pool | PoolClient;

/** `eos_ops.ops_commitment_event_type`. Disjoint from `ops_movement_type`, by construction. */
export const COMMITMENT_EVENT_TYPES = ["RESERVED", "RELEASED", "CONSUMED"] as const;
export type CommitmentEventType = (typeof COMMITMENT_EVENT_TYPES)[number];

/** `eos_ops.ops_work_order_effect_state` — exactly the three keys of `STATE_TRIGGERS`. */
export const WORK_ORDER_EFFECT_STATES = ["DISPATCHED", "COMPLETED", "CANCELLED"] as const;
export type WorkOrderEffectState = (typeof WORK_ORDER_EFFECT_STATES)[number];

/** `eos_ops.ops_work_order_effect_status`. */
export const WORK_ORDER_EFFECT_STATUSES = ["CLAIMED", "PROCESSED", "FAILED"] as const;
export type WorkOrderEffectStatus = (typeof WORK_ORDER_EFFECT_STATUSES)[number];

export class InventoryCommitmentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "InventoryCommitmentError";
  }
}

/**
 * The same idempotency key was already used for a DIFFERENT commitment.
 *
 * Mirrors `IdempotencyConflictError` in `inventoryLedger/operationalMovementRepository.ts`: replay
 * iff the stored row says the same thing, conflict iff it does not. A conflict is never silently
 * treated as a replay, because that would drop a real commitment on the floor.
 */
export class CommitmentIdempotencyConflictError extends InventoryCommitmentError {
  constructor(idempotencyKey: string) {
    super("IDEMPOTENCY_CONFLICT", `idempotencyKey ${idempotencyKey} was already used for a different commitment`);
  }
}

/** One row of `eos_ops.inventory_commitments`. */
export interface CommitmentEventRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly workOrderId: string;
  readonly partId: string;
  readonly eventType: CommitmentEventType;
  readonly quantity: number;
  readonly idempotencyKey: string;
}

export interface CommitmentEventInput {
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly workOrderId: string;
  readonly partId: string;
  readonly eventType: CommitmentEventType;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

export type CommitmentWriteOutcome = "applied" | "replayed";

export interface CommitmentWriteResult {
  readonly outcome: CommitmentWriteOutcome;
  readonly record: CommitmentEventRecord;
}

// ════════════════════ writing commitment events ════════════════════

/**
 * Append exactly ONE commitment event, idempotently.
 *
 * Append-only: a release is a new row, never an edit to the reservation it releases. This module
 * offers no update and no delete against `inventory_commitments`, and a static test proves it —
 * the same enforcement posture migration 005 records for `inventory_movements` (:53-59).
 */
export async function recordCommitmentEvent(
  db: Queryable,
  input: CommitmentEventInput,
): Promise<CommitmentWriteResult> {
  const companyKey = requireCompany(input.operatingCompanyKey);
  requirePositiveQuantity(input.quantity, input.partId);
  requireNonEmpty(input.idempotencyKey, "idempotencyKey");

  const id = newId("cmt");
  const { rows } = await db.query<CommitmentRow>(
    `INSERT INTO ${SCHEMA}.inventory_commitments
       (id, tenant_id, operating_company_key, work_order_id, part_id, event_type, quantity,
        idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING id, tenant_id, operating_company_key, work_order_id, part_id, event_type, quantity,
               idempotency_key`,
    [id, input.tenantId, companyKey, input.workOrderId, input.partId, input.eventType,
     input.quantity, input.idempotencyKey, input.actorId],
  );

  const inserted = rows[0];
  if (inserted) return { outcome: "applied", record: toRecord(inserted) };

  // The key is taken. Replay only if the stored row says exactly the same thing; otherwise this is a
  // different commitment wearing an already-used identity, and it must not be swallowed.
  const existing = await readByIdempotencyKey(db, input.tenantId, input.idempotencyKey);
  if (!existing) {
    // The conflicting row belongs to another tenant's key space, which this tenant cannot see. The
    // unique index is per-tenant, so this is unreachable in practice; it fails closed regardless.
    throw new InventoryCommitmentError("IDEMPOTENCY_UNREADABLE", "the conflicting commitment is not visible to this tenant");
  }
  if (
    existing.operatingCompanyKey !== companyKey ||
    existing.workOrderId !== input.workOrderId ||
    existing.partId !== input.partId ||
    existing.eventType !== input.eventType ||
    existing.quantity !== input.quantity
  ) {
    throw new CommitmentIdempotencyConflictError(input.idempotencyKey);
  }
  return { outcome: "replayed", record: existing };
}

export interface ReserveLine {
  readonly partId: string;
  readonly quantity: number;
}

export interface WorkOrderCommitmentContext {
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly workOrderId: string;
  readonly actorId: string;
  /**
   * The replay identity of THIS operation. Every row it writes derives its own key from this one
   * deterministically (`<base>:<eventType>:<partId>`), so re-running the whole operation replays
   * every row rather than duplicating any of them.
   */
  readonly idempotencyKey: string;
}

/**
 * DISPATCHED. Reserve the requested quantity per Part, ALL-OR-NOTHING in one database transaction.
 *
 * Duplicate lines for the same Part are summed FIRST, exactly as `reserveParts()` does
 * (`inventoryService.ts:229-233`) — a Work Order's plan may legitimately carry two rows for one sku,
 * and reserving them separately would evaluate each against the same un-decremented figure.
 *
 * No availability gate: see this file's header for why that number cannot yet be authored here.
 */
export async function reserve(
  pool: Pool,
  ctx: WorkOrderCommitmentContext,
  lines: readonly ReserveLine[],
): Promise<readonly CommitmentWriteResult[]> {
  const byPart = new Map<string, number>();
  for (const line of lines) {
    requirePositiveQuantity(line.quantity, line.partId);
    byPart.set(line.partId, (byPart.get(line.partId) ?? 0) + line.quantity);
  }
  if (byPart.size === 0) return [];

  return inTransaction(pool, async (client) => {
    const written: CommitmentWriteResult[] = [];
    for (const [partId, quantity] of sorted(byPart)) {
      written.push(await recordCommitmentEvent(client, {
        ...ctx, partId, eventType: "RESERVED", quantity,
        idempotencyKey: derivedKey(ctx.idempotencyKey, "RESERVED", partId),
      }));
    }
    return written;
  });
}

/**
 * CANCELLED. Release everything this Work Order still holds, per Part, in one transaction.
 *
 * READ FROM THE COMMITMENT LEDGER, NOT FROM THE PLAN — the orphan fix DECISIONS #165 landed. A
 * requirement deleted from the Work Order's plan after dispatch still has commitment rows, so a
 * plan-driven loop cannot see the reservation it left behind; this derivation can. Safe when nothing
 * was ever reserved: the map is empty and no row is written.
 */
export async function releaseOutstanding(
  pool: Pool,
  ctx: WorkOrderCommitmentContext,
): Promise<readonly CommitmentWriteResult[]> {
  return inTransaction(pool, async (client) => {
    const outstanding = await outstandingByPart(client, ctx.tenantId, ctx.workOrderId);
    const written: CommitmentWriteResult[] = [];
    for (const [partId, quantity] of sorted(outstanding)) {
      if (quantity <= 0) continue;
      written.push(await recordCommitmentEvent(client, {
        ...ctx, partId, eventType: "RELEASED", quantity,
        idempotencyKey: derivedKey(ctx.idempotencyKey, "RELEASED", partId),
      }));
    }
    return written;
  });
}

export interface ConsumptionLine {
  readonly partId: string;
  readonly qtyPlanned: number;
  /** Governed ACTUAL usage. Omitted means "no field usage recorded", which falls back to qtyPlanned. */
  readonly qtyUsed?: number;
}

/**
 * COMPLETED. Reconcile this Work Order's commitment against what was actually used, in ONE
 * transaction, per Part:
 *
 *   top up   the outstanding reservation to qtyPlanned (RESERVED, only the positive delta)
 *   consume  the governed actual usage                  (CONSUMED)
 *   release  the unused remainder qtyPlanned - actual   (RELEASED)
 *
 * This is `consumeParts()`'s arithmetic (`inventoryService.ts:389-420`) with one deliberate
 * difference: overage is REFUSED, not clamped. The live path relies on `mergeQtyUsed()` having
 * already clamped `qtyUsed` to [0, qtyPlanned] upstream, and its own comment records that the
 * governed overage path (used > planned) "is a separate build (P1), not handled by this function".
 * A persistence layer that silently clamped would destroy the evidence that an overage happened.
 *
 * NOTHING PHYSICAL HAPPENS HERE. A CONSUMED commitment row reconciles a promise; the physical
 * removal of stock is a `WORK_ORDER_CONSUMPTION` row in `inventory_movements`, written by whoever
 * owns that movement. The two are separate facts and this function authors only the first.
 */
export async function reconcileConsumption(
  pool: Pool,
  ctx: WorkOrderCommitmentContext,
  lines: readonly ConsumptionLine[],
): Promise<readonly CommitmentWriteResult[]> {
  const planned = new Map<string, { qtyPlanned: number; qtyUsed: number }>();
  for (const line of lines) {
    requirePositiveQuantity(line.qtyPlanned, line.partId);
    const used = line.qtyUsed ?? line.qtyPlanned;
    if (!Number.isInteger(used) || used < 0) {
      throw new InventoryCommitmentError("QUANTITY_INVALID", `qtyUsed for ${line.partId} must be a non-negative integer`);
    }
    if (used > line.qtyPlanned) {
      throw new InventoryCommitmentError(
        "CONSUMPTION_EXCEEDS_PLAN",
        `qtyUsed ${used} exceeds qtyPlanned ${line.qtyPlanned} for ${line.partId}; the governed overage path is not this function`,
      );
    }
    const existing = planned.get(line.partId);
    planned.set(line.partId, existing
      ? { qtyPlanned: existing.qtyPlanned + line.qtyPlanned, qtyUsed: existing.qtyUsed + used }
      : { qtyPlanned: line.qtyPlanned, qtyUsed: used });
  }
  if (planned.size === 0) return [];

  return inTransaction(pool, async (client) => {
    const outstanding = await outstandingByPart(client, ctx.tenantId, ctx.workOrderId);
    const written: CommitmentWriteResult[] = [];
    for (const [partId, { qtyPlanned, qtyUsed }] of sorted(planned)) {
      const topUp = qtyPlanned - Math.max(0, outstanding.get(partId) ?? 0);
      if (topUp > 0) {
        written.push(await recordCommitmentEvent(client, {
          ...ctx, partId, eventType: "RESERVED", quantity: topUp,
          idempotencyKey: derivedKey(ctx.idempotencyKey, "RESERVED", partId),
        }));
      }
      if (qtyUsed > 0) {
        written.push(await recordCommitmentEvent(client, {
          ...ctx, partId, eventType: "CONSUMED", quantity: qtyUsed,
          idempotencyKey: derivedKey(ctx.idempotencyKey, "CONSUMED", partId),
        }));
      }
      const remainder = qtyPlanned - qtyUsed;
      if (remainder > 0) {
        written.push(await recordCommitmentEvent(client, {
          ...ctx, partId, eventType: "RELEASED", quantity: remainder,
          idempotencyKey: derivedKey(ctx.idempotencyKey, "RELEASED", partId),
        }));
      }
    }
    return written;
  });
}

// ════════════════════ the derivations ════════════════════

/**
 * THE COMMITTED-QUANTITY DERIVATION: how much of one Part is promised, across every Work Order.
 *
 * `RESERVED − RELEASED`, floored at 0, scoped to one tenant AND one operating company. Never a
 * stored total — the same rule migration 005 states for balances: a second maintained number is a
 * second thing to disagree with the evidence.
 *
 * CONSUMED IS DELIBERATELY NOT SUBTRACTED, and this is `openCommitment()`'s arithmetic
 * (`inventoryService.ts:152-160`) preserved EXACTLY, not re-derived. Its reason there is precise:
 * nothing in the live platform removes consumed stock from physical on-hand, so the consumed
 * quantity is kept counted as committed to keep it out of availability — "wrong reason, right
 * number".
 *
 * THAT REASON DOES NOT AUTOMATICALLY HOLD IN eos_ops, AND THIS IS THE OPEN QUESTION, NOT A DECISION.
 * `ops_movement_type` DOES contain `WORK_ORDER_CONSUMPTION`, so a governed consumption here can
 * record a real physical removal — and once it does, on-hand drops at consumption and a pool that
 * also kept CONSUMED committed would subtract the same quantity twice. Whether this derivation
 * switches to `RESERVED − RELEASED − CONSUMED` is exactly the ruling DECISIONS #165 records as
 * blocking ("the fix is either a physical removal movement at consumption or a change to that
 * ratified derivation, both of which are inventory-semantics decisions this package is not
 * authorised to make"). This module preserves the live arithmetic and makes no such decision.
 *
 * NOTHING SUBTRACTS THIS FROM ANYTHING YET. There is no availability derivation in eos_ops (see the
 * header), so no reader can currently be wrong either way.
 */
export async function committedQuantityForPart(
  db: Queryable,
  tenantId: string,
  operatingCompanyKey: OperatingCompanyKey,
  partId: string,
): Promise<number> {
  const companyKey = requireCompany(operatingCompanyKey);
  const { rows } = await db.query<{ committed: string | null }>(
    `SELECT COALESCE(SUM(
              CASE event_type
                WHEN 'RESERVED' THEN quantity
                WHEN 'RELEASED' THEN -quantity
                ELSE 0
              END), 0) AS committed
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND operating_company_key = $2 AND part_id = $3`,
    [tenantId, companyKey, partId],
  );
  return Math.max(0, Number(rows[0]?.committed ?? 0));
}

/**
 * What ONE Work Order still holds, per Part: `RESERVED − RELEASED − CONSUMED`.
 *
 * This is `outstandingByPart()` / `getOutstandingReservation()` (`inventoryService.ts:163-186`,
 * `:277-291`) and it DOES subtract CONSUMED — correctly and uncontroversially, because a consumed
 * unit is no longer something this Work Order is still holding a claim on. The pool derivation above
 * asks a different question and has a different answer; the two are not in tension.
 *
 * Parts with no commitment rows are simply absent from the map. A negative value is returned as-is
 * rather than floored, because a negative outstanding would be evidence of a real accounting fault
 * (more released or consumed than was ever reserved) and hiding it would hide the fault.
 */
export async function outstandingByPart(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ part_id: string; outstanding: string }>(
    `SELECT part_id,
            SUM(CASE event_type WHEN 'RESERVED' THEN quantity ELSE -quantity END) AS outstanding
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND work_order_id = $2
      GROUP BY part_id
      ORDER BY part_id`,
    [tenantId, workOrderId],
  );
  return new Map(rows.map((row) => [row.part_id, Number(row.outstanding)]));
}

/** Every commitment event this Work Order has raised, oldest first. The evidence behind the sums. */
export async function readCommitmentHistory(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
): Promise<readonly CommitmentEventRecord[]> {
  const { rows } = await db.query<CommitmentRow>(
    `SELECT id, tenant_id, operating_company_key, work_order_id, part_id, event_type, quantity,
            idempotency_key
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY created_at, id`,
    [tenantId, workOrderId],
  );
  return rows.map(toRecord);
}

// ════════════════════ the Work Order replay authority ════════════════════

export interface WorkOrderEffectRecord {
  readonly tenantId: string;
  readonly workOrderId: string;
  readonly state: WorkOrderEffectState;
  readonly status: WorkOrderEffectStatus;
  readonly claimedBy: string;
  readonly failureMessage: string | null;
  readonly attempts: number;
}

/**
 * Claim (workOrderId, state) for processing. `true` means this caller owns the attempt.
 *
 * ONE STATEMENT, NOT A READ FOLLOWED BY A WRITE. The primary key is the serialization: the INSERT
 * claims an unseen state; the ON CONFLICT re-claims only a FAILED one; a CLAIMED or PROCESSED row
 * matches neither and the statement returns no row, which is the refusal. Two concurrent callers
 * cannot both be told `true` — the second's statement finds the first's row already committed.
 *
 * This replaces `claimStateForProcessing()`'s Firestore transaction (`inventoryService.ts:465-476`)
 * with the same guarantee and no check-then-act window at all.
 *
 * A CLAIMED row whose process died is NOT reclaimable, exactly as a Firestore `claims[state]`
 * survives a crash today. Preserved deliberately; a lease would be new behaviour, not a migration.
 */
export async function claimWorkOrderEffect(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
  actorId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    // Aliased `AS effect` so the DO UPDATE clause can name the EXISTING row's columns unambiguously
    // beside EXCLUDED's (the proposed row's).
    `INSERT INTO ${SCHEMA}.work_order_inventory_effects AS effect
       (tenant_id, work_order_id, state, status, claimed_by)
     VALUES ($1, $2, $3, 'CLAIMED', $4)
     ON CONFLICT (tenant_id, work_order_id, state) DO UPDATE
        SET status = 'CLAIMED',
            claimed_by = EXCLUDED.claimed_by,
            claimed_at = now(),
            attempts = effect.attempts + 1,
            failure_message = NULL,
            failed_at = NULL,
            updated_at = now()
      WHERE effect.status = 'FAILED'
     RETURNING effect.work_order_id`,
    [tenantId, workOrderId, state, actorId],
  );
  return rows.length === 1;
}

/**
 * The effect succeeded. Marks it PROCESSED and clears the recorded failure, exactly as
 * `markStateProcessed()` deletes `failures[state]` on success.
 *
 * Only a CLAIMED row may be marked processed. A caller that never claimed cannot declare an effect
 * applied, and a PROCESSED row cannot be re-marked — both refuse rather than write.
 */
export async function markWorkOrderEffectProcessed(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE ${SCHEMA}.work_order_inventory_effects
        SET status = 'PROCESSED', processed_at = now(),
            failure_message = NULL, failed_at = NULL, updated_at = now()
      WHERE tenant_id = $1 AND work_order_id = $2 AND state = $3 AND status = 'CLAIMED'`,
    [tenantId, workOrderId, state],
  );
  if (rowCount !== 1) {
    throw new InventoryCommitmentError("EFFECT_NOT_CLAIMED", `${workOrderId}/${state} is not claimed by anyone; it cannot be marked processed`);
  }
}

/**
 * The effect failed. Records why, and RELEASES the claim in the same statement.
 *
 * Firestore needs two calls for this (`recordFailure()` then `clearClaim()`,
 * `inventoryService.ts:539-547`) because the failure and the claim live in different map fields. Here
 * FAILED *is* "not claimed": one status column cannot hold both, so a retry's
 * `claimWorkOrderEffect()` sees a claimable row with no second write to depend on.
 */
export async function recordWorkOrderEffectFailure(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
  failureMessage: string,
): Promise<void> {
  requireNonEmpty(failureMessage, "failureMessage");
  const { rowCount } = await db.query(
    `UPDATE ${SCHEMA}.work_order_inventory_effects
        SET status = 'FAILED', failure_message = $4, failed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND work_order_id = $2 AND state = $3 AND status = 'CLAIMED'`,
    [tenantId, workOrderId, state, failureMessage],
  );
  if (rowCount !== 1) {
    throw new InventoryCommitmentError("EFFECT_NOT_CLAIMED", `${workOrderId}/${state} is not claimed by anyone; there is no attempt to fail`);
  }
}

/**
 * Has this (workOrderId, state) effect already been applied?
 *
 * The Postgres form of `hasAppliedReservation()` (`inventoryService.ts:377-382`), which asks the
 * same question of `processedStates.DISPATCHED`. An unseen Work Order is `false`, never an error:
 * "never processed" is the honest answer for a Work Order that has had no effect yet.
 */
export async function hasProcessedWorkOrderEffect(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
): Promise<boolean> {
  const { rows } = await db.query<{ status: WorkOrderEffectStatus }>(
    `SELECT status FROM ${SCHEMA}.work_order_inventory_effects
      WHERE tenant_id = $1 AND work_order_id = $2 AND state = $3`,
    [tenantId, workOrderId, state],
  );
  return rows[0]?.status === "PROCESSED";
}

/** Every recorded effect for one Work Order — the operator/runbook read. */
export async function readWorkOrderEffects(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
): Promise<readonly WorkOrderEffectRecord[]> {
  const { rows } = await db.query<{
    tenant_id: string; work_order_id: string; state: WorkOrderEffectState;
    status: WorkOrderEffectStatus; claimed_by: string; failure_message: string | null; attempts: number;
  }>(
    `SELECT tenant_id, work_order_id, state, status, claimed_by, failure_message, attempts
       FROM ${SCHEMA}.work_order_inventory_effects
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY state`,
    [tenantId, workOrderId],
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    workOrderId: row.work_order_id,
    state: row.state,
    status: row.status,
    claimedBy: row.claimed_by,
    failureMessage: row.failure_message,
    attempts: Number(row.attempts),
  }));
}

// ════════════════════ internals ════════════════════

interface CommitmentRow {
  id: string;
  tenant_id: string;
  operating_company_key: string;
  work_order_id: string;
  part_id: string;
  event_type: CommitmentEventType;
  quantity: number;
  idempotency_key: string;
}

function toRecord(row: CommitmentRow): CommitmentEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    operatingCompanyKey: row.operating_company_key,
    workOrderId: row.work_order_id,
    partId: row.part_id,
    eventType: row.event_type,
    quantity: Number(row.quantity),
    idempotencyKey: row.idempotency_key,
  };
}

async function readByIdempotencyKey(
  db: Queryable,
  tenantId: string,
  idempotencyKey: string,
): Promise<CommitmentEventRecord | null> {
  const { rows } = await db.query<CommitmentRow>(
    `SELECT id, tenant_id, operating_company_key, work_order_id, part_id, event_type, quantity,
            idempotency_key
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, idempotencyKey],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason rather
 * than a constraint name — the same posture `createSheet` takes in `cycleCountRepository.ts`.
 */
function requireCompany(value: unknown): OperatingCompanyKey {
  return requireOperatingCompanyKey(value);
}

function requirePositiveQuantity(quantity: unknown, partId: string): void {
  if (!Number.isInteger(quantity) || (quantity as number) <= 0) {
    throw new InventoryCommitmentError(
      "QUANTITY_INVALID",
      `commitment quantity for ${partId} must be a positive integer; direction is carried by the event type, never by a sign`,
    );
  }
}

function requireNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InventoryCommitmentError("FIELD_REQUIRED", `${field} is required`);
  }
}

/** Deterministic per-row replay identity, so replaying an operation replays each row it wrote. */
function derivedKey(base: string, eventType: CommitmentEventType, partId: string): string {
  return `${base}:${eventType}:${partId}`;
}

/** Stable iteration order, so a multi-row operation writes in the same order on every replay. */
function sorted<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * One transaction around a whole operation. All-or-nothing: a Work Order must never end up holding
 * half a reservation, which is the same rule `reserveParts()` states ("no partial reservations ever
 * land"). Never split these writes across round trips outside a transaction.
 */
async function inTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
