"use strict";
// Enterprise Inventory Phase 4 -- transfer_orders PERSISTENCE boundary (serialize / fail-closed
// deserialize / deterministic identity + fingerprint). Reuses the SAME `transfer_orders` collection the
// read model (transferOrderView.js) and Rules (`firestore.rules` transfer_orders match block, already
// create/update/delete: if false for every principal) already govern -- no second collection, no Rules
// change. Additively writes the legacy `fromWarehouseId`/`toWarehouseId` scalar fields WHEN both endpoints
// are WAREHOUSE, so a warehouse-manager's existing Rules-scoped read (isAssignedToWarehouse(resource.data.
// fromWarehouseId)) and the legacy RawTransferOrder client shape keep working unchanged; a WAREHOUSE<->
// MOBILE(truck) transfer carries no legacy fields (transferOrderView.js's generalized origin/destination
// path already reads that shape).
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprintTransferOrder = fingerprintTransferOrder;
exports.transferOrderDocId = transferOrderDocId;
exports.serializeTransferOrder = serializeTransferOrder;
exports.deserializeTransferOrder = deserializeTransferOrder;
exports.transitionFields = transitionFields;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const transferOrderTypes_js_1 = require("./transferOrderTypes.js");
const transferOrderValidation_js_1 = require("./transferOrderValidation.js");
const operationalMovementValidation_js_1 = require("../inventoryLedger/operationalMovementValidation.js");
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = value;
        return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
