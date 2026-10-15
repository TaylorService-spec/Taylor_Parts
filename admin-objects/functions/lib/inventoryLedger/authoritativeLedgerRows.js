"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LedgerRowIntegrityError = void 0;
exports.authoritativeOperationalMovements = authoritativeOperationalMovements;
exports.censusLedgerRows = censusLedgerRows;
// AUTHORITATIVE LEDGER ROWS -- the one fail-closed read of `inventory_transactions` for any result
// that decides something (transfer sufficiency, relocation sufficiency, a cycle count's expected
// quantity, a truck's presence, ...).
//
// ════════════════════ WHY SKIPPING A MALFORMED ROW IS NOT SAFE (Controller ruling DQ-019) ════════════════════
//
// Every reader used to `continue` past a row it could not classify or deserialize, with the comment
// "a malformed row is skipped, never trusted -- it never inflates on-hand". That is only true of a
// malformed CREDIT. A malformed DEBIT (a TRANSFER_OUT, a consumption, a negative ADJUSTED) that is
// skipped RAISES the sum: a transfer passes an INSUFFICIENT_STOCK check it should fail, a count
// "expects" stock that already left. A row whose meaning cannot be read cannot be signed either, so
// no reader can know which way skipping it errs. The only honest answer is to refuse.
//
// So a result computed over a set of rows that contains ANY unreadable row is not a result: it
// throws LedgerRowIntegrityError, and each domain maps that to its own integrity refusal. Nothing
// is repaired here -- repairing ambiguous ledger data is a governed decision, never a reader's.
//
// ════════════════════ WHAT IS STILL EXCLUDED, AND WHY THAT IS NOT A SKIP ════════════════════
//
// A LEGACY row (no schemaVersion, a legacy Work-Order transaction type) is well-formed and classified:
// it is a different population that carries no location and was never part of location-aware on-hand.
// Excluding it is a governed modelling rule (classifyLedgerDoc), not a silent skip of something
// unreadable, and it is counted separately by the pre-activation census below.
//
// PURE: no Firestore, no clock. Callers pass the documents their own transaction already read.
const operationalMovementRepository_js_1 = require("./operationalMovementRepository.js");
class LedgerRowIntegrityError extends Error {
    docId;
    reason;
    constructor(docId, reason) {
        super(`ledger row ${docId} is ${reason === "UNCLASSIFIABLE" ? "not a recognised ledger record" : "an operational record that cannot be read"}; the result is refused`);
        this.docId = docId;
        this.reason = reason;
        this.name = "LedgerRowIntegrityError";
    }
}
exports.LedgerRowIntegrityError = LedgerRowIntegrityError;
/**
 * The operational movements in `docs`, or a refusal. Legacy rows are excluded (see header); ANY
 * malformed row -- unclassifiable, or classified operational but failing the strict deserializer --
 * throws LedgerRowIntegrityError naming the row id (never its contents).
 */
function authoritativeOperationalMovements(docs) {
    const out = [];
    for (const doc of docs) {
        const data = doc.data();
        const cls = (0, operationalMovementRepository_js_1.classifyLedgerDoc)(data);
        if (cls === "legacy")
            continue;
        if (cls !== "operational")
            throw new LedgerRowIntegrityError(doc.id, "UNCLASSIFIABLE");
        try {
            out.push((0, operationalMovementRepository_js_1.deserializeOperationalMovement)(data).value);
        }
        catch {
            throw new LedgerRowIntegrityError(doc.id, "UNREADABLE_OPERATIONAL");
        }
    }
    return out;
}
function censusLedgerRows(docs) {
    let operational = 0;
    let legacy = 0;
    const byReason = { UNCLASSIFIABLE: 0, UNREADABLE_OPERATIONAL: 0 };
    const malformedIds = [];
    const blocked = new Set();
    let withoutPart = 0;
    for (const doc of docs) {
        const data = doc.data();
        const cls = (0, operationalMovementRepository_js_1.classifyLedgerDoc)(data);
        if (cls === "legacy") {
            legacy += 1;
            continue;
        }
        let reason = null;
        if (cls !== "operational")
            reason = "UNCLASSIFIABLE";
        else {
            try {
                (0, operationalMovementRepository_js_1.deserializeOperationalMovement)(data);
                operational += 1;
            }
            catch {
                reason = "UNREADABLE_OPERATIONAL";
            }
        }
        if (reason === null)
            continue;
        byReason[reason] += 1;
        malformedIds.push(doc.id);
        const partId = data && typeof data === "object" && !Array.isArray(data) ? data.partId : undefined;
        if (typeof partId === "string" && partId.trim() !== "")
            blocked.add(partId);
        else
            withoutPart += 1;
    }
    const malformed = byReason.UNCLASSIFIABLE + byReason.UNREADABLE_OPERATIONAL;
    return Object.freeze({
        total: docs.length,
        operational,
        legacy,
        malformed,
        malformedByReason: Object.freeze({ ...byReason }),
        malformedRowIds: Object.freeze([...malformedIds].sort()),
        blockedPartIds: Object.freeze([...blocked].sort()),
        malformedWithoutPartId: withoutPart,
        verdict: malformed === 0 ? "READY" : "MALFORMED_ROWS_PRESENT",
    });
}
//# sourceMappingURL=authoritativeLedgerRows.js.map