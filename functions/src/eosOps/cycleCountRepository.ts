// The eos_ops Cycle Count repository — schema/transaction-boundary foundation only.
//
// ════════════════════ WHAT THIS PROVES, AND WHAT IT DOES NOT ════════════════════
//
// This is the P0 REPOSITORY CONTRACT the Owner ruling asked for: the blind-open/submitted-reveal
// read contract, the sheet/line lifecycle, and the transaction boundary a future `reconcileCycleCount`
// command will use to stage inventory adjustment evidence. It is NOT wired to any HTTP operation and
// NOT called by the deployed client -- see docs/design/eos-operational-data-plane-inventory-authority-
// cutover.md for why a full command surface is out of scope for this PR.
//
// ════════════════════ THE BLIND CONTRACT LIVES HERE, NOT IN SQL ════════════════════
//
// `cycle_count_lines.expected_quantity` / `expected_serial_numbers` are ordinary columns; nothing in
// the migration hides them from a SELECT *. What makes the count blind is that `readLineForCounter`
// -- the ONLY read this module exposes for the party doing the counting -- never selects them before
// `submitted_at` is set. `readLineForReview` is a SEPARATE function, for the disposition path, and
// its result always carries them. A caller cannot get the redacted view to reveal more by asking
// differently, because the redaction is a different SQL projection, not a filter applied afterward.
//
// ════════════════════ WHY THE LEDGER ROW AND THE LINE UPDATE ARE ONE TRANSACTION ════════════════════
//
// `reconcileLine` inserts the `inventory_movements` row and updates the line's `RECONCILED` status
// and `ledger_movement_id` inside ONE `client.query` sequence wrapped in BEGIN/COMMIT. A crash
// between the two would otherwise leave either a ledger movement no line points at, or a RECONCILED
// line with no evidence of what it did -- exactly the "second authority" shape the Owner ruling
// forbids. Never split into two round trips outside a transaction.
//
// ════════════════════ SEPARATION OF DUTIES ════════════════════
//
// `reconcileLine` refuses when the disposing actor is the same principal recorded as `submittedBy`
// for a line with a non-zero variance -- the same guard the existing Firestore command family
// enforces (`CycleCountSelfApprovalError`), reproduced here as the boundary the eos_ops transaction
// itself owns rather than trusting a caller to have checked it first.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

const SCHEMA = "eos_ops";
const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export type OpsLocationType = "WAREHOUSE" | "BIN" | "MOBILE";
export type OpsTrackingMode = "NONE" | "SERIAL";
export type CycleCountSheetStatus = "OPEN" | "CLOSED" | "CANCELLED";
export type CycleCountLineStatus = "OPEN" | "COUNTED" | "RECONCILED" | "REJECTED" | "CANCELLED";
export type CycleCountReviewDecision = "APPROVE" | "REJECT";

export interface LocationRef {
  readonly type: OpsLocationType;
  readonly id: string;
}

export class CycleCountRepositoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
export class CycleCountSelfApprovalError extends CycleCountRepositoryError {
  constructor() {
    super("SEPARATION_OF_DUTIES", "the actor who submitted this count cannot reconcile its own variance");
  }
}

export interface CycleCountSheetRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly location: LocationRef;
  readonly status: CycleCountSheetStatus;
}

/** The BLIND view -- everything a counter may see before submitting. NEVER carries expected*. */
export interface CycleCountLineBlindView {
  readonly id: string;
  readonly sheetId: string;
  readonly partId: string;
  readonly trackingMode: OpsTrackingMode;
  readonly status: CycleCountLineStatus;
}

/** The FULL record -- only for the review/reconcile path, or after submission has already revealed it. */
export interface CycleCountLineFullRecord extends CycleCountLineBlindView {
  readonly expectedQuantity: number | null;
  readonly expectedSerialNumbers: readonly string[];
  readonly countedQuantity: number | null;
  readonly countedSerialNumbers: readonly string[];
  readonly variance: number | null;
  readonly submittedBy: string | null;
  readonly reviewDecision: CycleCountReviewDecision | null;
  readonly ledgerMovementId: string | null;
}

