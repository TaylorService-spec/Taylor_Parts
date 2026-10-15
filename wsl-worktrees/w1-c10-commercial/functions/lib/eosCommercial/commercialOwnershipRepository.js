"use strict";
// EOS Commercial Data Plane — the `eos_commercial` repository (migration 008).
//
// House idiom, matching eosOps/cycleCountRepository.ts: free functions, `pool: Pool` first,
// `tenantId` second, every query parameterized with `tenant_id = $1` leading the WHERE, snake_case
// row generics mapped to camelCase on the way out, and a base error class whose subclasses fix the
// code.
//
// NO FIREBASE. This module imports `pg` and the pure authority beside it, and nothing else. It is
// the PostgreSQL half of the Firebase exit for the commercial chain, so importing firebase-admin
// here would defeat the only thing it exists to demonstrate.
//
// ════════════════════ WHY THE TRANSFER IS ONE FUNCTION AND ONE TRANSACTION ════════════════════
//
// A transfer is two writes -- append the handoff, move the current owner -- and the rulings are
// only satisfied if BOTH happen or NEITHER does. A moved owner with no handoff row loses the
// history ("historical ownership remains"); a handoff row with an unmoved owner means tomorrow's
// records still inherit the old owner ("future sales follow the new owner"). So they share one
// explicit BEGIN/COMMIT on one PoolClient, the same way cycleCountRepository.ts stages a ledger row
// beside the custody row it belongs to.
//
// There is NO update function and NO delete function for `ownership_handoffs`, and that is a
// deliberate absence rather than an oversight -- but it is not the proof. The proof is the
// `ownership_handoffs_are_append_only` trigger, because the absence of a function is a property of
// the code we happen to have written and the trigger is a property of the store.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommercialRecordNotFoundError = exports.CommercialRepositoryError = void 0;
exports.createCommercialRecord = createCommercialRecord;
exports.readCommercialRecord = readCommercialRecord;
exports.transferCommercialOwnership = transferCommercialOwnership;
exports.readOwnershipHistory = readOwnershipHistory;
const node_crypto_1 = require("node:crypto");
const commercialOwnershipAuthority_1 = require("./commercialOwnershipAuthority");
const SCHEMA = "eos_commercial";
const newId = (prefix) => `${prefix}_${(0, node_crypto_1.randomUUID)()}`;
const ID_PREFIX = Object.freeze({
    OPPORTUNITY: "opp",
    SALES_AGREEMENT: "sag",
    SALES_ORDER: "sor",
});
/** kind -> the column in `ownership_handoffs` that names it. Exactly one is ever non-null. */
const HANDOFF_COLUMN = Object.freeze({
    OPPORTUNITY: "opportunity_id",
    SALES_AGREEMENT: "sales_agreement_id",
    SALES_ORDER: "sales_order_id",
});
/** kind -> the record-number column. Each table names its own number; none shares a column name. */
const NUMBER_COLUMN = Object.freeze({
    OPPORTUNITY: "opportunity_number",
    SALES_AGREEMENT: "sales_agreement_number",
    SALES_ORDER: "sales_order_number",
});
class CommercialRepositoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CommercialRepositoryError";
    }
}
exports.CommercialRepositoryError = CommercialRepositoryError;
class CommercialRecordNotFoundError extends CommercialRepositoryError {
    constructor(kind, recordId) {
        super("RECORD_NOT_FOUND", `no ${kind} ${recordId} in this tenant`);
    }
}
exports.CommercialRecordNotFoundError = CommercialRecordNotFoundError;
const toRecord = (kind, row) => ({
    id: row.id,
    kind,
    recordNumber: row.record_number,
    accountId: row.account_id,
    ownerEmployeeId: row.owner_employee_id,
    operatingCompanyKey: row.operating_company_key,
    createdBy: row.created_by,
});
/**
 * Insert a commercial record. The owner and the operating company are validated by the pure
 * authority first so the caller gets a named code, and by the table's own NOT NULL second so a
 * caller that bypassed the authority still cannot write an ownerless row.
 */
