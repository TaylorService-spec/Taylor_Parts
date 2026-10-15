"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommercialAccountabilityWriteError = exports.ACCOUNTABILITY_HISTORY_ACTIONS = void 0;
exports.stageCommercialAccountablePersonChange = stageCommercialAccountablePersonChange;
exports.establishCommercialAccountablePerson = establishCommercialAccountablePerson;
exports.handOffCommercialAccountablePerson = handOffCommercialAccountablePerson;
const node_crypto_1 = require("node:crypto");
const accountablePersonStorage_1 = require("../responsibility/accountablePersonStorage");
const HISTORY_TABLE = "eos_commercial.accountability_handoffs";
/** The two kinds of accountability change, exactly as migration 021 generates them. */
exports.ACCOUNTABILITY_HISTORY_ACTIONS = Object.freeze(["ESTABLISHMENT", "HANDOFF"]);
/** family -> the history column that names the record. Exactly one is non-null per row (migration 020). */
const HISTORY_RECORD_COLUMN = Object.freeze({
    opportunity: "opportunity_id",
    salesAgreement: "sales_agreement_id",
    salesOrder: "sales_order_id",
});
class CommercialAccountabilityWriteError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CommercialAccountabilityWriteError";
    }
}
exports.CommercialAccountabilityWriteError = CommercialAccountabilityWriteError;
const refuse = (code, message) => {
    throw new CommercialAccountabilityWriteError(code, message);
};
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
/**
 * Stage ONE accountability change onto the caller's open transaction: lock the record, refuse or mutate the
 * accountable person, append its history. The caller commits or rolls back -- which is what lets a future
 * PostgreSQL commercial create path put the record, the establishment and the history in one transaction.
 */
async function stageCommercialAccountablePersonChange(db, tenantId, actorId, action, input) {
    if (!exports.ACCOUNTABILITY_HISTORY_ACTIONS.includes(action))
        refuse("REQUEST_INVALID", `unknown accountability action ${String(action)}`);
    if (!nonEmpty(tenantId) || !nonEmpty(actorId) || !input || !nonEmpty(input.recordId)) {
        refuse("REQUEST_INVALID", "tenantId, actorId and recordId are required");
    }
    const storage = (0, accountablePersonStorage_1.accountablePersonStorage)(input.family);
    if (!storage) {
        return refuse("FAMILY_NOT_ACCOUNTABLE", `${String(input.family)} carries no governed accountability (#189 OD-16)`);
    }
    const person = input.accountablePerson;
    if (!(0, accountablePersonStorage_1.isGovernedAccountablePerson)(person)) {
        refuse("ACCOUNTABLE_PERSON_NOT_GOVERNED", "only a value minted by the governed establishment or handoff may be persisted (#184)");
    }
    if (person.tenantId !== tenantId) {
        refuse("ACCOUNTABLE_PERSON_OTHER_TENANT", `the accountable person was resolved in another tenant than ${tenantId}`);
    }
    if (action === "HANDOFF" && person.source !== "EXPLICIT") {
        refuse("HANDOFF_SOURCE_NOT_EXPLICIT", "a handoff names its new accountable person explicitly; derivation from the owner is initialization only (#181)");
    }
    const current = await db.query(`SELECT ${storage.column} AS accountable FROM ${storage.table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, input.recordId]);
    if (current.rows.length === 0)
        refuse("RECORD_NOT_FOUND", `no ${input.family} ${input.recordId} in this tenant`);
    const previous = current.rows[0].accountable;
    if (action === "ESTABLISHMENT" && previous !== null) {
        refuse("ALREADY_ESTABLISHED", `${input.family} ${input.recordId} already has an accountable person; changing it is a HANDOFF`);
    }
    if (action === "HANDOFF") {
        if (previous === null)
            refuse("NOTHING_TO_HAND_OFF", `${input.family} ${input.recordId} has no accountable person; a first accountable person is an ESTABLISHMENT`);
        if (previous === person.accountableEmployeeId)
            refuse("HANDOFF_IS_NO_OP", `${person.accountableEmployeeId} is already accountable`);
        if (input.expectedPreviousAccountableEmployeeId !== undefined && input.expectedPreviousAccountableEmployeeId !== previous) {
            refuse("PRECONDITION_FAILED", "the accountable person changed since the handoff was decided");
        }
    }
    await db.query(`UPDATE ${storage.table} SET ${storage.column} = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, input.recordId, person.accountableEmployeeId, actorId]);
    const inserted = await db.query(`INSERT INTO ${HISTORY_TABLE}
       (id, tenant_id, ${HISTORY_RECORD_COLUMN[storage.family]}, previous_accountable_employee_id,
        new_accountable_employee_id, eligibility_policy_id, source, reason, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, action, source, previous_accountable_employee_id, new_accountable_employee_id,
               eligibility_policy_id, reason, recorded_by, effective_at, recorded_at`, [
        `ach_${(0, node_crypto_1.randomUUID)()}`, tenantId, input.recordId, previous, person.accountableEmployeeId,
        person.eligibilityPolicyId, person.source, input.reason ?? null, actorId,
    ]);
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
async function inOwnTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
/** First governed accountable person on a record that has none -- at creation or later. One transaction. */
function establishCommercialAccountablePerson(pool, tenantId, actorId, input) {
    return inOwnTransaction(pool, (client) => stageCommercialAccountablePersonChange(client, tenantId, actorId, "ESTABLISHMENT", input));
}
/** Change a record's accountable person to a different governed eligible Employee. One transaction. */
function handOffCommercialAccountablePerson(pool, tenantId, actorId, input) {
    return inOwnTransaction(pool, (client) => stageCommercialAccountablePersonChange(client, tenantId, actorId, "HANDOFF", input));
}
//# sourceMappingURL=commercialAccountabilityRepository.js.map