export async function createSheet(
  pool: Pool,
  tenantId: string,
  actorId: string,
  location: LocationRef,
): Promise<CycleCountSheetRecord> {
  const id = newId("ccs");
  await pool.query(
    `INSERT INTO ${SCHEMA}.cycle_count_sheets
       (id, tenant_id, location_type, location_id, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'OPEN', $5, $5)`,
    [id, tenantId, location.type, location.id, actorId],
  );
  return { id, tenantId, location, status: "OPEN" };
}

/** Open a line with its server-computed blind snapshot. The snapshot is never accepted from a caller past this point. */
export async function openLine(
  pool: Pool,
  tenantId: string,
  actorId: string,
  sheetId: string,
  partId: string,
  trackingMode: OpsTrackingMode,
  expectedQuantity: number | null,
  expectedSerialNumbers: readonly string[],
): Promise<CycleCountLineBlindView> {
  const id = newId("ccl");
  await pool.query(
    `INSERT INTO ${SCHEMA}.cycle_count_lines
       (id, tenant_id, sheet_id, part_id, tracking_mode, status,
        expected_quantity, expected_serial_numbers, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8, $8)`,
    [id, tenantId, sheetId, partId, trackingMode, expectedQuantity, [...expectedSerialNumbers], actorId],
  );
  return { id, sheetId, partId, trackingMode, status: "OPEN" };
}

/** THE ONLY READ A COUNTER MAY USE. Structurally cannot return an expected value. */
export async function readLineForCounter(
  pool: Pool,
  tenantId: string,
  lineId: string,
): Promise<CycleCountLineBlindView | null> {
  const { rows } = await pool.query<{
    id: string; sheet_id: string; part_id: string; tracking_mode: OpsTrackingMode; status: CycleCountLineStatus;
  }>(
    // NOTE: no expected_quantity, no expected_serial_numbers in this SELECT list. That omission IS
    // the blind contract; it is not a filter that could be bypassed by asking for more columns.
    `SELECT id, sheet_id, part_id, tracking_mode, status
       FROM ${SCHEMA}.cycle_count_lines
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, lineId],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, sheetId: row.sheet_id, partId: row.part_id, trackingMode: row.tracking_mode, status: row.status };
}

/** The reviewer/reconcile-path read. Always carries expected* -- there is no partial-review view. */
export async function readLineForReview(
  pool: Pool,
  tenantId: string,
  lineId: string,
): Promise<CycleCountLineFullRecord | null> {
  const row = await selectFull(pool, tenantId, lineId);
  return row;
}

/** Records the observation. NOT an adjustment -- on-hand truth is unchanged by this call. */
export async function submitCount(
  pool: Pool,
  tenantId: string,
  actorId: string,
  lineId: string,
  countedQuantity: number | null,
  countedSerialNumbers: readonly string[],
): Promise<CycleCountLineFullRecord> {
  const existing = await selectFull(pool, tenantId, lineId);
  if (!existing) throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line not found");
  const variance =
    existing.trackingMode === "NONE" && existing.expectedQuantity !== null && countedQuantity !== null
      ? countedQuantity - existing.expectedQuantity
      : null;
  await pool.query(
    `UPDATE ${SCHEMA}.cycle_count_lines
        SET status = 'COUNTED', counted_quantity = $3, counted_serial_numbers = $4, variance = $5,
            submitted_by = $6, submitted_at = now(), updated_by = $6, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, lineId, countedQuantity, [...countedSerialNumbers], variance, actorId],
  );
  const updated = await selectFull(pool, tenantId, lineId);
  if (!updated) throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line disappeared mid-transaction");
  return updated;
}

/**
 * Dispose of a submitted line. On APPROVE with a non-zero variance, stage an ADJUSTED ledger
 * movement and the line update ATOMICALLY, in one database transaction. On REJECT, or APPROVE with
 * zero variance, no ledger row is written.
 */