// 16-hex fingerprint over the request-derived CREATE value only (mirrors the ledger/receiving precedent):
// replay iff equal, conflict iff not.
function fingerprintTransferOrder(value) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}
// Deterministic, PATH-SAFE transfer identity from the caller idempotencyKey.
function transferOrderDocId(idempotencyKey) {
    return "trf_" + (0, node_crypto_1.createHash)("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}
function isActor(a) {
    return (0, operationalMovementValidation_js_1.isPlainObject)(a) && (a.kind === "USER" || a.kind === "SYSTEM") && (0, operationalMovementValidation_js_1.isNonEmptyString)(a.id);
}
// Serialize a validated CREATE value into the stored REQUESTED/version-1 order.
function serializeTransferOrder(value, actor, now, fingerprint) {
    const legacyWarehouseOnly = value.origin.type === "WAREHOUSE" && value.destination.type === "WAREHOUSE";
    return {
        schemaVersion: transferOrderTypes_js_1.TRANSFER_SCHEMA_VERSION,
        partId: value.partId,
        trackingMode: value.trackingMode,
        quantity: value.quantity,
        origin: { type: value.origin.type, locationId: value.origin.locationId },
        destination: { type: value.destination.type, locationId: value.destination.locationId },
        ...(value.serialNumbers === undefined ? {} : { serialNumbers: [...value.serialNumbers] }),
        ...(legacyWarehouseOnly ? { fromWarehouseId: value.origin.locationId, toWarehouseId: value.destination.locationId } : {}),
        status: "REQUESTED",
        version: 1,
        idempotencyKey: value.idempotencyKey,
        actor: { kind: actor.kind, id: actor.id },
        createdAt: firestore_1.Timestamp.fromDate(now),
        createdBy: actor.id,
        updatedAt: firestore_1.Timestamp.fromDate(now),
        updatedBy: actor.id,
        fingerprint,
    };
}
const STORED_KEYS = new Set([
    "schemaVersion", "partId", "trackingMode", "quantity", "origin", "destination", "serialNumbers",
    "fromWarehouseId", "toWarehouseId", "status", "version", "idempotencyKey", "actor",
    "createdAt", "createdBy", "updatedAt", "updatedBy", "fingerprint",
]);
// Fail-closed deserialize of a stored transfer_orders record. Never normalizes malformed data into
// validity -- throws TransferMalformedStoredRecordError on anything unexpected.
function deserializeTransferOrder(docId, data) {
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(data))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored transfer order is not an object");
    if (data.schemaVersion !== transferOrderTypes_js_1.TRANSFER_SCHEMA_VERSION)
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored schemaVersion invalid");
    if (Object.keys(data).some((k) => !STORED_KEYS.has(k)))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored record has unknown field");
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(data.partId))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored partId invalid");
    if (typeof data.trackingMode !== "string" || !transferOrderTypes_js_1.TRANSFER_SUPPORTED_TRACKING_MODES.includes(data.trackingMode)) {
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored trackingMode invalid");
    }
    const trackingMode = data.trackingMode;
    if (typeof data.quantity !== "number" || !Number.isInteger(data.quantity) || data.quantity <= 0) {
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored quantity invalid");
    }
    const origin = (0, transferOrderValidation_js_1.validateTransferLocationRef)(data.origin);
    if (origin === null)
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored origin invalid");
    const destination = (0, transferOrderValidation_js_1.validateTransferLocationRef)(data.destination);
    if (destination === null)
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored destination invalid");
    if (origin.type === destination.type && origin.locationId === destination.locationId) {
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored transfer has same origin/destination");
    }
    let serialNumbers;
    if (trackingMode === "SERIAL") {
        if (!Array.isArray(data.serialNumbers))
            throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored SERIAL transfer has no serialNumbers");
        const serials = data.serialNumbers;
        if (!serials.every((s) => (0, operationalMovementValidation_js_1.isNonEmptyString)(s)))
            throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored serialNumbers invalid");
        if (serials.length !== data.quantity)
            throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored serialNumbers count does not match quantity");
        if (new Set(serials).size !== serials.length)
            throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored serialNumbers contain duplicates");
        serialNumbers = [...serials];
    }
    else if (data.serialNumbers !== undefined) {
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored NONE transfer must not carry serialNumbers");
    }
    if (typeof data.status !== "string" || !transferOrderTypes_js_1.TRANSFER_ORDER_STATUSES.includes(data.status)) {
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored status invalid");
    }
    if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < 1) {
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored version invalid");
    }
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(data.idempotencyKey))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored idempotencyKey invalid");
    if (!isActor(data.actor))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored actor invalid");
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(data.createdBy) || !(0, operationalMovementValidation_js_1.isNonEmptyString)(data.updatedBy))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored createdBy/updatedBy invalid");
    if (!(data.createdAt instanceof firestore_1.Timestamp) || !(data.updatedAt instanceof firestore_1.Timestamp))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored timestamps are not server Timestamps");
    if (typeof data.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(data.fingerprint))
        throw new transferOrderTypes_js_1.TransferMalformedStoredRecordError("stored fingerprint invalid");
    const value = {
        partId: data.partId,
        trackingMode,
        quantity: data.quantity,
        origin,
        destination,
        ...(serialNumbers === undefined ? {} : { serialNumbers }),
        idempotencyKey: data.idempotencyKey,
    };
    return {
        transferOrderId: docId,
        value,
        status: data.status,
        version: data.version,
        actor: { kind: data.actor.kind, id: data.actor.id },
        createdAt: data.createdAt.toDate().getTime(),
        updatedAt: data.updatedAt.toDate().getTime(),
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
        schemaVersion: transferOrderTypes_js_1.TRANSFER_SCHEMA_VERSION,
        fingerprint: data.fingerprint,
    };
}
// Build the fields for a status-transition update (dispatch/receive/cancel). Never touches the
// create-time value fields (partId/quantity/origin/destination/serialNumbers/idempotencyKey/createdAt/
// createdBy) -- only status/version/updatedAt/updatedBy move.
function transitionFields(nextStatus, nextVersion, actor, now) {
    return { status: nextStatus, version: nextVersion, updatedAt: firestore_1.Timestamp.fromDate(now), updatedBy: actor.id };
}
//# sourceMappingURL=transferOrderRepository.js.map