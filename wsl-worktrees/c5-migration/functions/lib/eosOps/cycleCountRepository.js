"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CycleCountSelfApprovalError = exports.CycleCountRepositoryError = void 0;
exports.createSheet = createSheet;
exports.openLine = openLine;
exports.readLineForCounter = readLineForCounter;
exports.readLineForReview = readLineForReview;
exports.submitCount = submitCount;
exports.reconcileLine = reconcileLine;
const node_crypto_1 = require("node:crypto");
const operatingCompanyCustody_js_1 = require("./operatingCompanyCustody.js");
// The ONE sign authority (see the header). Pure: no Firestore, no clock, no I/O.
const locationOnHand_js_1 = require("../inventoryLedger/locationOnHand.js");
const SCHEMA = "eos_ops";
const newId = (prefix) => `${prefix}_${(0, node_crypto_1.randomUUID)()}`;
class CycleCountRepositoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.CycleCountRepositoryError = CycleCountRepositoryError;
class CycleCountSelfApprovalError extends CycleCountRepositoryError {
    constructor() {
        super("SEPARATION_OF_DUTIES", "the actor who submitted this count cannot reconcile its own variance");
    }
}
exports.CycleCountSelfApprovalError = CycleCountSelfApprovalError;
async function createSheet(pool, tenantId, actorId, operatingCompanyKey, location) {
    // Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason
    // rather than a constraint name -- and so no code path can quietly supply a placeholder.
    const companyKey = (0, operatingCompanyCustody_js_1.requireOperatingCompanyKey)(operatingCompanyKey);
    const id = newId("ccs");
    await pool.query(`INSERT INTO ${SCHEMA}.cycle_count_sheets
       (id, tenant_id, operating_company_key, location_type, location_id, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6)`, [id, tenantId, companyKey, location.type, location.id, actorId]);
    return { id, tenantId, operatingCompanyKey: companyKey, location, status: "OPEN" };
}
/** Open a line with its server-computed blind snapshot. The snapshot is never accepted from a caller past this point. */
async function openLine(pool, tenantId, actorId, sheetId, partId, trackingMode, expectedQuantity, expectedSerialNumbers) {
    // The sheet is the governed parent: it must exist and still be accepting work. Read here rather
    // than left to the foreign key, so an unknown sheet answers with a reason instead of a constraint
    // name -- and so a sheet that is no longer OPEN cannot grow a new line.
    requireSheetOpen(await selectSheetAuthority(pool, tenantId, sheetId), "open a line");
    const id = newId("ccl");
    await pool.query(`INSERT INTO ${SCHEMA}.cycle_count_lines
       (id, tenant_id, sheet_id, part_id, tracking_mode, status,
        expected_quantity, expected_serial_numbers, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8, $8)`, [id, tenantId, sheetId, partId, trackingMode, expectedQuantity, [...expectedSerialNumbers], actorId]);
    return { id, sheetId, partId, trackingMode, status: "OPEN" };
}
/** THE ONLY READ A COUNTER MAY USE. Structurally cannot return an expected value. */
async function readLineForCounter(pool, tenantId, lineId) {
    const { rows } = await pool.query(
    // NOTE: no expected_quantity, no expected_serial_numbers in this SELECT list. That omission IS
    // the blind contract; it is not a filter that could be bypassed by asking for more columns.
    `SELECT id, sheet_id, part_id, tracking_mode, status
       FROM ${SCHEMA}.cycle_count_lines
      WHERE tenant_id = $1 AND id = $2`, [tenantId, lineId]);
    const row = rows[0];
    if (!row)
        return null;
    return { id: row.id, sheetId: row.sheet_id, partId: row.part_id, trackingMode: row.tracking_mode, status: row.status };
}
/** The reviewer/reconcile-path read. Always carries expected* -- there is no partial-review view. */
async function readLineForReview(pool, tenantId, lineId) {
    const row = await selectFull(pool, tenantId, lineId);
    return row;
}
/** Records the observation. NOT an adjustment -- on-hand truth is unchanged by this call. */
async function submitCount(pool, tenantId, actorId, lineId, countedQuantity, countedSerialNumbers) {
    const existing = await selectFull(pool, tenantId, lineId);
    if (!existing)
        throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line not found");
    requireSheetOpen(await selectSheetAuthority(pool, tenantId, existing.sheetId), "submit a count");
    // An identical re-submit REPLAYS -- a retried request is not a second count, and must not restamp
    // submitted_by (the fact separation of duties is decided on). A different one is a CONFLICT: a
    // count is an observation of one moment, never amended in place.
    if (existing.status === "COUNTED") {
        if (isSameCount(existing, countedQuantity, countedSerialNumbers))
            return existing;
        throw new CycleCountRepositoryError("COUNT_ALREADY_SUBMITTED", "this line was already counted with a different result; a second count is not an amendment");
    }
    if (existing.status !== "OPEN") {
        throw new CycleCountRepositoryError("STATUS_INVALID", `line is ${existing.status}; only an OPEN line may be counted`);
    }
    const variance = existing.trackingMode === "NONE" && existing.expectedQuantity !== null && countedQuantity !== null
        ? countedQuantity - existing.expectedQuantity
        : null;
    // `AND status = 'OPEN'` is the guard, not the read above: a concurrent reconcile that decided this
    // line between the two statements loses here rather than silently re-opening a posted adjustment.
    const { rowCount } = await pool.query(`UPDATE ${SCHEMA}.cycle_count_lines
        SET status = 'COUNTED', counted_quantity = $3, counted_serial_numbers = $4, variance = $5,
            submitted_by = $6, submitted_at = now(), updated_by = $6, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'`, [tenantId, lineId, countedQuantity, [...countedSerialNumbers], variance, actorId]);
    if (rowCount !== 1) {
        throw new CycleCountRepositoryError("STATUS_INVALID", "the line stopped being OPEN before the count could be recorded");
    }
    const updated = await selectFull(pool, tenantId, lineId);
    if (!updated)
        throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line disappeared mid-transaction");
    return updated;
}
/**
 * Dispose of a submitted line. On APPROVE with a non-zero variance, stage an ADJUSTED ledger
 * movement and the line update ATOMICALLY, in one database transaction. On REJECT, or APPROVE with
 * zero variance, no ledger row is written.
 */
