"use strict";
// Enterprise Inventory -- EI-P1 INERT backend foundation: operational movement PERSISTENCE boundary
// for the SINGLE existing append-only ledger `inventory_transactions`. INERT: no callable, no client
// writer, not invoked by existing behavior. Provides serialize / fail-closed deserialize / legacy vs
// operational classification / deterministic idempotency, plus an injected idempotency-store seam so
// a future trusted writer can stage exactly one operational event INSIDE a larger transaction
// (workflow-object change + ledger append + projection update + Audit Event commit together or not at
// all). Authors NO on-hand/available/reserved/valuation math and never rewrites historical entries.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprintMovement = fingerprintMovement;
exports.operationalMovementDocId = operationalMovementDocId;
exports.serializeOperationalMovement = serializeOperationalMovement;
exports.classifyLedgerDoc = classifyLedgerDoc;
exports.deserializeOperationalMovement = deserializeOperationalMovement;
exports.firestoreLedgerStore = firestoreLedgerStore;
exports.stageOperationalMovement = stageOperationalMovement;
exports.decodeLedgerSnapshotValue = decodeLedgerSnapshotValue;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const collections_js_1 = require("../constants/collections.js");
const operationalMovementTypes_js_1 = require("./operationalMovementTypes.js");
const operationalMovementValidation_js_1 = require("./operationalMovementValidation.js");
const operatingCompanyAuthority_js_1 = require("../ownership/operatingCompanyAuthority.js");
// Deterministic, canonical JSON (sorted keys) so a fingerprint is stable regardless of key order.
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = value;
        return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