export async function reconcileLine(
  pool: Pool,
  tenantId: string,
  actorId: string,
  lineId: string,
  decision: CycleCountReviewDecision,
  reason: string | null,
): Promise<CycleCountLineFullRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const line = await selectFull(client, tenantId, lineId);
    if (!line) throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line not found");
    if (line.status !== "COUNTED") {
      throw new CycleCountRepositoryError("STATUS_INVALID", `line is ${line.status}; only a COUNTED line may be reconciled`);
    }
    // SEPARATION OF DUTIES, inside the same transaction that would otherwise apply the adjustment.
    if (line.submittedBy === actorId && (line.variance ?? 0) !== 0) {
      throw new CycleCountSelfApprovalError();
    }

    let ledgerMovementId: string | null = null;
    if (decision === "APPROVE" && (line.variance ?? 0) !== 0) {
      if (!reason) throw new CycleCountRepositoryError("REASON_REQUIRED", "a reconciliation reason is required for a non-zero variance");
      ledgerMovementId = newId("mov");
      const sheet = await selectSheetLocation(client, tenantId, line.sheetId);
      await client.query(
        `INSERT INTO ${SCHEMA}.inventory_movements
           (id, tenant_id, part_id, tracking_mode, location_type, location_id, movement_type,
            quantity_delta, source_kind, source_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'ADJUSTED', $7, 'CYCLE_COUNT_LINE', $8, $9)`,
        [ledgerMovementId, tenantId, line.partId, line.trackingMode, sheet.type, sheet.id, line.variance, lineId, actorId],
      );
    }

    await client.query(
      `UPDATE ${SCHEMA}.cycle_count_lines
          SET status = $3, review_decision = $4, reconciliation_reason = $5,
              reconciled_by = $6, reconciled_at = now(), ledger_movement_id = $7,
              updated_by = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, lineId, decision === "APPROVE" ? "RECONCILED" : "REJECTED", decision, reason, actorId, ledgerMovementId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const result = await selectFull(pool, tenantId, lineId);
  if (!result) throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line disappeared after commit");
  return result;
}

// ════════════════════ internals ════════════════════

async function selectFull(
  db: Pool | PoolClient,
  tenantId: string,
  lineId: string,
): Promise<CycleCountLineFullRecord | null> {
  const { rows } = await db.query<{
    id: string; sheet_id: string; part_id: string; tracking_mode: OpsTrackingMode; status: CycleCountLineStatus;
    expected_quantity: number | null; expected_serial_numbers: string[];
    counted_quantity: number | null; counted_serial_numbers: string[]; variance: number | null;
    submitted_by: string | null; review_decision: CycleCountReviewDecision | null; ledger_movement_id: string | null;
  }>(
    `SELECT id, sheet_id, part_id, tracking_mode, status,
            expected_quantity, expected_serial_numbers,
            counted_quantity, counted_serial_numbers, variance,
            submitted_by, review_decision, ledger_movement_id
       FROM ${SCHEMA}.cycle_count_lines
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, lineId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, sheetId: row.sheet_id, partId: row.part_id, trackingMode: row.tracking_mode, status: row.status,
    expectedQuantity: row.expected_quantity, expectedSerialNumbers: row.expected_serial_numbers,
    countedQuantity: row.counted_quantity, countedSerialNumbers: row.counted_serial_numbers, variance: row.variance,
    submittedBy: row.submitted_by, reviewDecision: row.review_decision, ledgerMovementId: row.ledger_movement_id,
  };
}

async function selectSheetLocation(db: PoolClient, tenantId: string, sheetId: string): Promise<LocationRef> {
  const { rows } = await db.query<{ location_type: OpsLocationType; location_id: string }>(
    `SELECT location_type, location_id FROM ${SCHEMA}.cycle_count_sheets WHERE tenant_id = $1 AND id = $2`,
    [tenantId, sheetId],
  );
  const row = rows[0];
  if (!row) throw new CycleCountRepositoryError("SHEET_NOT_FOUND", "cycle count sheet not found");
  return { type: row.location_type, id: row.location_id };
}