async function createCommercialRecord(pool, tenantId, actorId, input) {
    const built = (0, commercialOwnershipAuthority_1.buildCommercialOwnershipRow)(input);
    const table = commercialOwnershipAuthority_1.COMMERCIAL_TABLE_BY_KIND[built.kind];
    const numberColumn = NUMBER_COLUMN[built.kind];
    const id = newId(ID_PREFIX[built.kind]);
    const lineageColumns = [];
    const lineageValues = [];
    if (built.kind !== "OPPORTUNITY") {
        lineageColumns.push("opportunity_id");
        lineageValues.push(built.opportunityId);
    }
    if (built.kind === "SALES_ORDER") {
        lineageColumns.push("sales_agreement_id");
        lineageValues.push(built.salesAgreementId);
    }
    const columns = [
        "id", "tenant_id", numberColumn, "account_id", "owner_employee_id",
        "operating_company_key", "created_by", "updated_by", ...lineageColumns,
    ];
    const values = [
        id, tenantId, built.recordNumber, built.accountId, built.ownerEmployeeId,
        built.operatingCompanyKey, built.createdBy, actorId, ...lineageValues,
    ];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const result = await pool.query(`INSERT INTO ${SCHEMA}.${table} (${columns.join(", ")})
     VALUES (${placeholders})
     RETURNING id, ${numberColumn} AS record_number, account_id, owner_employee_id,
               operating_company_key, created_by`, values);
    return toRecord(built.kind, result.rows[0]);
}
/** The current owner and nothing derived. Returns null when the record is not this tenant's. */
async function readCommercialRecord(pool, tenantId, kind, recordId) {
    const table = commercialOwnershipAuthority_1.COMMERCIAL_TABLE_BY_KIND[kind];
    const result = await pool.query(`SELECT id, ${NUMBER_COLUMN[kind]} AS record_number, account_id, owner_employee_id,
            operating_company_key, created_by
       FROM ${SCHEMA}.${table}
      WHERE tenant_id = $1 AND id = $2`, [tenantId, recordId]);
    return result.rows.length === 0 ? null : toRecord(kind, result.rows[0]);
}
/**
 * Transfer ownership: append the handoff and move the current owner, atomically.
 *
 * The previous owner is READ INSIDE THE TRANSACTION with `FOR UPDATE`, not supplied by the caller.
 * A caller-supplied previous owner is a value that was true when the caller read it and may not be
 * when the write lands -- and the one thing an ownership history must never record is a predecessor
 * who never held the record. The `FOR UPDATE` also serializes two concurrent handoffs of the same
 * record, so the second one records the first one's new owner as its previous owner instead of
 * overwriting it.
 *
 * ONE record. There is no list parameter and no cascade flag; handing off an Opportunity leaves its
 * Sales Orders exactly where they were.
 */
async function transferCommercialOwnership(pool, tenantId, actorId, input) {
    const kind = input.kind;
    const table = commercialOwnershipAuthority_1.COMMERCIAL_TABLE_BY_KIND[kind];
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(`SELECT owner_employee_id FROM ${SCHEMA}.${table}
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, input.recordId]);
        if (current.rows.length === 0) {
            throw new CommercialRecordNotFoundError(kind, input.recordId);
        }
        // Validated only once the real predecessor is known -- the no-op refusal is meaningless against
        // a previous owner the caller guessed.
        const handoff = (0, commercialOwnershipAuthority_1.buildCommercialHandoff)({
            ...input,
            previousOwnerEmployeeId: current.rows[0].owner_employee_id,
        });
        const id = newId("hof");
        const inserted = await client.query(`INSERT INTO ${SCHEMA}.ownership_handoffs
         (id, tenant_id, ${HANDOFF_COLUMN[kind]}, previous_owner_employee_id,
          new_owner_employee_id, source, reason, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, previous_owner_employee_id, new_owner_employee_id, source, reason,
                 effective_at, recorded_by`, [
            id, tenantId, handoff.recordId, handoff.previousOwnerEmployeeId,
            handoff.newOwnerEmployeeId, handoff.source, handoff.reason, actorId,
        ]);
        await client.query(`UPDATE ${SCHEMA}.${table}
          SET owner_employee_id = $3, updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [tenantId, handoff.recordId, handoff.newOwnerEmployeeId, actorId]);
        await client.query("COMMIT");
        const row = inserted.rows[0];
        return {
            id: row.id,
            kind,
            recordId: handoff.recordId,
            previousOwnerEmployeeId: row.previous_owner_employee_id,
            newOwnerEmployeeId: row.new_owner_employee_id,
            source: row.source,
            reason: row.reason,
            effectiveAt: row.effective_at,
            recordedBy: row.recorded_by,
        };
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
/** The ownership history of ONE record, oldest first. This is what "historical ownership remains" reads. */
async function readOwnershipHistory(pool, tenantId, kind, recordId) {
    const result = await pool.query(`SELECT id, previous_owner_employee_id, new_owner_employee_id, source, reason,
            effective_at, recorded_by
       FROM ${SCHEMA}.ownership_handoffs
      WHERE tenant_id = $1 AND ${HANDOFF_COLUMN[kind]} = $2
      ORDER BY effective_at, id`, [tenantId, recordId]);
    return result.rows.map((row) => ({
        id: row.id,
        kind,
        recordId,
        previousOwnerEmployeeId: row.previous_owner_employee_id,
        newOwnerEmployeeId: row.new_owner_employee_id,
        source: row.source,
        reason: row.reason,
        effectiveAt: row.effective_at,
        recordedBy: row.recorded_by,
    }));
}
//# sourceMappingURL=commercialOwnershipRepository.js.map