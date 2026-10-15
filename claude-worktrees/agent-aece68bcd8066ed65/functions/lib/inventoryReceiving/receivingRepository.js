"use strict";
// Enterprise Inventory -- EI Phase-2 Receiving, Phase A: INERT receiving_orders PERSISTENCE boundary.
// INERT: no callable, no client writer, no ledger-append orchestration, no reorder closeout, no PO
// mutation, not invoked by any behavior. Provides deterministic path-safe identity + fingerprint,
// serialize / fail-closed deserialize (Timestamp->millis, no leak), and an idempotent stage function
// over an INJECTED store (reusing the merged inventoryLedger LedgerIdempotencyStore seam) so a future
// trusted command (Phase B) can stage the Receiving Order create INSIDE its own transaction. Reuses the
// merged inventoryLedger foundation; creates NO second ledger and touches no legacy collection.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprintReceivingOrder = fingerprintReceivingOrder;
exports.receivingOrderDocId = receivingOrderDocId;
exports.serializeReceivingOrder = serializeReceivingOrder;
exports.deserializeReceivingOrder = deserializeReceivingOrder;
exports.firestoreReceivingStore = firestoreReceivingStore;
exports.stageReceivingOrder = stageReceivingOrder;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const operationalMovementValidation_js_1 = require("../inventoryLedger/operationalMovementValidation.js");
const receivingTypes_js_1 = require("./receivingTypes.js");
const receivingValidation_js_1 = require("./receivingValidation.js");
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = value;
        return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
