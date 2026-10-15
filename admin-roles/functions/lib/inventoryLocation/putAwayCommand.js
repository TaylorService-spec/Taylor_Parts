"use strict";
// PUT-AWAY — recording WHERE stock was stowed, without changing WHAT there is.
//
// ============================ THE LOAD-BEARING INVARIANT ============================
//
// DECISIONS #116: the warehouse is the inventory custody authority; a bin is a descriptive physical
// sub-location. **PUTTING STOCK INTO A BIN MUST NOT REMOVE IT FROM WAREHOUSE ON-HAND OR AVAILABLE.**
//
// Every governed authority — availability, receiving, transfer, cycle count — counts a movement only
// at `type === "WAREHOUSE"`. If put-away wrote a ledger event moving stock to a BIN, the moment a
// receipt was stowed it would disappear from sellable on-hand, from transfer sufficiency and from
// cycle-count expected quantity. That is precisely the failure #116 was decided to prevent.
//
// So this command writes a PLACEMENT RECORD and NOTHING ELSE. It writes no ledger event, changes no
// quantity, and touches no balance. A test asserts the module never imports the ledger, a movement
// type, or any balance function — because a comment promising it is not enough.
//
// ============================ PLACEMENT IS AN EVENT, NOT A BALANCE ============================
//
// A bin is not a custody location, so there is no authoritative "how many are in A-14". What IS
// authoritative is what somebody recorded doing: "on this date, N units of PRT-1001 were stowed in
// A-14". Placements are therefore append-only EVENTS, and any "where is it" answer is explicitly
// "where it was last put", not "what is there now".
//
// That limitation is the honest cost of #116 and is stated in the docs rather than papered over. If
// warehouse operations later need bin-level accuracy, that is the separate custody decision the
// assessment already frames — not something to smuggle in here by accumulating a balance.
//
// ============================ SERIALIZED UNITS ARE PLACED INDIVIDUALLY ============================
//
// A serialized unit has its own place. Each serial gets its own placement record, so "where is
// SN-42" has a single answer rather than "somewhere among the twelve we stowed that day".
//
// ============================ NO QUARANTINE ============================
//
// DECISIONS #117: quarantine and inspection are excluded from initial put-away and stay a future
// explicit workflow. This command records placement. It does not classify condition, does not hold
// stock pending inspection, and does not gate availability.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PLACEMENT_NOTE = exports.PlacementBinError = exports.PlacementIdempotencyConflictError = exports.PlacementUnauthorizedError = exports.PlacementInvalidError = exports.PLACEMENT_RECORD_CAPABILITY = exports.BIN_PLACEMENTS_COLLECTION = void 0;
exports.derivePlacementId = derivePlacementId;
exports.buildPlacementEntries = buildPlacementEntries;
exports.validatePutAwayRequest = validatePutAwayRequest;
exports.recordPutAway = recordPutAway;
const serializedAssetRegistration_js_1 = require("../serializedAsset/serializedAssetRegistration.js");
const collections_js_1 = require("../constants/collections.js");
const binCommands_js_1 = require("./binCommands.js");
const binRegistry_js_1 = require("./binRegistry.js");
exports.BIN_PLACEMENTS_COLLECTION = "bin_placements";
/**
 * The capability that authorizes recording a placement.
 *
 * SEPARATE from `inventory.location.bin.manage` (labelling racking) and from
 * `inventory.location.bin.read` (checking a bin is real): stowing stock is a third audience again.
 * A warehouse operator stows all day and should never be able to retire a rack.
 *
 * Also separate from `inventory.stock.receive`: receiving is a custody event that changes what the
 * company has; put-away only says where it went. Reusing the receive capability would make every
 * stow look like an authority to accept stock.
 */
exports.PLACEMENT_RECORD_CAPABILITY = "inventory.placement.record";
class PlacementInvalidError extends Error {
}
exports.PlacementInvalidError = PlacementInvalidError;
class PlacementUnauthorizedError extends Error {
}
exports.PlacementUnauthorizedError = PlacementUnauthorizedError;
/** The idempotency key was already used for a DIFFERENT stow (another bin, part, quantity, serial set, pick or note). */
class PlacementIdempotencyConflictError extends Error {
}
exports.PlacementIdempotencyConflictError = PlacementIdempotencyConflictError;
class PlacementBinError extends Error {
    resolution;
    constructor(resolution) {
        super(resolution);
        this.resolution = resolution;
    }
}
exports.PlacementBinError = PlacementBinError;
const isNonBlank = (v) => typeof v === "string" && v.trim() !== "";
/**
 * The deterministic placement id.
 *
 * Derived from the idempotency key plus the SERIAL (or the part, for a quantity placement), so a
 * retried submission of the same stow writes the same documents rather than doubling the record. A
 * placement is not a balance, but a duplicated placement would still make "where was it last put"
 * ambiguous, and a warehouse phone on a bad connection retries.
 */
