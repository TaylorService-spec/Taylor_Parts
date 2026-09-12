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
// ════════════════════ THE SIGN IS DERIVED, NEVER RESTATED ════════════════════
//
// `quantity_delta` is a DERIVED SIGNED value, and this module is the only code that writes
// `eos_ops.inventory_movements`. The rule that decides a movement's balance effect is
// inventoryLedger/locationOnHand.ts `MOVEMENT_SIGN`, reached here through `signedQuantity` --
// IMPORTED, never restated. ADJUSTED is SIGNED: a reconciled variance already carries its own
// direction, so a `-` written in this file would double-negate it and turn a shortage into a
// receipt. There is deliberately no sign arithmetic below.
//
// ════════════════════ A COUNT HAPPENS ONCE ════════════════════
//
// Every state transition here is guarded by the STATUS THE ROW HAD WHEN IT WAS READ, re-asserted in
// the UPDATE's own WHERE clause. Without that, `submitCount` would happily re-count a RECONCILED
// line: the line would return to COUNTED with a fresh variance, a second `reconcileLine` would post
// a SECOND `ADJUSTED` row for the same physical shelf, and the first movement -- append-only, and no
// longer pointed at by the line -- would stay in the ledger as a permanent phantom adjustment. The
// conditional UPDATE closes that against a concurrent caller too: the loser's `rowCount` is 0 and its
// transaction rolls back, taking its ledger row with it. This mirrors, per line, what the Firestore
// authority (cycleCount/cycleCountSheetCommand.ts) already enforces -- an identical re-submit
// replays, a DIFFERENT one is a conflict, and a decided line is never re-opened.
//
// ════════════════════ SERIAL VARIANCE IS REFUSED, NOT GUESSED ════════════════════
//
// `inventory_movements` demands one row per serial unit with `quantity_delta IN (1, -1)` and a
// `serial_number` -- a direction per unit. This repository has no serialized-custody disposition
// surface to produce that, and `variance` (an INTEGER) cannot stand in for it: one missing plus one
// unexpected serial nets to zero and would post nothing while two units are wrong. So an APPROVE of
// a SERIAL line whose counted serials differ from its expected serials is REFUSED. It previously
// succeeded: the line was marked RECONCILED with `ledger_movement_id` NULL and the discrepancy
// disappeared with no evidence and no error. Refusing is the same fail-closed answer the legacy
// mapper gives the same ambiguity (`SERIAL_SIGN_NOT_RECOVERABLE`, migration/legacyInventoryMovement-
// Mapping.ts) -- never an inferred decrement.
//
// ════════════════════ SEPARATION OF DUTIES ════════════════════
//
// `reconcileLine` refuses when the disposing actor is the same principal recorded as `submittedBy`
// for a line with a non-zero variance -- the same guard the existing Firestore command family
// enforces (`CycleCountSelfApprovalError`), reproduced here as the boundary the eos_ops transaction
// itself owns rather than trusting a caller to have checked it first.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  type OperatingCompanyKey,
  type OpsLocationType,
  requireOperatingCompanyKey,
} from "./operatingCompanyCustody.js";
// The ONE sign authority (see the header). Pure: no Firestore, no clock, no I/O.
import { signedQuantity } from "../inventoryLedger/locationOnHand.js";

const SCHEMA = "eos_ops";
const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