async function reconcileLine(pool, tenantId, actorId, lineId, decision, reason) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const line = await selectFull(client, tenantId, lineId);
        if (!line)
            throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line not found");
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
        let ledgerMovementId = null;
        if (decision === "APPROVE" && line.trackingMode === "SERIAL") {
            // See the header. The ledger wants a signed row PER SERIAL UNIT; `variance` cannot express one,
            // and this repository has no serialized-custody disposition to produce it. A count that matches
            // its expected serials exactly needs no adjustment and is allowed through; anything else is
            // refused rather than recorded as reconciled with no evidence.
            if (!sameSerialSet(line.expectedSerialNumbers, line.countedSerialNumbers)) {
                throw new CycleCountRepositoryError("SERIAL_VARIANCE_NOT_RECONCILABLE", "a serial discrepancy needs one signed movement per unit, which this repository cannot stage; it is refused, never inferred");
            }
        }
        if (decision === "APPROVE" && line.trackingMode === "NONE" && (line.variance ?? 0) !== 0) {
            if (!reason)
                throw new CycleCountRepositoryError("REASON_REQUIRED", "a reconciliation reason is required for a non-zero variance");
            // DERIVED, through the ONE sign authority (see the header). ADJUSTED is SIGNED, so this is the
            // variance itself -- the call is what guarantees no second sign is ever applied to it.
            const quantityDelta = (0, locationOnHand_js_1.signedQuantity)({ type: "ADJUSTED", quantity: line.variance });
            if (quantityDelta === 0) {
                throw new CycleCountRepositoryError("VARIANCE_NOT_POSTABLE", "the variance has no postable balance effect");
            }
            ledgerMovementId = newId("mov");
            await client.query(`INSERT INTO ${SCHEMA}.inventory_movements
           (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
            movement_type, quantity_delta, source_kind, source_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ADJUSTED', $8, 'CYCLE_COUNT_LINE', $9, $10)`, [ledgerMovementId, tenantId, sheet.operatingCompanyKey, line.partId, line.trackingMode,
                sheet.location.type, sheet.location.id, quantityDelta, lineId, actorId]);
        }
        // `AND status = 'COUNTED'` re-asserts, at write time, the status this transaction read. A
        // concurrent reconcile of the same line finds no row, throws, and rolls back -- taking the
        // ledger row it just inserted with it, so a line can never carry two adjustments.
        const { rowCount } = await client.query(`UPDATE ${SCHEMA}.cycle_count_lines
          SET status = $3, review_decision = $4, reconciliation_reason = $5,
              reconciled_by = $6, reconciled_at = now(), ledger_movement_id = $7,
              updated_by = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'COUNTED'`, [tenantId, lineId, decision === "APPROVE" ? "RECONCILED" : "REJECTED", decision, reason, actorId, ledgerMovementId]);
        if (rowCount !== 1) {
            throw new CycleCountRepositoryError("STATUS_INVALID", "the line was dispositioned by someone else before this decision could commit");
        }
        await client.query("COMMIT");
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
    const result = await selectFull(pool, tenantId, lineId);
    if (!result)
        throw new CycleCountRepositoryError("LINE_NOT_FOUND", "cycle count line disappeared after commit");
    return result;
}
// ════════════════════ internals ════════════════════
async function selectFull(db, tenantId, lineId) {
    const { rows } = await db.query(`SELECT id, sheet_id, part_id, tracking_mode, status,
            expected_quantity, expected_serial_numbers,
            counted_quantity, counted_serial_numbers, variance,
            submitted_by, review_decision, ledger_movement_id
       FROM ${SCHEMA}.cycle_count_lines
      WHERE tenant_id = $1 AND id = $2`, [tenantId, lineId]);
    const row = rows[0];
    if (!row)
        return null;
    return {
        id: row.id, sheetId: row.sheet_id, partId: row.part_id, trackingMode: row.tracking_mode, status: row.status,
        expectedQuantity: row.expected_quantity, expectedSerialNumbers: row.expected_serial_numbers,
        countedQuantity: row.counted_quantity, countedSerialNumbers: row.counted_serial_numbers, variance: row.variance,
        submittedBy: row.submitted_by, reviewDecision: row.review_decision, ledgerMovementId: row.ledger_movement_id,
    };
}
/** The sheet's governed facts a line inherits: WHETHER it may still change, WHERE, and WHOSE inventory. */
async function selectSheetAuthority(db, tenantId, sheetId) {
    const { rows } = await db.query(`SELECT status, location_type, location_id, operating_company_key
       FROM ${SCHEMA}.cycle_count_sheets WHERE tenant_id = $1 AND id = $2`, [tenantId, sheetId]);
    const row = rows[0];
    if (!row)
        throw new CycleCountRepositoryError("SHEET_NOT_FOUND", "cycle count sheet not found");
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
function requireSheetOpen(sheet, what) {
    if (sheet.status !== "OPEN") {
        throw new CycleCountRepositoryError("SHEET_STATUS_INVALID", `sheet is ${sheet.status}; cannot ${what}`);
    }
}
/** Was this the SAME observation? Quantity for NONE, the serial SET for SERIAL -- order is not a difference. */
function isSameCount(line, countedQuantity, countedSerialNumbers) {
    return line.trackingMode === "SERIAL"
        ? sameSerialSet(line.countedSerialNumbers, countedSerialNumbers)
        : line.countedQuantity === countedQuantity;
}
function sameSerialSet(a, b) {
    if (a.length !== b.length)
        return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((serial, i) => serial === right[i]);
}
//# sourceMappingURL=cycleCountRepository.js.map