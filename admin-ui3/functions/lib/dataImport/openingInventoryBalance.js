"use strict";
// EOS Data Import -- the governed OPENING INVENTORY BALANCE command (Owner ruling, P1).
//
// WHAT THIS IS
//   "Initialize the EOS ledger with a known opening quantity for a part at a governed
//    inventory location, as part of an authorized onboarding/import job."
//
// WHAT THIS IS NOT
//   Not receiving. Not a transfer. Not a cycle count. Not a routine adjustment. Not
//   ongoing synchronization. Not a general inventory-adjustment API.
//
// WHY IT USES THE EXISTING PRIMITIVE
//   The ledger already has the right one. Cycle Count corrects inventory truth by writing
//   ADJUSTED (direction SIGNED, source ADJUSTMENT) through `inventory_transactions`, rather
//   than overwriting a balance -- CERT-LEDGER-COUNTED-08 removed the one movement type that
//   existed to make a count "look complete" without moving stock. An opening balance is the
//   same shape of fact: a signed correction to recorded truth, attributed to a source object.
//
//   So this command invents NO movement type, NO source-object type, NO second balance table
//   (ADR-014 / Decision #160 retired the last one because it diverged from the ledger), and no
//   direct on-hand write. It composes:
//     * computeOpeningLedgerStateThroughTxn -- the same ledger sum discipline as
//       cycleCountExpectedQuantity.computeExpectedQuantityThroughTxn;
//     * stageOperationalMovement -- the existing idempotent ledger writer, which already
//       gives applied / replayed / IdempotencyConflictError for free.
//
// THE FAIL-CLOSED RULE
//   An opening balance may only INITIALIZE. If the (part, location) pair already carries
//   operational movement history, the row is REFUSED -- this command will not compute a
//   delta to force live stock back to a spreadsheet number. That would turn onboarding into
//   an uncontrolled inventory-reset mechanism. A later correction belongs to governed Cycle
//   Count, which is what that authority is for.
//
//   Prior history means any operational movement at the pair EXCEPT this command's own
//   earlier opening event, which is what makes replay safe without making reset possible.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpeningBalanceError = exports.OPENING_BALANCE_SOURCE_PREFIX = void 0;
exports.computeOpeningLedgerStateThroughTxn = computeOpeningLedgerStateThroughTxn;
exports.openingBalanceIdempotencyKey = openingBalanceIdempotencyKey;
exports.openingBalanceSourceObjectId = openingBalanceSourceObjectId;
exports.applyOpeningInventoryBalanceThroughTxn = applyOpeningInventoryBalanceThroughTxn;
const collections_js_1 = require("../constants/collections.js");
const operationalMovementRepository_js_1 = require("../inventoryLedger/operationalMovementRepository.js");
/** Source-object id prefix. Ties every opening movement durably to its import job + row. */
exports.OPENING_BALANCE_SOURCE_PREFIX = "IMPORT_OPENING_BALANCE";
class OpeningBalanceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "OpeningBalanceError";
        this.code = code;
    }
}
exports.OpeningBalanceError = OpeningBalanceError;
function isOpeningBalanceMovement(sourceType, sourceId) {
    return sourceType === "ADJUSTMENT" && sourceId.startsWith(`${exports.OPENING_BALANCE_SOURCE_PREFIX}:`);
}
/**
 * Read the ledger at (partId, location) and separate THIS command's opening events from
 * everything else. Same sourcing discipline as cycleCountExpectedQuantity: an allowlist over
 * classified operational records, malformed rows skipped rather than trusted.
 */
