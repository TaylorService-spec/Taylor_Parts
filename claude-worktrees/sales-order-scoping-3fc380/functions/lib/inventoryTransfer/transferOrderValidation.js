"use strict";
// Enterprise Inventory Phase 4 -- pure CREATE-request validation for the Transfer command family.
// PURE and DETERMINISTIC: no Firebase, no persistence, no stock math. Validates the UNTRUSTED create
// request against the injected authoritative Part (partId + trackingMode). Server-authored fields
// (status/version/actor/timestamps) are FORBIDDEN in the input. Reuses the ledger's isPlainObject /
// isNonEmptyString helpers so "well-formed" means the same thing everywhere in the backend.
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTransferLocationRef = validateTransferLocationRef;
exports.validateCreateTransferInput = validateCreateTransferInput;
const operationalMovementValidation_js_1 = require("../inventoryLedger/operationalMovementValidation.js");
const transferOrderTypes_js_1 = require("./transferOrderTypes.js");
function fail(reason) {
    return { valid: false, value: null, reason };
}
// Phase-4-scoped location reference: {type, locationId}, type restricted to WAREHOUSE|MOBILE. A
// CUSTOMER/BIN/VENDOR/VIRTUAL endpoint (legal in the broader EI-P1a vocabulary) fails closed HERE --
// deliberately narrower than the general ledger validator, because this authority does not implement
// customer delivery.
function validateTransferLocationRef(ref) {
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(ref))
        return null;
    const keys = Object.keys(ref);
    if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "locationId"))
        return null;
    if (typeof ref.type !== "string" || !transferOrderTypes_js_1.TRANSFER_ENDPOINT_TYPES.includes(ref.type))
        return null;
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(ref.locationId))
        return null;
    return { type: ref.type, locationId: ref.locationId };
}
function sameLocation(a, b) {
    return a.type === b.type && a.locationId === b.locationId;
}
const ALLOWED_INPUT_KEYS = new Set(["partId", "quantity", "origin", "destination", "serialNumbers", "idempotencyKey"]);
// Validate a create-transfer request. `authority` supplies the canonical Part (partId + trackingMode).
// Returns the normalized value on success. Location ACTIVE-ness and origin stock sufficiency are NOT
// checked here -- those are commit-time, transaction-read concerns the command checks separately
// (mirrors receiveInventoryStockCommand.ts's split between structural validation and injected resolvers).
function validateCreateTransferInput(input, authority) {
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(input))
        return fail("not_object");
    if (Object.keys(input).some((k) => !ALLOWED_INPUT_KEYS.has(k)))
        return fail("unknown_field");
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(authority))
        return fail("authority_invalid");
    const partAuthority = (0, operationalMovementValidation_js_1.isPlainObject)(authority.part) ? authority.part : null;
    if (!partAuthority || !(0, operationalMovementValidation_js_1.isNonEmptyString)(partAuthority.partId))
        return fail("part_invalid");
    if (typeof partAuthority.trackingMode !== "string" || !transferOrderTypes_js_1.TRANSFER_SUPPORTED_TRACKING_MODES.includes(partAuthority.trackingMode)) {
        return fail("tracking_mode_unsupported"); // LOT deferred
    }
    const trackingMode = partAuthority.trackingMode;
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(input.partId))
        return fail("part_id_invalid");
    if (input.partId !== partAuthority.partId)
        return fail("part_mismatch");
    const origin = validateTransferLocationRef(input.origin);
    if (origin === null)
        return fail("origin_invalid");
    const destination = validateTransferLocationRef(input.destination);
    if (destination === null)
        return fail("destination_invalid");
    if (sameLocation(origin, destination))
        return fail("same_location");
    if (typeof input.quantity !== "number" || !Number.isFinite(input.quantity) || !Number.isInteger(input.quantity) || input.quantity <= 0) {
        return fail("quantity_invalid");
    }
    const quantity = input.quantity;
    let serialNumbers = null;
    if (trackingMode === "SERIAL") {
        if (!Array.isArray(input.serialNumbers))
            return fail("serial_numbers_missing");
        const trimmed = [];
        for (const raw of input.serialNumbers) {
            if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(raw))
                return fail("serial_number_invalid");
            trimmed.push(raw.trim());
        }
        if (trimmed.length !== quantity)
            return fail("serial_count_mismatch");
        if (new Set(trimmed).size !== trimmed.length)
            return fail("serial_numbers_duplicated");
        serialNumbers = trimmed;
    }
    else if (input.serialNumbers !== undefined) {
        return fail("serial_numbers_not_allowed"); // NONE transfer carries no serial identity
    }
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(input.idempotencyKey))
        return fail("idempotency_key_invalid");
    const value = {
        partId: input.partId,
        trackingMode,
        quantity,
        origin,
        destination,
        ...(serialNumbers === null ? {} : { serialNumbers }),
        idempotencyKey: input.idempotencyKey,
    };
    return { valid: true, value, reason: null };
}
//# sourceMappingURL=transferOrderValidation.js.map