function derivePlacementId(idempotencyKey, discriminator) {
    return `plc_${idempotencyKey}__${discriminator}`;
}
/**
 * The placement records one stow produces. PURE, and the ONLY definition of a placement record's
 * shape: recordPutAway uses it, and so does the BIN-P6 relocation command when a put-away also moves
 * stock (Decision #170: that operation needs BOTH capabilities and writes BOTH facts atomically).
 * Exported so the second caller composes this shape rather than re-typing it.
 *
 * One record per SERIAL, because a serialized unit has its own place; one record for a quantity stow,
 * because bulk does not.
 */
function buildPlacementEntries(input) {
    const base = {
        warehouseId: input.warehouseId,
        binId: input.binId,
        binCode: input.binCode,
        partId: input.partId,
        placedAt: input.now,
        placedBy: input.actorId,
        idempotencyKey: input.idempotencyKey,
        // Present only on a PICK. Its absence is what makes a record a plain stow, so it is written
        // as null rather than omitted -- a missing field and a deliberate "not picked for anything"
        // must not be the same thing to a later reader.
        pickedForWorkOrderId: input.pickedForWorkOrderId,
        // Stored as written. Null rather than omitted, so "no note" is a fact rather than an absence.
        note: input.note,
        schemaVersion: 1,
    };
    return input.serialNumbers.length > 0
        ? input.serialNumbers.map((serialNo) => ({
            id: derivePlacementId(input.idempotencyKey, serialNo),
            data: { ...base, serialNo, quantity: 1 },
        }))
        : [{
                id: derivePlacementId(input.idempotencyKey, input.partId),
                data: { ...base, serialNo: null, quantity: input.quantity },
            }];
}
/** Long enough for a real explanation; short enough that it is a note and not a document. */
exports.MAX_PLACEMENT_NOTE = 500;
/**
 * Shape validation only. What is TRUE about the bin and the serials is checked in the transaction.
 *
 * TWO INPUT PATHS, ONE PERSISTED IDENTITY. An operator either types/picks a human code within their
 * warehouse, or scans a label whose token is the stable `binId`. Exactly one may be supplied — a
 * request carrying both is ambiguous about which the caller actually meant, and the two are resolved
 * through different authorities. Both converge on the same stable `binId` before anything is written.
 */
function validatePutAwayRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return { valid: false, reason: "not_object" };
    const d = input;
    if (!isNonBlank(d.warehouseId))
        return { valid: false, reason: "warehouse_required" };
    if (!isNonBlank(d.partId))
        return { valid: false, reason: "part_required" };
    if (!isNonBlank(d.idempotencyKey))
        return { valid: false, reason: "idempotency_key_required" };
    const hasBinId = d.binId !== undefined;
    const hasBinCode = d.binCode !== undefined;
    if (hasBinId === hasBinCode)
        return { valid: false, reason: "bin_code_or_bin_id_required" };
    let binCode;
    let binId;
    if (hasBinId) {
        if (!(0, binRegistry_js_1.isSafeIdSegment)(d.binId) || !String(d.binId).startsWith("bin_"))
            return { valid: false, reason: "bin_id_invalid" };
        binId = d.binId;
    }
    else {
        const normalized = (0, binRegistry_js_1.normalizeBinCode)(d.binCode);
        if (!normalized.valid)
            return { valid: false, reason: normalized.reason };
        binCode = normalized.value.code;
    }
    let note;
    if (d.note !== undefined && d.note !== null) {
        if (typeof d.note !== "string")
            return { valid: false, reason: "note_invalid" };
        const trimmed = d.note.trim();
        // Refused, never truncated: silently cutting an explanation in half is worse than not taking it.
        if (trimmed.length > exports.MAX_PLACEMENT_NOTE)
            return { valid: false, reason: "note_too_long" };
        if (trimmed !== "")
            note = trimmed;
    }
    const hasSerials = d.serialNumbers !== undefined;
    const hasQuantity = d.quantity !== undefined;
    // EXACTLY ONE shape. A request carrying both is ambiguous about what was actually stowed, and
    // guessing which the caller meant is how a serialized unit ends up recorded as bulk.
    if (hasSerials === hasQuantity)
        return { valid: false, reason: "quantity_or_serials_required" };
    if (hasSerials) {
        if (!Array.isArray(d.serialNumbers) || d.serialNumbers.length === 0)
            return { valid: false, reason: "serials_invalid" };
        if (!d.serialNumbers.every(isNonBlank))
            return { valid: false, reason: "serials_invalid" };
        const seen = new Set(d.serialNumbers.map((s) => s.trim().toLowerCase()));
        if (seen.size !== d.serialNumbers.length)
            return { valid: false, reason: "serials_duplicated" };
        return {
            valid: true,
            value: {
                warehouseId: d.warehouseId, partId: d.partId, idempotencyKey: d.idempotencyKey,
                ...(binCode !== undefined ? { binCode } : {}),
                ...(binId !== undefined ? { binId } : {}),
                serialNumbers: d.serialNumbers.map((s) => s.trim()),
                ...(isNonBlank(d.pickedForWorkOrderId) ? { pickedForWorkOrderId: d.pickedForWorkOrderId.trim() } : {}),
                ...(note !== undefined ? { note } : {}),
            },
        };
    }
    if (typeof d.quantity !== "number" || !Number.isInteger(d.quantity) || d.quantity <= 0) {
        return { valid: false, reason: "quantity_invalid" };
    }
    return {
        valid: true,
        value: {
            warehouseId: d.warehouseId, partId: d.partId, idempotencyKey: d.idempotencyKey,
            ...(binCode !== undefined ? { binCode } : {}),
            ...(binId !== undefined ? { binId } : {}),
            quantity: d.quantity,
            ...(isNonBlank(d.pickedForWorkOrderId) ? { pickedForWorkOrderId: d.pickedForWorkOrderId.trim() } : {}),
            ...(note !== undefined ? { note } : {}),
        },
    };
}
/**
 * Record a put-away.
 *
 * One transaction, so a stow is recorded whole or not at all. Idempotent by derived id: a retry
 * finds the placements already written and reports `replayed`.
 */