async function computeOpeningLedgerStateThroughTxn(txn, db, partId, location) {
    const snap = await txn.get(db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId));
    let openingQuantity = 0;
    const openingSourceIds = new Set();
    const foreign = new Set();
    for (const doc of snap.docs) {
        const data = doc.data();
        if ((0, operationalMovementRepository_js_1.classifyLedgerDoc)(data) !== "operational")
            continue;
        let mv;
        try {
            mv = (0, operationalMovementRepository_js_1.deserializeOperationalMovement)(data);
        }
        catch {
            continue; // malformed is skipped, never trusted -- it must not mask real history either way
        }
        const v = mv.value;
        if (v.location.type !== location.type || v.location.locationId !== location.locationId)
            continue;
        if (isOpeningBalanceMovement(v.sourceObject.type, v.sourceObject.id)) {
            // ADJUSTED is already signed.
            openingQuantity += v.quantity;
            openingSourceIds.add(v.sourceObject.id);
            continue;
        }
        // ANY other operational movement at this pair is operational history. Deliberately not an
        // allowlist of "interesting" types: receiving, transfer, consumption, scrap, return and a
        // non-opening adjustment all mean the position is live, and a type added later is caught
        // by default rather than silently ignored.
        foreign.add(v.type);
    }
    return Object.freeze({
        openingQuantity,
        openingSourceIds: Object.freeze([...openingSourceIds].sort()),
        hasOperationalHistory: foreign.size > 0,
        foreignMovementTypes: Object.freeze([...foreign].sort()),
    });
}
/**
 * Deterministic idempotency identity. The same logical approved row can never produce two
 * opening movements, and a replay carrying different material facts fails as a conflict
 * (stageOperationalMovement fingerprints the whole value) rather than silently rewriting.
 */
function openingBalanceIdempotencyKey(input) {
    return [
        exports.OPENING_BALANCE_SOURCE_PREFIX,
        input.importJobId,
        input.sourceRowKey,
        input.partId,
        input.location.type,
        input.location.locationId,
    ].join(":");
}
/** Source-object id: durably ties the ledger event to the import job and the source row. */
function openingBalanceSourceObjectId(importJobId, sourceRowKey) {
    return `${exports.OPENING_BALANCE_SOURCE_PREFIX}:${importJobId}:${sourceRowKey}`;
}
function assertQuantity(q) {
    if (typeof q !== "number" || !Number.isFinite(q)) {
        throw new OpeningBalanceError("OPENING_BALANCE_QUANTITY_INVALID", "Opening quantity must be a finite number. NaN, Infinity and non-numeric values are refused.");
    }
    if (q < 0) {
        throw new OpeningBalanceError("OPENING_BALANCE_QUANTITY_INVALID", "Opening quantity must be zero or greater.");
    }
    // Guard against precision the ledger cannot represent faithfully.
    if (Math.abs(q) > Number.MAX_SAFE_INTEGER) {
        throw new OpeningBalanceError("OPENING_BALANCE_QUANTITY_INVALID", "Opening quantity exceeds the supported range.");
    }
    return q;
}
/**
 * Apply ONE opening balance row inside an existing transaction.
 *
 * Ordering is the point: resolve, verify tracking mode, read ledger state, refuse if the
 * position is already operational, and only then stage. Nothing is written on any refusal path.
 */
