"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPAIR_OUTCOME = exports.EXPECTED_REPAIR_COUNT = exports.REPAIRABLE_WAREHOUSE_IDS = exports.REPAIRED_FIELD = void 0;
exports.classifyCanonicalIdRepair = classifyCanonicalIdRepair;
exports.planCanonicalIdRepair = planCanonicalIdRepair;
exports.canonicalIdPatch = canonicalIdPatch;
// Bounded repair of two sandbox warehouse roots that were seeded WITHOUT their canonical stored
// `id` (Owner ruling R-27, DECISIONS #151).
//
// PURE. No Firestore, no clock, no I/O, no throwing for data reasons.
//
// ============================ WHY NOT THE MIGRATION ============================
//
// warehouseGovernanceMigrationCli would have repaired these, and it was refused. It RECONSTRUCTS the
// document, so alongside the missing `id` it would have written:
//
//     provenance              NATIVE -> MIGRATED
//     governanceInitialized*  absent -> populated
//     updatedBy               seed-script -> operator
//
// Those describe a migration event that did not happen. These records were natively created by a
// seed script that forgot one field; saying otherwise would make the provenance field lie about
// their history, and authorship lie about who wrote them.
//
// So the repair is exactly one field per record. It is restoring a canonical identity invariant, not
// recording a business event — which is also why it emits no OWNERSHIP_HANDOFF. Nothing changes
// hands here; a record simply starts stating the id it always had.
//
// ============================ NOT A GENERIC WAREHOUSE PATCHER ============================
//
// Two record ids, one field name, one expected defect. Every one of those is a constant below rather
// than a parameter, because the difference between a bounded repair and a generic mutation utility
// is exactly whether the caller gets to choose.
const governedWarehouseValidation_js_1 = require("../warehouseGovernance/governedWarehouseValidation.js");
/** The ONE field this repair may ever write. */
exports.REPAIRED_FIELD = "id";
/** The ONLY records in scope. Not a parameter — see the header. */
exports.REPAIRABLE_WAREHOUSE_IDS = Object.freeze([
    "wh-sandbox-central",
    "wh-sandbox-north",
]);
exports.EXPECTED_REPAIR_COUNT = exports.REPAIRABLE_WAREHOUSE_IDS.length;
exports.REPAIR_OUTCOME = {
    /** The expected defect, exactly: stored id absent and everything else already governed. */
    REPAIR: "REPAIR",
    /** Already carries the right id. Idempotent success — no write. */
    ALREADY_CORRECT: "ALREADY_CORRECT",
    /** Carries a DIFFERENT id. Never overwritten: that is a data-integrity fault, not this defect. */
    REFUSED_ID_MISMATCH: "REFUSED_ID_MISMATCH",
    /** Exists, but its state is not the defect this repair is authorized for. */
    REFUSED_UNEXPECTED_STATE: "REFUSED_UNEXPECTED_STATE",
    /** No such document. */
    REFUSED_MISSING: "REFUSED_MISSING",
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/**
 * Decide one record against the EXACT expected defect. Never throws.
 *
 * Every precondition the ruling names is checked here rather than in the operator script, so the
 * refusals are testable offline and there is one place they live. A record that differs from the
 * expected defect in ANY respect is refused with the reason, not repaired on the assumption that
 * adding an id is harmless.
 */
function classifyCanonicalIdRepair(candidate) {
    const requestedId = candidate.warehouseId;
    const base = { warehouseId: requestedId, requestedId, plannedChangedKeys: [] };
    if (candidate.data === undefined) {
        return { ...base, currentId: null, outcome: exports.REPAIR_OUTCOME.REFUSED_MISSING, validatorBefore: null, validatorAfter: null, detail: null };
    }
    const data = candidate.data;
    const before = (0, governedWarehouseValidation_js_1.validateGovernedWarehouse)(data, requestedId);
    const storedId = has(data, exports.REPAIRED_FIELD) ? data[exports.REPAIRED_FIELD] : undefined;
    // Already correct -> idempotent success. Checked FIRST so a re-run over a repaired record is a
    // clean no-op rather than a refusal.
    if (typeof storedId === "string" && storedId === requestedId) {
        return {
            ...base,
            currentId: storedId,
            outcome: exports.REPAIR_OUTCOME.ALREADY_CORRECT,
            validatorBefore: before.valid ? null : before.reason,
            validatorAfter: before.valid ? null : before.reason,
            detail: null,
        };
    }
    // Present but wrong -> a data-integrity fault of a different kind. This repair never overwrites an
    // id, because a record whose stored id disagrees with its path is not "missing an id".
    if (storedId !== undefined) {
        return {
            ...base,
            currentId: typeof storedId === "string" ? storedId : JSON.stringify(storedId) ?? null,
            outcome: exports.REPAIR_OUTCOME.REFUSED_ID_MISMATCH,
            validatorBefore: before.valid ? null : before.reason,
            validatorAfter: null,
            detail: "stored id disagrees with the document id -- not the defect this repair is authorized for",
        };
    }
    // From here the id is genuinely absent. Everything below is the ruling's expected-defect contract.
    const unexpected = (detail) => ({
        ...base,
        currentId: null,
        outcome: exports.REPAIR_OUTCOME.REFUSED_UNEXPECTED_STATE,
        validatorBefore: before.valid ? null : before.reason,
        validatorAfter: null,
        detail,
    });
    if (before.valid)
        return unexpected("the record is already governed without a stored id -- contradictory, refuse");
    if (before.reason !== governedWarehouseValidation_js_1.GOVERNED_WAREHOUSE_REASONS.ID_INVALID) {
        return unexpected(`the record fails for a different reason (${before.reason}), so adding an id would not repair it`);
    }
    if (data.provenance !== "NATIVE")
        return unexpected(`provenance is ${JSON.stringify(data.provenance)}, expected NATIVE`);
    if (has(data, "governanceInitializedAt") || has(data, "governanceInitializedBy")) {
        return unexpected("governance-initialization metadata is present, which a NATIVE seed record must not carry");
    }
    if (has(data, "operatingCompanyId")) {
        return unexpected("an operating company is already present -- out of scope for an identity repair");
    }
    // The proof that one field is sufficient: the SAME canonical validator, on the patched document.
    const after = (0, governedWarehouseValidation_js_1.validateGovernedWarehouse)({ ...data, [exports.REPAIRED_FIELD]: requestedId }, requestedId);
    if (!after.valid)
        return unexpected(`adding the id does not make the record governed (${after.reason})`);
    return {
        ...base,
        currentId: null,
        outcome: exports.REPAIR_OUTCOME.REPAIR,
        validatorBefore: before.reason,
        validatorAfter: null,
        plannedChangedKeys: [exports.REPAIRED_FIELD],
        detail: null,
    };
}
/**
 * Preflight the COMPLETE batch, then mutate. One refusal blocks both records.
 *
 * Two records is small enough that partial repair looks harmless, which is exactly why it is
 * forbidden: a half-applied identity repair leaves a state no ruling describes and gives the next
 * operator no way to tell an intended partial from an aborted run.
 */
function planCanonicalIdRepair(candidates) {
    const byId = new Map(candidates.map((c) => [c.warehouseId, c]));
    const decisions = exports.REPAIRABLE_WAREHOUSE_IDS.map((id) => classifyCanonicalIdRepair(byId.get(id) ?? { warehouseId: id, data: undefined }));
    const refusals = decisions.filter((d) => d.outcome !== exports.REPAIR_OUTCOME.REPAIR && d.outcome !== exports.REPAIR_OUTCOME.ALREADY_CORRECT);
    const toRepair = decisions.filter((d) => d.outcome === exports.REPAIR_OUTCOME.REPAIR);
    const alreadyCorrect = decisions.filter((d) => d.outcome === exports.REPAIR_OUTCOME.ALREADY_CORRECT);
    let blockedReason = null;
    if (decisions.length !== exports.EXPECTED_REPAIR_COUNT) {
        blockedReason = `expected ${exports.EXPECTED_REPAIR_COUNT} records, planned ${decisions.length}`;
    }
    else if (refusals.length > 0) {
        blockedReason = `${refusals.length} refusal(s): ${refusals.map((r) => `${r.warehouseId}=${r.outcome}`).join(", ")}`;
    }
    return { ok: blockedReason === null, decisions, toRepair, alreadyCorrect, refusals, blockedReason };
}
/**
 * The exact patch. ONE key.
 *
 * PATCH, NEVER RECONSTRUCT — the whole reason this tool exists instead of the migration. Returning a
 * single key means the operator path has nothing else it could write even by accident.
 */
function canonicalIdPatch(decision) {
    if (decision.outcome !== exports.REPAIR_OUTCOME.REPAIR) {
        throw new Error(`canonicalIdPatch is only defined for REPAIR, got ${decision.outcome}`);
    }
    return Object.freeze({ [exports.REPAIRED_FIELD]: decision.requestedId });
}
//# sourceMappingURL=warehouseCanonicalIdRepair.js.map