// The PHYSICAL movement vocabulary, re-exported so existing importers are unaffected. Serialized
// custody uses `OpsCustodyLocationType` instead -- see operatingCompanyCustody.ts for why the two
// are deliberately not the same enum.
export {
  type OperatingCompanyKey,
  type OpsLocationType,
  type OpsCustodyLocationType,
  type CustodyLocationRef,
  type SerializedCustodyRecord,
} from "./operatingCompanyCustody.js";

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
  /**
   * MANDATORY inventory authority. Never defaulted, never inferred from the sheet's Warehouse, and
   * never manufactured -- the caller states the governed key or `createSheet` refuses.
   */
  readonly operatingCompanyKey: OperatingCompanyKey;
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
  operatingCompanyKey: OperatingCompanyKey,
  location: LocationRef,
): Promise<CycleCountSheetRecord> {
  // Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason
  // rather than a constraint name -- and so no code path can quietly supply a placeholder.
  const companyKey = requireOperatingCompanyKey(operatingCompanyKey);
  const id = newId("ccs");
  await pool.query(
    `INSERT INTO ${SCHEMA}.cycle_count_sheets
       (id, tenant_id, operating_company_key, location_type, location_id, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6)`,
    [id, tenantId, companyKey, location.type, location.id, actorId],
  );
  return { id, tenantId, operatingCompanyKey: companyKey, location, status: "OPEN" };
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
  // The sheet is the governed parent: it must exist and still be accepting work. Read here rather
  // than left to the foreign key, so an unknown sheet answers with a reason instead of a constraint
  // name -- and so a sheet that is no longer OPEN cannot grow a new line.
  requireSheetOpen(await selectSheetAuthority(pool, tenantId, sheetId), "open a line");
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
  requireSheetOpen(await selectSheetAuthority(pool, tenantId, existing.sheetId), "submit a count");

  // An identical re-submit REPLAYS -- a retried request is not a second count, and must not restamp
  // submitted_by (the fact separation of duties is decided on). A different one is a CONFLICT: a
  // count is an observation of one moment, never amended in place.
  if (existing.status === "COUNTED") {
    if (isSameCount(existing, countedQuantity, countedSerialNumbers)) return existing;
    throw new CycleCountRepositoryError(
      "COUNT_ALREADY_SUBMITTED",
      "this line was already counted with a different result; a second count is not an amendment",
    );
  }
  if (existing.status !== "OPEN") {
    throw new CycleCountRepositoryError("STATUS_INVALID", `line is ${existing.status}; only an OPEN line may be counted`);
  }

  const variance =
    existing.trackingMode === "NONE" && existing.expectedQuantity !== null && countedQuantity !== null
      ? countedQuantity - existing.expectedQuantity
      : null;
  // `AND status = 'OPEN'` is the guard, not the read above: a concurrent reconcile that decided this
  // line between the two statements loses here rather than silently re-opening a posted adjustment.
  const { rowCount } = await pool.query(
    `UPDATE ${SCHEMA}.cycle_count_lines
        SET status = 'COUNTED', counted_quantity = $3, counted_serial_numbers = $4, variance = $5,
            submitted_by = $6, submitted_at = now(), updated_by = $6, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`,
    [tenantId, lineId, countedQuantity, [...countedSerialNumbers], variance, actorId],
  );
  if (rowCount !== 1) {
    throw new CycleCountRepositoryError("STATUS_INVALID", "the line stopped being OPEN before the count could be recorded");
  }
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

    // The sheet is the governed parent authority for the whole count -- its status, its location and
    // its operating company all come from it, in the SAME read. Nothing here infers a company from
    // the warehouse the sheet happens to name.
    const sheet = await selectSheetAuthority(client, tenantId, line.sheetId);
    requireSheetOpen(sheet, "reconcile a line");

    let ledgerMovementId: string | null = null;
    if (decision === "APPROVE" && line.trackingMode === "SERIAL") {
      // See the header. The ledger wants a signed row PER SERIAL UNIT; `variance` cannot express one,
      // and this repository has no serialized-custody disposition to produce it. A count that matches
      // its expected serials exactly needs no adjustment and is allowed through; anything else is
      // refused rather than recorded as reconciled with no evidence.
      if (!sameSerialSet(line.expectedSerialNumbers, line.countedSerialNumbers)) {
        throw new CycleCountRepositoryError(
          "SERIAL_VARIANCE_NOT_RECONCILABLE",
          "a serial discrepancy needs one signed movement per unit, which this repository cannot stage; it is refused, never inferred",
        );
      }
    }
    if (decision === "APPROVE" && line.trackingMode === "NONE" && (line.variance ?? 0) !== 0) {
      if (!reason) throw new CycleCountRepositoryError("REASON_REQUIRED", "a reconciliation reason is required for a non-zero variance");
      // DERIVED, through the ONE sign authority (see the header). ADJUSTED is SIGNED, so this is the
      // variance itself -- the call is what guarantees no second sign is ever applied to it.
      const quantityDelta = signedQuantity({ type: "ADJUSTED", quantity: line.variance as number });
      if (quantityDelta === 0) {
        throw new CycleCountRepositoryError("VARIANCE_NOT_POSTABLE", "the variance has no postable balance effect");
      }
      ledgerMovementId = newId("mov");
      await client.query(
        `INSERT INTO ${SCHEMA}.inventory_movements
           (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
            movement_type, quantity_delta, source_kind, source_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ADJUSTED', $8, 'CYCLE_COUNT_LINE', $9, $10)`,
        [ledgerMovementId, tenantId, sheet.operatingCompanyKey, line.partId, line.trackingMode,
         sheet.location.type, sheet.location.id, quantityDelta, lineId, actorId],
      );
    }

    // `AND status = 'COUNTED'` re-asserts, at write time, the status this transaction read. A
    // concurrent reconcile of the same line finds no row, throws, and rolls back -- taking the
    // ledger row it just inserted with it, so a line can never carry two adjustments.
    const { rowCount } = await client.query(
      `UPDATE ${SCHEMA}.cycle_count_lines
          SET status = $3, review_decision = $4, reconciliation_reason = $5,
              reconciled_by = $6, reconciled_at = now(), ledger_movement_id = $7,
              updated_by = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'COUNTED'`,
      [tenantId, lineId, decision === "APPROVE" ? "RECONCILED" : "REJECTED", decision, reason, actorId, ledgerMovementId],
    );
    if (rowCount !== 1) {
      throw new CycleCountRepositoryError("STATUS_INVALID", "the line was dispositioned by someone else before this decision could commit");
    }

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

/** The sheet's governed facts a line inherits: WHETHER it may still change, WHERE, and WHOSE inventory. */
async function selectSheetAuthority(
  db: Pool | PoolClient,
  tenantId: string,
  sheetId: string,
): Promise<{ status: CycleCountSheetStatus; location: LocationRef; operatingCompanyKey: OperatingCompanyKey }> {
  const { rows } = await db.query<{
    status: CycleCountSheetStatus; location_type: OpsLocationType; location_id: string; operating_company_key: string;
  }>(
    `SELECT status, location_type, location_id, operating_company_key
       FROM ${SCHEMA}.cycle_count_sheets WHERE tenant_id = $1 AND id = $2`,
    [tenantId, sheetId],
  );
  const row = rows[0];
  if (!row) throw new CycleCountRepositoryError("SHEET_NOT_FOUND", "cycle count sheet not found");
  return {
    status: row.status,
    location: { type: row.location_type, id: row.location_id },
    operatingCompanyKey: row.operating_company_key,
  };
}

/**
 * A sheet that is no longer OPEN admits no further work on any of its lines. The check lives on the
 * READ side deliberately: it holds for a sheet closed or cancelled by ANY writer, not only by a
 * command this module happens to expose today.
 */
function requireSheetOpen(sheet: { readonly status: CycleCountSheetStatus }, what: string): void {
  if (sheet.status !== "OPEN") {
    throw new CycleCountRepositoryError("SHEET_STATUS_INVALID", `sheet is ${sheet.status}; cannot ${what}`);
  }
}

/** Was this the SAME observation? Quantity for NONE, the serial SET for SERIAL -- order is not a difference. */
function isSameCount(
  line: CycleCountLineFullRecord,
  countedQuantity: number | null,
  countedSerialNumbers: readonly string[],
): boolean {
  return line.trackingMode === "SERIAL"
    ? sameSerialSet(line.countedSerialNumbers, countedSerialNumbers)
    : line.countedQuantity === countedQuantity;
}

function sameSerialSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((serial, i) => serial === right[i]);
}