async function applyOpeningInventoryBalanceThroughTxn(txn, db, input, deps) {
    if (!input.importJobId || typeof input.importJobId !== "string") {
        throw new OpeningBalanceError("OPENING_BALANCE_JOB_REQUIRED", "An import job id is required.");
    }
    if (!input.sourceRowKey || typeof input.sourceRowKey !== "string") {
        throw new OpeningBalanceError("OPENING_BALANCE_ROW_REQUIRED", "A source row key is required.");
    }
    if (!input.partId || typeof input.partId !== "string") {
        throw new OpeningBalanceError("OPENING_BALANCE_PART_REQUIRED", "A governed part is required.");
    }
    if (!input.location || typeof input.location.locationId !== "string" || input.location.locationId === "") {
        throw new OpeningBalanceError("OPENING_BALANCE_LOCATION_REQUIRED", "A governed inventory location is required.");
    }
    // SERIAL and LOT are refused, explicitly and by name. P1 does not invent serialized or
    // lot-controlled identity: a quantity-only row cannot carry the serial identity the
    // serialized_assets registry is the authority for, and there is no governed LOT identity
    // path to honour. Equipment import is a separate entity and unaffected by this.
    if (input.trackingMode !== "NONE") {
        throw new OpeningBalanceError("OPENING_BALANCE_TRACKING_MODE_UNSUPPORTED", `Opening balance import supports NONE-tracked parts only. This part is ${input.trackingMode}-tracked; ` +
            `a quantity-only row cannot establish ${input.trackingMode} identity.`);
    }
    const quantity = assertQuantity(input.openingQuantity);
    const state = await computeOpeningLedgerStateThroughTxn(txn, db, input.partId, input.location);
    // THE FAIL-CLOSED RULE. Refuse rather than compute a delta back to the spreadsheet value.
    if (state.hasOperationalHistory) {
        throw new OpeningBalanceError("OPENING_BALANCE_ALREADY_OPERATIONAL", "Opening balance cannot initialize an inventory position that already has operational movement history " +
            `(observed: ${state.foreignMovementTypes.join(", ")}). Correct it through governed Cycle Count instead.`);
    }
    // AN OPENING BALANCE IS THE FIRST STATEMENT, AND THERE IS ONLY ONE OF THEM.
    //
    // Found by the end-to-end test rather than by reading: importing the same position twice
    // was ACCEPTED and STACKED, because a prior opening event is not 'foreign' operational
    // history -- so 12 then 99 left a balance of 111 and two opening movements at one position.
    //
    // The second one was never an opening balance. It is an adjustment, and an adjustment that
    // arrives through this path carries none of the authority, reason or variance record that
    // adjusting a live position is supposed to carry.
    //
    // A REPLAY OF THE SAME ROW IS NOT THAT, and must still be allowed through to the
    // idempotency check below -- which is why this compares SOURCE IDS rather than looking at
    // the quantity. Same job, same row, same source id: a replay. Anything else: a second
    // opening balance, refused by name so the operator is told which of the two it is.
    const thisSourceId = openingBalanceSourceObjectId(input.importJobId, input.sourceRowKey);
    const priorOpening = state.openingSourceIds.filter((id) => id !== thisSourceId);
    if (priorOpening.length > 0) {
        throw new OpeningBalanceError("OPENING_BALANCE_ALREADY_SET", "An opening balance has already been set for this part at this location. There is only one " +
            "opening balance per position; correct the quantity through governed Cycle Count instead.");
    }
    // A zero opening quantity authors NO movement. Writing a meaningless zero row to make a
    // count look complete is exactly what CERT-LEDGER-COUNTED-08 removed from this ledger.
    if (quantity === 0) {
        return { outcome: "no-movement", docId: null, quantity: 0 };
    }
    const idempotencyKey = openingBalanceIdempotencyKey({
        importJobId: input.importJobId,
        sourceRowKey: input.sourceRowKey,
        partId: input.partId,
        location: input.location,
    });
    // The event envelope carries ONLY the fields the ledger validator allows. `direction` and
    // `trackingMode` are derived by the validator from the movement type and the part -- supplying
    // them here would be rejected as unknown fields, and would also mean two places could disagree
    // about what ADJUSTED's direction is.
    const event = {
        type: "ADJUSTED",
        partId: input.partId,
        location: input.location,
        quantity, // positive: initializing from nothing
        sourceObject: {
            type: "ADJUSTMENT",
            id: openingBalanceSourceObjectId(input.importJobId, input.sourceRowKey),
        },
        idempotencyKey,
        actor: { kind: "USER", id: input.actorUid },
        occurredAt: input.occurredAt,
    };
    const outcome = await (0, operationalMovementRepository_js_1.stageOperationalMovement)((0, operationalMovementRepository_js_1.firestoreLedgerStore)(txn, db), event, 
    // The canonical part identity + tracking mode the validator checks the event against.
    { partId: input.partId, trackingMode: input.trackingMode }, { now: deps.now });
    return { outcome: outcome.outcome, docId: outcome.docId, quantity };
}
//# sourceMappingURL=openingInventoryBalance.js.map