// 16-hex fingerprint over the request-derived value only (not the server-authored actor/timestamps):
// replay iff equal, conflict iff not (mirrors the ledger/truck-registry precedent).
function fingerprintReceivingOrder(value) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}
// Deterministic, PATH-SAFE receiving identity from the caller idempotencyKey. The raw caller string is
// never a Firestore path; the deterministic doc IS the idempotency record.
function receivingOrderDocId(idempotencyKey) {
    return "rcv_" + (0, node_crypto_1.createHash)("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}
// Serialize a validated value into the stored order. actor + createdAt/updatedAt/createdBy/updatedBy are
// SERVER-AUTHORED from the trusted caller's actor and clock (never accepted from untrusted input).
function serializeReceivingOrder(value, actor, now, fingerprint) {
    return {
        schemaVersion: receivingTypes_js_1.RECEIVING_SCHEMA_VERSION,
        receivingId: receivingOrderDocId(value.idempotencyKey), // stored identity == doc path; server-derived, never from input
        source: { type: value.source.type, reorderRequestId: value.source.reorderRequestId, purchaseOrderId: value.source.purchaseOrderId },
        receivingLocation: { type: value.receivingLocation.type, locationId: value.receivingLocation.locationId },
        status: value.status,
        version: value.version,
        lines: value.lines.map((l) => ({
            lineId: l.lineId, partId: l.partId, trackingMode: l.trackingMode,
            expectedQuantity: l.expectedQuantity, receivedQuantity: l.receivedQuantity, status: l.status,
            // Written only for a SERIAL line; a NONE line stores no serial key at all (the deserializer
            // enforces that in both directions).
            ...(l.serialNumbers === undefined ? {} : { serialNumbers: [...l.serialNumbers] }),
        })),
        idempotencyKey: value.idempotencyKey,
        actor: { kind: actor.kind, id: actor.id },
        createdAt: firestore_1.Timestamp.fromDate(now),
        createdBy: actor.id,
        updatedAt: firestore_1.Timestamp.fromDate(now),
        updatedBy: actor.id,
        fingerprint,
    };
}
function isActor(a) {
    return (0, operationalMovementValidation_js_1.isPlainObject)(a) && (a.kind === "USER" || a.kind === "SYSTEM") && (0, operationalMovementValidation_js_1.isNonEmptyString)(a.id);
}
function isPositiveFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v) && v > 0;
}
const STORED_KEYS = new Set([
    "schemaVersion", "receivingId", "source", "receivingLocation", "status", "version", "lines", "idempotencyKey",
    "actor", "createdAt", "createdBy", "updatedAt", "updatedBy", "fingerprint",
]);
const RECEIVING_ID_RE = /^rcv_[0-9a-f]{40}$/;
const STORED_LINE_KEYS = new Set(["lineId", "partId", "trackingMode", "expectedQuantity", "receivedQuantity", "status", "serialNumbers"]);
// Fail-closed deserialize of a stored receiving_orders record. Validates self-consistency (first-slice
// shape: PUTAWAY_COMPLETE / version 1 / one NONE line / expected == received), converts server
// Timestamps to millis (no Timestamp leaks into the value), and throws MalformedStoredRecordError on
// anything unexpected -- never normalizes malformed data into validity.
function deserializeReceivingOrder(data) {
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(data))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receiving order is not an object");
    if (data.schemaVersion !== receivingTypes_js_1.RECEIVING_SCHEMA_VERSION)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored schemaVersion invalid");
    if (Object.keys(data).some((k) => !STORED_KEYS.has(k)))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored record has unknown field");
    if (data.status !== "PUTAWAY_COMPLETE")
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored status invalid for first-slice order");
    if (data.version !== receivingTypes_js_1.RECEIVING_INITIAL_VERSION)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored version invalid for first-slice order");
    const source = data.source;
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(source) || typeof source.type !== "string" || !receivingTypes_js_1.RECEIVING_SOURCE_TYPES.includes(source.type) ||
        !(0, operationalMovementValidation_js_1.isNonEmptyString)(source.reorderRequestId) || !(0, operationalMovementValidation_js_1.isNonEmptyString)(source.purchaseOrderId) || source.purchaseOrderId !== source.reorderRequestId) {
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored source invalid");
    }
    const location = (0, operationalMovementValidation_js_1.validateLocationRef)(data.receivingLocation);
    if (location === null)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingLocation invalid");
    if (!Array.isArray(data.lines) || data.lines.length !== 1)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored lines invalid");
    const l = data.lines[0];
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(l) || Object.keys(l).some((k) => !STORED_LINE_KEYS.has(k)))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored line shape invalid");
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(l.lineId) || !(0, operationalMovementValidation_js_1.isNonEmptyString)(l.partId))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored line identity invalid");
    if (!receivingTypes_js_1.RECEIVING_SUPPORTED_TRACKING_MODES.includes(l.trackingMode) || l.status !== receivingTypes_js_1.RECEIVING_LINE_STATUS) {
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored line mode/status invalid");
    }
    const storedMode = l.trackingMode;
    if (!isPositiveFiniteNumber(l.expectedQuantity) || !isPositiveFiniteNumber(l.receivedQuantity) || l.expectedQuantity !== l.receivedQuantity) {
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored line quantity invalid");
    }
    // Serial identity, re-validated on the way OUT with the same rules applied on the way in. A stored
    // record that lost, gained, duplicated or mis-counted its serials is malformed -- never normalized
    // into validity, because this value is what replay coherence is fingerprinted against.
    let storedSerialNumbers;
    if (storedMode === "SERIAL") {
        if (!Array.isArray(l.serialNumbers))
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored SERIAL line has no serialNumbers");
        const serials = l.serialNumbers;
        if (!serials.every((s) => (0, operationalMovementValidation_js_1.isNonEmptyString)(s)))
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored serialNumbers invalid");
        if (serials.length !== l.receivedQuantity)
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored serialNumbers count does not match receivedQuantity");
        if (new Set(serials).size !== serials.length)
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored serialNumbers contain duplicates");
        storedSerialNumbers = [...serials];
    }
    else if (l.serialNumbers !== undefined) {
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored NONE line must not carry serialNumbers");
    }
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(data.idempotencyKey))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored idempotencyKey invalid");
    // Stored identity must be a path-safe receivingId that agrees with the idempotency-derived doc id.
    if (typeof data.receivingId !== "string" || !RECEIVING_ID_RE.test(data.receivingId))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingId invalid");
    if (data.receivingId !== receivingOrderDocId(data.idempotencyKey))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingId does not agree with its idempotencyKey");
    if (!isActor(data.actor))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored actor invalid");
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(data.createdBy) || !(0, operationalMovementValidation_js_1.isNonEmptyString)(data.updatedBy))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored createdBy/updatedBy invalid");
    if (!(data.createdAt instanceof firestore_1.Timestamp) || !(data.updatedAt instanceof firestore_1.Timestamp))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored timestamps are not server Timestamps");
    // First-slice immutable single-version-1 creation: metadata must be internally coherent.
    if (data.createdBy !== data.actor.id)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored createdBy does not match actor.id");
    if (data.updatedBy !== data.actor.id)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored updatedBy does not match actor.id");
    if (data.createdAt.toMillis() !== data.updatedAt.toMillis())
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored createdAt/updatedAt are not the same instant");
    if (typeof data.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(data.fingerprint))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored fingerprint invalid");
    const line = {
        lineId: l.lineId, partId: l.partId, trackingMode: storedMode,
        expectedQuantity: l.expectedQuantity, receivedQuantity: l.receivedQuantity, status: receivingTypes_js_1.RECEIVING_LINE_STATUS,
        ...(storedSerialNumbers === undefined ? {} : { serialNumbers: storedSerialNumbers }),
    };
    const value = {
        source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: source.reorderRequestId, purchaseOrderId: source.purchaseOrderId },
        receivingLocation: { type: location.type, locationId: location.locationId },
        status: "PUTAWAY_COMPLETE",
        version: receivingTypes_js_1.RECEIVING_INITIAL_VERSION,
        lines: [line],
        idempotencyKey: data.idempotencyKey,
    };
    return {
        receivingId: data.receivingId,
        value,
        actor: { kind: data.actor.kind, id: data.actor.id },
        createdAt: data.createdAt.toDate().getTime(),
        updatedAt: data.updatedAt.toDate().getTime(),
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
        schemaVersion: receivingTypes_js_1.RECEIVING_SCHEMA_VERSION,
        fingerprint: data.fingerprint,
    };
}
// Build a store from a live Firestore Transaction so the Receiving Order create composes inside a larger
// trusted transaction (Phase B). Constructing this performs no I/O.
function firestoreReceivingStore(txn, db) {
    const coll = db.collection(receivingTypes_js_1.RECEIVING_ORDERS_COLLECTION);
    return {
        async read(docId) {
            const snap = await txn.get(coll.doc(docId));
            return snap.exists ? (snap.data() ?? {}) : null;
        },
        create(docId, data) {
            txn.create(coll.doc(docId), data);
        },
    };
}
// Stage exactly one Receiving Order into the injected store, idempotently. Validates first (throws
// InvalidReceivingError on a bad request or actor -> nothing staged). On an existing idempotency doc it
// FULLY validates the stored record (deserialize + docId-derivation + recomputed-fingerprint coherence):
// same fingerprint -> replayed (no duplicate); different -> IdempotencyConflictError; malformed ->
// MalformedStoredRecordError. It never independently commits (staging is via the injected store) and does
// not mutate its inputs.
async function stageReceivingOrder(store, input, authority, deps) {
    const validated = (0, receivingValidation_js_1.validateReceivingOrderInput)(input, authority);
    if (!validated.valid)
        throw new receivingTypes_js_1.InvalidReceivingError(validated.reason);
    if (!isActor(deps.actor) || !(deps.now instanceof Date) || Number.isNaN(deps.now.getTime())) {
        throw new receivingTypes_js_1.InvalidReceivingError("stage_deps_invalid");
    }
    const value = validated.value;
    const docId = receivingOrderDocId(value.idempotencyKey);
    const fp = fingerprintReceivingOrder(value);
    const existing = await store.read(docId);
    if (existing !== null) {
        const stored = deserializeReceivingOrder(existing); // malformed -> MalformedStoredRecordError
        if (stored.receivingId !== docId) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingId does not match its document id");
        }
        if (receivingOrderDocId(stored.value.idempotencyKey) !== docId) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored idempotencyKey does not derive its document id");
        }
        const storedRecomputed = fingerprintReceivingOrder(stored.value);
        if (storedRecomputed !== stored.fingerprint) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored fingerprint does not match stored value");
        }
        if (storedRecomputed !== fp) {
            throw new receivingTypes_js_1.IdempotencyConflictError("idempotencyKey was already used for a different receiving order");
        }
        return { outcome: "replayed", receivingId: docId, fingerprint: fp };
    }
    store.create(docId, serializeReceivingOrder(value, deps.actor, deps.now, fp));
    return { outcome: "applied", receivingId: docId, fingerprint: fp };
}
//# sourceMappingURL=receivingRepository.js.map