// 16-hex payload fingerprint (mirrors the truck-registry precedent): replay iff equal, conflict iff not.
function fingerprintMovement(value) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}
// Deterministic, PATH-SAFE storage identity derived from the caller idempotencyKey -- the raw caller
// string is NEVER used as a Firestore path. The deterministic doc IS the idempotency record.
function operationalMovementDocId(idempotencyKey) {
    return "imv_" + (0, node_crypto_1.createHash)("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}
// Serialize a validated value into the stored operational record. recordedAt is SERVER-AUTHORED from
// the injected trusted-writer clock (never accepted from input); occurredAt stays a plain millis
// number (business time). Serial/lot/counterparty are included only for their governing mode/type.
function serializeOperationalMovement(value, now, fingerprint) {
    const data = {
        schemaVersion: operationalMovementTypes_js_1.OPERATIONAL_LEDGER_SCHEMA_VERSION,
        type: value.type,
        direction: value.direction,
        partId: value.partId,
        trackingMode: value.trackingMode,
        location: { type: value.location.type, locationId: value.location.locationId },
        quantity: value.quantity,
        sourceObject: { type: value.sourceObject.type, id: value.sourceObject.id },
        idempotencyKey: value.idempotencyKey,
        actor: { kind: value.actor.kind, id: value.actor.id },
        occurredAt: value.occurredAt,
        recordedAt: firestore_1.Timestamp.fromDate(now),
        fingerprint,
    };
    if (value.serialNo !== undefined)
        data.serialNo = value.serialNo;
    if (value.lotId !== undefined)
        data.lotId = value.lotId;
    if (value.counterpartyLocation !== undefined) {
        data.counterpartyLocation = { type: value.counterpartyLocation.type, locationId: value.counterpartyLocation.locationId };
    }
    return data;
}
// Classify a stored ledger doc WITHOUT normalizing anything into validity. A legacy WO entry (no
// schemaVersion, legacy type) is never read as a location-aware operational event.
function classifyLedgerDoc(data) {
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(data))
        return "malformed";
    const type = data.type;
    if (data.schemaVersion === operationalMovementTypes_js_1.OPERATIONAL_LEDGER_SCHEMA_VERSION) {
        return typeof type === "string" && operationalMovementTypes_js_1.OPERATIONAL_MOVEMENT_TYPES.includes(type) ? "operational" : "malformed";
    }
    if (data.schemaVersion === undefined && typeof type === "string" && operationalMovementTypes_js_1.LEGACY_TRANSACTION_TYPES.includes(type)) {
        return "legacy";
    }
    return "malformed";
}
const STORED_BASE_KEYS = new Set([
    "schemaVersion", "type", "direction", "partId", "trackingMode", "location", "quantity",
    "sourceObject", "idempotencyKey", "actor", "occurredAt", "recordedAt", "fingerprint",
]);
// Fail-closed deserialize of a stored OPERATIONAL record. Validates self-consistency, converts the
// server Timestamp to millis (no Timestamp leaks into the value), and throws MalformedStoredRecordError
// on anything unexpected -- never normalizes malformed data into validity.
function deserializeOperationalMovement(data) {
    if (classifyLedgerDoc(data) !== "operational")
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored record is not a well-formed operational movement");
    const d = data;
    const type = d.type;
    const direction = operationalMovementTypes_js_1.MOVEMENT_DIRECTION[type];
    const isTransfer = operationalMovementTypes_js_1.COUNTERPARTY_MOVEMENT_TYPES.has(type); // transfer OR relocation pair
    const allowed = new Set(STORED_BASE_KEYS);
    if (!(0, operationalMovementValidation_js_1.isTrackingMode)(d.trackingMode))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored trackingMode invalid");
    const mode = d.trackingMode;
    if (mode === "SERIAL")
        allowed.add("serialNo");
    if (mode === "LOT")
        allowed.add("lotId");
    if (isTransfer)
        allowed.add("counterpartyLocation");
    // Ownership Model v1: `operatingCompanyId` is the governed owner field (ownershipMatrix.ts), written by the
    // Owner-authorized sandbox ownership backfill of 2026-08-30. Optional and SHAPE-checked; a reader that
    // rejected it made every backfilled record "malformed", and on-hand readers skip malformed rows.
    // Two shapes, exactly as ownershipBackfillRules.ts writes them: a scalar owner, or -- on a two-location
    // row whose ends resolve to different companies -- a participating PAIR. Never both.
    allowed.add("operatingCompanyId");
    if (isTransfer) {
        allowed.add("sourceOperatingCompanyId");
        allowed.add("destinationOperatingCompanyId");
    }
    if (Object.keys(d).some((k) => !allowed.has(k)))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored record has unknown field");
    assertStoredOwnership(d);
    if (d.direction !== direction)
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored direction inconsistent with type");
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(d.partId))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored partId invalid");
    const location = (0, operationalMovementValidation_js_1.validateLocationRef)(d.location);
    if (location === null)
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored location invalid");
    if (mode === "SERIAL" && !(0, operationalMovementValidation_js_1.isNonEmptyString)(d.serialNo))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored serialNo invalid");
    if (mode === "LOT" && !(0, operationalMovementValidation_js_1.isNonEmptyString)(d.lotId))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored lotId invalid");
    let counterparty = null;
    if (isTransfer) {
        counterparty = (0, operationalMovementValidation_js_1.validateLocationRef)(d.counterpartyLocation);
        if (counterparty === null)
            throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored counterparty invalid");
        if (counterparty.type === location.type && counterparty.locationId === location.locationId) {
            throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored transfer has same origin/destination");
        }
    }
    if ((0, operationalMovementValidation_js_1.validateQuantityReason)(mode, direction, d.quantity))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored quantity invalid");
    if ((0, operationalMovementValidation_js_1.validateSourceObjectReason)(d.sourceObject, operationalMovementTypes_js_1.MOVEMENT_SOURCE_TYPE[type]))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored sourceObject invalid");
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(d.idempotencyKey))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored idempotencyKey invalid");
    if ((0, operationalMovementValidation_js_1.validateActorReason)(d.actor))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored actor invalid");
    if (!(0, operationalMovementValidation_js_1.isEpochMillis)(d.occurredAt))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored occurredAt invalid");
    if (!(d.recordedAt instanceof firestore_1.Timestamp))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored recordedAt is not a server Timestamp");
    if (typeof d.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(d.fingerprint))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored fingerprint invalid");
    const source = d.sourceObject;
    const actor = d.actor;
    const value = {
        type,
        direction,
        partId: d.partId,
        trackingMode: mode,
        location,
        quantity: d.quantity,
        sourceObject: { type: source.type, id: source.id },
        idempotencyKey: d.idempotencyKey,
        actor: { kind: actor.kind, id: actor.id },
        occurredAt: d.occurredAt,
        ...(mode === "SERIAL" ? { serialNo: d.serialNo } : {}),
        ...(mode === "LOT" ? { lotId: d.lotId } : {}),
        ...(isTransfer && counterparty ? { counterpartyLocation: counterparty } : {}),
    };
    return { value, recordedAt: d.recordedAt.toDate().getTime(), schemaVersion: operationalMovementTypes_js_1.OPERATIONAL_LEDGER_SCHEMA_VERSION, fingerprint: d.fingerprint };
}
// Build a store from a live Firestore Transaction (so the append composes inside a larger trusted txn).
function firestoreLedgerStore(txn, db) {
    const coll = db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION);
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
// Stage exactly one operational movement into the injected store, idempotently. Validates first
// (throws InvalidMovementError on a bad envelope -> nothing staged); on an existing idempotency doc,
// same fingerprint -> replayed (no duplicate), different fingerprint -> IdempotencyConflictError;
// otherwise stages the create -> applied. Deterministic and non-mutating (inputs untouched).
async function stageOperationalMovement(store, event, part, deps) {
    const validated = (0, operationalMovementValidation_js_1.validateOperationalMovementEvent)(event, part);
    if (!validated.valid)
        throw new operationalMovementTypes_js_1.InvalidMovementError(validated.reason);
    const value = validated.value;
    const docId = operationalMovementDocId(value.idempotencyKey);
    const fp = fingerprintMovement(value);
    const existing = await store.read(docId);
    if (existing !== null) {
        // Fully validate the stored record before trusting it -- never rely on its raw fingerprint field.
        // A malformed / partial / schema-mismatched record throws MalformedStoredRecordError.
        const stored = deserializeOperationalMovement(existing);
        // Internal coherence: its own idempotencyKey must derive THIS document id...
        if (operationalMovementDocId(stored.value.idempotencyKey) !== docId) {
            throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored idempotencyKey does not derive its document id");
        }
        // ...and its stored fingerprint must equal the fingerprint recomputed from its deserialized value.
        const storedRecomputed = fingerprintMovement(stored.value);
        if (storedRecomputed !== stored.fingerprint) {
            throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored fingerprint does not match stored value");
        }
        // Replay only when the (coherent) stored value fingerprint equals the incoming validated value's.
        if (storedRecomputed !== fp) {
            throw new operationalMovementTypes_js_1.IdempotencyConflictError("idempotencyKey was already used for a different movement");
        }
        return { outcome: "replayed", docId, fingerprint: fp };
    }
    store.create(docId, serializeOperationalMovement(value, deps.now, fp));
    return { outcome: "applied", docId, fingerprint: fp };
}
/** Ownership Model v1 fields on a stored ledger row: shape-checked; pair both-or-neither; never scalar + pair. */
function assertStoredOwnership(d) {
    const scalar = d.operatingCompanyId, src = d.sourceOperatingCompanyId, dst = d.destinationOperatingCompanyId;
    if (scalar !== undefined && !(0, operatingCompanyAuthority_js_1.isOperatingCompanyIdShape)(scalar))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored operatingCompanyId invalid");
    if ((src === undefined) !== (dst === undefined))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored participating companies incomplete");
    if (src !== undefined && (!(0, operatingCompanyAuthority_js_1.isOperatingCompanyIdShape)(src) || !(0, operatingCompanyAuthority_js_1.isOperatingCompanyIdShape)(dst)))
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored participating companies invalid");
    if (scalar !== undefined && src !== undefined)
        throw new operationalMovementTypes_js_1.MalformedStoredRecordError("stored record carries both a scalar owner and a participating pair");
}
/**
 * Decode one row of an OFFLINE ledger snapshot (the exporter convention: a Firestore Timestamp is
 * `{ "$timestamp": { seconds, nanoseconds } }`) back into the shape a stored row has, so the SAME
 * classifier and strict deserializer judge a snapshot exactly as they judge live data. Pure: builds a
 * Timestamp value, opens no connection. Anything that only LOOKS like a tag (extra keys, non-integer
 * parts) is left as-is and therefore fails the strict reader -- it is never coerced into validity.
 */
function decodeLedgerSnapshotValue(value) {
    if (Array.isArray(value))
        return value.map(decodeLedgerSnapshotValue);
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(value))
        return value;
    const keys = Object.keys(value);
    const tag = value.$timestamp;
    if (keys.length === 1 && (0, operationalMovementValidation_js_1.isPlainObject)(tag) && Object.keys(tag).length === 2
        && Number.isInteger(tag.seconds) && Number.isInteger(tag.nanoseconds)
        && tag.nanoseconds >= 0 && tag.nanoseconds <= 999_999_999) {
        return new firestore_1.Timestamp(tag.seconds, tag.nanoseconds);
    }
    const out = {};
    for (const k of keys)
        out[k] = decodeLedgerSnapshotValue(value[k]);
    return out;
}
//# sourceMappingURL=operationalMovementRepository.js.map