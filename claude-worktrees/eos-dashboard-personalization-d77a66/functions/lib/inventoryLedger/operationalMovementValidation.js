"use strict";
// Enterprise Inventory -- EI-P1 INERT backend foundation: operational movement envelope VALIDATION.
// A faithful TypeScript mirror of field-ops-app-vite/src/domain/inventoryLedgerEvent.js
// (validateInventoryMovementEvent). Same accept/reject decisions and the same `reason` strings, so
// the tests can assert byte-for-byte parity against the merged pure contract. PURE and DETERMINISTIC:
// no Firebase, no persistence, no stock math. recordedAt is a FORBIDDEN input (server-authored only).
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlainObject = isPlainObject;
exports.isNonEmptyString = isNonEmptyString;
exports.isTrackingMode = isTrackingMode;
exports.isEpochMillis = isEpochMillis;
exports.validateLocationRef = validateLocationRef;
exports.validateSourceObjectReason = validateSourceObjectReason;
exports.validateActorReason = validateActorReason;
exports.validateQuantityReason = validateQuantityReason;
exports.validateOperationalMovementEvent = validateOperationalMovementEvent;
exports.isOperationalMovementEvent = isOperationalMovementEvent;
const operationalMovementTypes_js_1 = require("./operationalMovementTypes.js");
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}
function isTrackingMode(value) {
    return typeof value === "string" && operationalMovementTypes_js_1.PART_TRACKING_MODES.includes(value);
}
// The maximum epoch-millis value representable by a JS Date (ECMA-262 +/-8.64e15).
const MAX_EPOCH_MILLIS = 8_640_000_000_000_000;
function isEpochMillis(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_EPOCH_MILLIS;
}
// EI-P1a discriminated location reference { type, locationId } -- fail-closed, only those two keys.
function validateLocationRef(ref) {
    if (!isPlainObject(ref))
        return null;
    const keys = Object.keys(ref);
    if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "locationId"))
        return null;
    if (typeof ref.type !== "string" || !operationalMovementTypes_js_1.INVENTORY_LOCATION_TYPES.includes(ref.type))
        return null;
    if (!isNonEmptyString(ref.locationId))
        return null;
    return { type: ref.type, locationId: ref.locationId };
}
function fail(reason) {
    return { valid: false, value: null, reason };
}
// Validate a discriminated source-object reference { type, id } against the required type.
function validateSourceObjectReason(sourceObject, requiredType) {
    if (!isPlainObject(sourceObject))
        return "source_object_invalid";
    const keys = Object.keys(sourceObject);
    if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "id"))
        return "source_object_invalid";
    if (typeof sourceObject.type !== "string" || !operationalMovementTypes_js_1.SOURCE_OBJECT_TYPES.includes(sourceObject.type))
        return "source_object_invalid";
    if (!isNonEmptyString(sourceObject.id))
        return "source_object_invalid";
    if (sourceObject.type !== requiredType)
        return "source_incompatible";
    return null;
}
function validateActorReason(actor) {
    if (!isPlainObject(actor))
        return "actor_invalid";
    const keys = Object.keys(actor);
    if (keys.length !== 2 || !keys.every((k) => k === "kind" || k === "id"))
        return "actor_invalid";
    if (typeof actor.kind !== "string" || !operationalMovementTypes_js_1.ACTOR_KINDS.includes(actor.kind))
        return "actor_kind_invalid";
    if (!isNonEmptyString(actor.id))
        return "actor_id_invalid";
    if (actor.kind === "SYSTEM" && !operationalMovementTypes_js_1.SYSTEM_ACTOR_IDS.includes(actor.id))
        return "system_actor_not_allowed";
    return null;
}
// Per-mode / per-direction quantity rules (SHAPE only; no stock math). SERIAL -> exactly 1;
// SIGNED -> nonzero; IN/OUT -> > 0. All must be finite numbers.
function validateQuantityReason(mode, direction, quantity) {
    if (typeof quantity !== "number" || !Number.isFinite(quantity))
        return "quantity_invalid";
    if (mode === "SERIAL")
        return quantity === 1 ? null : "quantity_invalid";
    if (direction === "SIGNED")
        return quantity !== 0 ? null : "quantity_invalid";
    return quantity > 0 ? null : "quantity_invalid";
}
// The pure envelope validator (mirror). `part` supplies the canonical tracking mode + identity.
function validateOperationalMovementEvent(event, part) {
    if (!isPlainObject(event))
        return fail("not_object");
    if (typeof event.type !== "string" || !operationalMovementTypes_js_1.OPERATIONAL_MOVEMENT_TYPES.includes(event.type))
        return fail("type_invalid");
    const type = event.type;
    const direction = operationalMovementTypes_js_1.MOVEMENT_DIRECTION[type];
    const isTransfer = type === "TRANSFER_OUT" || type === "TRANSFER_IN";
    if (!isPlainObject(part) || !isNonEmptyString(part.partId))
        return fail("part_invalid");
    if (!isTrackingMode(part.trackingMode))
        return fail("tracking_mode_invalid");
    if (!isNonEmptyString(event.partId))
        return fail("part_id_invalid");
    if (event.partId !== part.partId)
        return fail("part_mismatch");
    const mode = part.trackingMode;
    // Unknown-field gate; recordedAt is always forbidden (reserved for the trusted server writer).
    const allowed = new Set(["type", "partId", "location", "quantity", "sourceObject", "idempotencyKey", "actor", "occurredAt"]);
    if (mode === "SERIAL")
        allowed.add("serialNo");
    if (mode === "LOT")
        allowed.add("lotId");
    if (isTransfer)
        allowed.add("counterpartyLocation");
    if (Object.prototype.hasOwnProperty.call(event, "recordedAt"))
        return fail("recorded_at_forbidden");
    if (Object.keys(event).some((k) => !allowed.has(k)))
        return fail("unknown_field");
    if (mode === "SERIAL" && !isNonEmptyString(event.serialNo))
        return fail("serial_no_invalid");
    if (mode === "LOT" && !isNonEmptyString(event.lotId))
        return fail("lot_id_invalid");
    const location = validateLocationRef(event.location);
    if (location === null)
        return fail("location_invalid");
    let counterparty = null;
    if (isTransfer) {
        const cp = validateLocationRef(event.counterpartyLocation);
        if (cp === null)
            return fail("counterparty_invalid");
        if (cp.type === location.type && cp.locationId === location.locationId)
            return fail("transfer_same_location");
        counterparty = cp;
    }
    const quantityReason = validateQuantityReason(mode, direction, event.quantity);
    if (quantityReason)
        return fail(quantityReason);
    const sourceReason = validateSourceObjectReason(event.sourceObject, operationalMovementTypes_js_1.MOVEMENT_SOURCE_TYPE[type]);
    if (sourceReason)
        return fail(sourceReason);
    if (!isNonEmptyString(event.idempotencyKey))
        return fail("idempotency_key_invalid");
    const actorReason = validateActorReason(event.actor);
    if (actorReason)
        return fail(actorReason);
    if (!isEpochMillis(event.occurredAt))
        return fail("occurred_at_invalid");
    const source = event.sourceObject;
    const actor = event.actor;
    const value = {
        type,
        direction,
        partId: event.partId,
        trackingMode: mode,
        location,
        quantity: event.quantity,
        sourceObject: { type: source.type, id: source.id },
        idempotencyKey: event.idempotencyKey,
        actor: { kind: actor.kind, id: actor.id },
        occurredAt: event.occurredAt,
        ...(mode === "SERIAL" ? { serialNo: event.serialNo } : {}),
        ...(mode === "LOT" ? { lotId: event.lotId } : {}),
        ...(isTransfer && counterparty ? { counterpartyLocation: counterparty } : {}),
    };
    return { valid: true, value, reason: null };
}
function isOperationalMovementEvent(event, part) {
    return validateOperationalMovementEvent(event, part).valid;
}
//# sourceMappingURL=operationalMovementValidation.js.map