async function recordPutAway(request, deps) {
    const validated = validatePutAwayRequest(request);
    if (!validated.valid)
        throw new PlacementInvalidError(validated.reason);
    const req = validated.value;
    return deps.db.runTransaction(async (txn) => {
        if (!(await deps.authorize(txn, deps.actor.id, exports.PLACEMENT_RECORD_CAPABILITY))) {
            throw new PlacementUnauthorizedError();
        }
        // REPLAY IS DECIDED FIRST, before any gate on CURRENT state. A committed stow whose response was
        // lost must replay even if the bin has since been deactivated or the serial has moved on: those
        // gates judge a NEW placement, and a retry is not one. The placement ids derive from the key and
        // the serial/part alone, so they are known before the bin is resolved.
        //
        // ONE KEY, ONE STOW. A stored placement under this key that disagrees with the request -- another
        // bin, part, quantity, pick or note -- is an idempotency CONFLICT, never a replay (which would
        // report a stow that did not happen) and never a top-up. And because a stow is written in ONE
        // transaction, a key that holds SOME of this request's placements but not all was used for a
        // different serial set: that is a conflict too, not a half-written retry to complete.
        const serialsForId = req.serialNumbers ?? [];
        const probeIds = serialsForId.length > 0
            ? serialsForId.map((serialNo) => derivePlacementId(req.idempotencyKey, serialNo))
            : [derivePlacementId(req.idempotencyKey, req.partId)];
        const probes = await Promise.all(probeIds.map((id) => txn.get(deps.db.collection(exports.BIN_PLACEMENTS_COLLECTION).doc(id))));
        const present = probes.filter((snap) => snap.exists);
        if (present.length > 0) {
            if (present.length !== probes.length)
                throw new PlacementIdempotencyConflictError("partial_key_reuse");
            let storedBinCode = null;
            for (const snap of probes) {
                const d = snap.data() ?? {};
                const same = d.idempotencyKey === req.idempotencyKey
                    && d.warehouseId === req.warehouseId
                    && d.partId === req.partId
                    && (req.binId !== undefined ? d.binId === req.binId : d.binCode === req.binCode)
                    && (d.pickedForWorkOrderId ?? null) === (req.pickedForWorkOrderId ?? null)
                    && (d.note ?? null) === (req.note ?? null)
                    && (serialsForId.length > 0 ? d.quantity === 1 : (d.serialNo ?? null) === null && d.quantity === req.quantity);
                if (!same)
                    throw new PlacementIdempotencyConflictError("different_stow");
                storedBinCode = typeof d.binCode === "string" ? d.binCode : storedBinCode;
            }
            return {
                outcome: "replayed",
                placementIds: probeIds,
                warehouseId: req.warehouseId,
                binCode: storedBinCode ?? req.binCode,
                partId: req.partId,
                quantity: serialsForId.length > 0 ? null : (req.quantity ?? 0),
                serialNumbers: serialsForId,
            };
        }
        // THE BIN MUST BE REAL, USABLE, AND AT THIS WAREHOUSE — read inside the transaction, so a bin
        // retired mid-stow cannot be stowed into.
        //
        // BOTH INPUT PATHS CONVERGE HERE on the stable binId, which is what gets persisted. A manual
        // code goes through the warehouse-scoped reservation index; a scanned token IS the binId and is
        // checked against the operator's warehouse. Neither path can reach a bin in another building.
        let binId;
        let binCode;
        if (req.binId !== undefined) {
            const snap = await txn.get(deps.db.collection(binCommands_js_1.BINS_COLLECTION).doc(req.binId));
            const resolution = (0, binRegistry_js_1.resolveBinFromToken)(req.binId, req.warehouseId, snap.exists ? (snap.data() ?? null) : null);
            if (resolution.result !== "FOUND")
                throw new PlacementBinError(resolution.result);
            binId = resolution.binId;
            binCode = resolution.code;
        }
        else {
            const claimSnap = await txn.get(deps.db.collection(binCommands_js_1.BIN_CODE_CLAIMS_COLLECTION).doc((0, binRegistry_js_1.deriveBinClaimId)(req.warehouseId, req.binCode)));
            const claim = claimSnap.exists ? (claimSnap.data() ?? null) : null;
            const claimedBinId = claim && typeof claim.binId === "string" ? claim.binId : null;
            const binSnap = claimedBinId === null
                ? null
                : await txn.get(deps.db.collection(binCommands_js_1.BINS_COLLECTION).doc(claimedBinId));
            const resolution = (0, binRegistry_js_1.resolveBinFromClaim)(req.binCode, req.warehouseId, claim, binSnap && binSnap.exists ? (binSnap.data() ?? null) : null);
            // A SUPERSEDED code is USABLE: the physical bin is correct, and refusing an honest stow
            // because a label has not been reprinted yet would block real work. The caller is told.
            if (resolution.result !== "FOUND" && resolution.result !== "FOUND_SUPERSEDED_CODE") {
                throw new PlacementBinError(resolution.result);
            }
            binId = resolution.binId;
            binCode = resolution.code;
        }
        const serials = req.serialNumbers ?? [];
        // A SERIAL must be a real unit of THIS part. Recording a placement for a serial that belongs to
        // another part would make "where is SN-42" answer with the wrong shelf for the wrong thing.
        for (const serialNo of serials) {
            // The CANONICAL serialized-asset id -- the same serializedAssetDocId every other reader and the
            // registration itself use. This used to look up `${partId}__${serial}` and then fall back to a
            // bare-serial id; NO writer produces either, so every real registered serial was refused as
            // serial_unknown and serialized put-away could never succeed. Found by BIN-P6, which moves
            // serialized stock into Bins and therefore has to find the serial it is moving.
            const assetSnap = await txn.get(deps.db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).doc((0, serializedAssetRegistration_js_1.serializedAssetDocId)(req.partId, serialNo)));
            if (!assetSnap.exists)
                throw new PlacementInvalidError("serial_unknown");
            if (assetSnap.data()?.partId !== req.partId)
                throw new PlacementInvalidError("serial_wrong_part");
        }
        const entries = buildPlacementEntries({
            warehouseId: req.warehouseId,
            binId,
            binCode,
            partId: req.partId,
            idempotencyKey: req.idempotencyKey,
            pickedForWorkOrderId: req.pickedForWorkOrderId ?? null,
            note: req.note ?? null,
            serialNumbers: serials,
            quantity: req.quantity ?? 0,
            now: deps.now(),
            actorId: deps.actor.id,
        });
        // None of these ids exists (the probe above decided replay/conflict), so every entry is new.
        entries.forEach((e) => {
            txn.create(deps.db.collection(exports.BIN_PLACEMENTS_COLLECTION).doc(e.id), e.data);
        });
        return {
            outcome: "recorded",
            placementIds: entries.map((e) => e.id),
            warehouseId: req.warehouseId,
            binCode,
            partId: req.partId,
            quantity: serials.length > 0 ? null : (req.quantity ?? 0),
            serialNumbers: serials,
        };
    });
}
//# sourceMappingURL=putAwayCommand.js.map