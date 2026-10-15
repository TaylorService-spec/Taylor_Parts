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
exports.canonicalReceivingOrderDocId = canonicalReceivingOrderDocId;
exports.serializeReceivingOrder = serializeReceivingOrder;
exports.deserializeReceivingOrder = deserializeReceivingOrder;
exports.firestoreReceivingStore = firestoreReceivingStore;
exports.stageReceivingOrder = stageReceivingOrder;
exports.stageReceivingOrderValue = stageReceivingOrderValue;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const operationalMovementValidation_js_1 = require("../inventoryLedger/operationalMovementValidation.js");
const receivingTypes_js_1 = require("./receivingTypes.js");
const receivingValidation_js_1 = require("./receivingValidation.js");
const operatingCompanyAuthority_js_1 = require("../ownership/operatingCompanyAuthority.js");
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
// LEGACY receipt identity: deterministic and path-safe, derived from the caller idempotencyKey ALONE.
// The raw caller string is never a Firestore path; the deterministic doc IS the idempotency record.
//
// PRESERVED EXACTLY, and deliberately not "fixed". Deployed callers already hold receipts at these
// ids, and changing the derivation would orphan every one of them -- a genuine retry would hash to a
// new id, find nothing, and RE-APPLY. Its narrowness is contained instead: legacy receipts are
// full-quantity, one-shot, and additionally serialized by the reorder_requests transition, so a key
// reused across two legacy POs is caught by that transition rather than silently replayed.
function receivingOrderDocId(idempotencyKey) {
    return "rcv_" + (0, node_crypto_1.createHash)("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}
function canonicalReceivingOrderDocId(ns) {
    return "rcvc_" + (0, node_crypto_1.createHash)("sha256").update(canonicalJson(ns)).digest("hex").slice(0, 40);
}
// Serialize a validated value into the stored order. actor + createdAt/updatedAt/createdBy/updatedBy are
// SERVER-AUTHORED from the trusted caller's actor and clock (never accepted from untrusted input).
function serializeReceivingOrder(value, actor, now, fingerprint, 
// The receipt's identity, SUPPLIED rather than re-derived here. It used to be recomputed from the
// idempotency key, which silently hard-coded the legacy namespace into every stored record and made
// a target-scoped canonical id impossible to store. The caller owns which namespace applies; this
// function only records it. Defaulted to the legacy derivation so existing callers are unchanged.
receivingId = receivingOrderDocId(value.idempotencyKey)) {
    return {
        schemaVersion: receivingTypes_js_1.RECEIVING_SCHEMA_VERSION,
        receivingId, // stored identity == doc path; server-derived, never from input
        // reorderRequestId is written ONLY when the source actually has one. Spreading it
        // unconditionally would send `undefined` to Firestore for a canonical PO -- which the Admin SDK
        // rejects outright, and which would be a claim of a reorder-request link that does not exist.
        source: {
            type: value.source.type,
            ...(value.source.reorderRequestId === undefined ? {} : { reorderRequestId: value.source.reorderRequestId }),
            purchaseOrderId: value.source.purchaseOrderId,
        },
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
    "actor", "createdAt", "createdBy", "updatedAt", "updatedBy", "fingerprint", "receivingOrderNumber",
    // Ownership Model v1: `operatingCompanyId` is the governed owner field (ownershipMatrix.ts), written by the
    // Owner-authorized sandbox ownership backfill of 2026-08-30. Optional and SHAPE-checked; a reader that
    // rejected it made every backfilled record "malformed", and on-hand readers skip malformed rows.
    "operatingCompanyId",
]);
// Both namespaces. `rcvc_` (canonical, target-scoped) and `rcv_` (legacy, key-scoped) share this
// one collection and are provably disjoint by prefix -- a canonical id can never equal a legacy one.
const RECEIVING_ID_RE = /^rcvc?_[0-9a-f]{40}$/;
// RO-YYYY-###### — six-digit zero-padded sequence, but not truncated once the sequence outgrows six
// digits (see receivingOrderNumbering.ts's formatReceivingOrderNumber), so this stays a floor, not a cap.
const RECEIVING_ORDER_NUMBER_RE = /^RO-[0-9]{4}-[0-9]{6,}$/;
const STORED_LINE_KEYS = new Set(["lineId", "partId", "trackingMode", "expectedQuantity", "receivedQuantity", "status", "serialNumbers"]);
// Fail-closed deserialize of a stored receiving_orders record. Validates self-consistency
// (PUTAWAY_COMPLETE / version 1 / one or more lines with unique ids / received <= expected), converts
// server Timestamps to millis (no Timestamp leaks into the value), and throws
// MalformedStoredRecordError on anything unexpected -- never normalizes malformed data into validity.
//
// Phase C widened two of these deliberately. `lines` was pinned at exactly one, which no multi-line
// receipt could satisfy; and quantities required expected === received, which made every PARTIAL
// receipt unreadable. Both were correct descriptions of the single-full-receipt slice and neither
// described a safety property: what actually protects the record is received <= expected plus unique
// line ids, and both are enforced above.
function deserializeReceivingOrder(data) {
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(data))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receiving order is not an object");
    if (data.schemaVersion !== receivingTypes_js_1.RECEIVING_SCHEMA_VERSION)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored schemaVersion invalid");
    if (Object.keys(data).some((k) => !STORED_KEYS.has(k)))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored record has unknown field");
    if (data.operatingCompanyId !== undefined && !(0, operatingCompanyAuthority_js_1.isOperatingCompanyIdShape)(data.operatingCompanyId))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored operatingCompanyId invalid");
    if (data.status !== "PUTAWAY_COMPLETE")
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored status invalid for first-slice order");
    if (data.version !== receivingTypes_js_1.RECEIVING_INITIAL_VERSION)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored version invalid for first-slice order");
    // SOURCE, validated PER AUTHORITY rather than by one rule that only ever described the legacy one.
    //
    // Legacy keeps its exact original invariant: reorderRequestId present AND equal to purchaseOrderId.
    // Canonical must NOT carry a reorderRequestId at all -- it has no reorder request, and a stored
    // record claiming one would be describing a link that does not exist. Each shape is rejected in the
    // other's slot, so a stored record can never be ambiguous about which authority produced it.
    const source = data.source;
    if (!(0, operationalMovementValidation_js_1.isPlainObject)(source) || typeof source.type !== "string" ||
        !receivingTypes_js_1.RECEIVING_SOURCE_TYPES.includes(source.type) ||
        !(0, operationalMovementValidation_js_1.isNonEmptyString)(source.purchaseOrderId)) {
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored source invalid");
    }
    if (source.type === receivingTypes_js_1.LEGACY_SOURCE_TYPE) {
        if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(source.reorderRequestId) || source.purchaseOrderId !== source.reorderRequestId) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored legacy source invalid");
        }
    }
    else if (source.reorderRequestId !== undefined) {
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored canonical source must not carry a reorderRequestId");
    }
    const location = (0, operationalMovementValidation_js_1.validateLocationRef)(data.receivingLocation);
    if (location === null)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingLocation invalid");
    // LINES -- one or more. The first slice pinned this at exactly one; Phase C receives a batch, so the
    // same per-line rules are applied to EVERY line rather than to `lines[0]`.
    //
    // Two invariants are enforced here that the single-line version got for free:
    //   - at least one line (an empty receipt is not a receipt);
    //   - line ids UNIQUE within the record. A receipt addressing the same PO line twice makes the
    //     quantity it recorded ambiguous, and this value is what replay coherence is fingerprinted
    //     against -- an ambiguous stored record could never be re-derived identically.
    if (!Array.isArray(data.lines) || data.lines.length === 0)
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored lines invalid");
    const seenLineIds = new Set();
    const storedLines = data.lines.map((raw) => {
        const l = raw;
        if (!(0, operationalMovementValidation_js_1.isPlainObject)(l) || Object.keys(l).some((k) => !STORED_LINE_KEYS.has(k)))
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored line shape invalid");
        if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(l.lineId) || !(0, operationalMovementValidation_js_1.isNonEmptyString)(l.partId))
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored line identity invalid");
        if (seenLineIds.has(l.lineId))
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored lines contain a duplicate lineId");
        seenLineIds.add(l.lineId);
        if (!receivingTypes_js_1.RECEIVING_SUPPORTED_TRACKING_MODES.includes(l.trackingMode) || l.status !== receivingTypes_js_1.RECEIVING_LINE_STATUS) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored line mode/status invalid");
        }
        const storedMode = l.trackingMode;
        // PARTIAL RECEIPT IS VALID STORED DATA. This previously required expected === received, which
        // made every partial receipt unreadable. What is still rejected is received > expected -- a
        // stored over-receipt, which the write path refuses and which therefore cannot legitimately
        // exist.
        if (!isPositiveFiniteNumber(l.expectedQuantity) || !isPositiveFiniteNumber(l.receivedQuantity)) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored line quantity invalid");
        }
        if (l.receivedQuantity > l.expectedQuantity) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored line received exceeds expected");
        }
        // Serial identity, re-validated on the way OUT with the same rules applied on the way in. A
        // stored record that lost, gained, duplicated or mis-counted its serials is malformed -- never
        // normalized into validity, because this value is what replay coherence is fingerprinted against.
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
        return {
            lineId: l.lineId,
            partId: l.partId,
            trackingMode: storedMode,
            expectedQuantity: l.expectedQuantity,
            receivedQuantity: l.receivedQuantity,
            status: receivingTypes_js_1.RECEIVING_LINE_STATUS,
            ...(storedSerialNumbers === undefined ? {} : { serialNumbers: storedSerialNumbers }),
        };
    });
    if (!(0, operationalMovementValidation_js_1.isNonEmptyString)(data.idempotencyKey))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored idempotencyKey invalid");
    // Stored identity must be a path-safe receivingId in one of the two namespaces.
    if (typeof data.receivingId !== "string" || !RECEIVING_ID_RE.test(data.receivingId))
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingId invalid");
    // AGREEMENT IS CHECKED PER NAMESPACE. A legacy id is derived from the idempotency key alone, so it
    // can be -- and is -- re-derived here. A CANONICAL id is target-scoped: it also hashes the
    // operation, authority, purchase order and actor, none of which the stored record carries in a form
    // this pure deserializer could recompute from. Re-deriving the legacy way would fail every
    // canonical record; what guarantees canonical identity instead is the caller's own
    // receivingId-equals-docId check plus the structurally disjoint prefix.
    if (data.receivingId.startsWith("rcv_") && data.receivingId !== receivingOrderDocId(data.idempotencyKey)) {
        throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingId does not agree with its idempotencyKey");
    }
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
    // Absent on legacy records created before this field existed -- never backfilled here, never derived
    // from anything else (not this doc's own id, not a Work Order/Transfer Order number). When present it
    // must match the RO-YYYY-###### shape; a malformed value is never normalized into validity.
    let receivingOrderNumber;
    if (data.receivingOrderNumber !== undefined) {
        if (typeof data.receivingOrderNumber !== "string" || !RECEIVING_ORDER_NUMBER_RE.test(data.receivingOrderNumber)) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingOrderNumber invalid");
        }
        receivingOrderNumber = data.receivingOrderNumber;
    }
    const value = {
        source: {
            type: source.type,
            // Carried only when the stored record actually has it, so a canonical receipt round-trips
            // without acquiring a reorder-request link it never had.
            ...(source.reorderRequestId === undefined ? {} : { reorderRequestId: source.reorderRequestId }),
            purchaseOrderId: source.purchaseOrderId,
        },
        receivingLocation: { type: location.type, locationId: location.locationId },
        status: "PUTAWAY_COMPLETE",
        version: receivingTypes_js_1.RECEIVING_INITIAL_VERSION,
        lines: storedLines,
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
        ...(receivingOrderNumber === undefined ? {} : { receivingOrderNumber }),
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
    const value = validated.value;
    // The LEGACY namespace, preserved exactly: deployed callers already hold receipts at these ids.
    return stageReceivingOrderValue(store, value, receivingOrderDocId(value.idempotencyKey), deps);
}
/**
 * THE ONE RECEIVING CORE (§9: "both transports must converge on one receiving core").
 *
 * Takes an ALREADY-VALIDATED value and the receipt identity its namespace decided. Legacy calls it
 * through `stageReceivingOrder` above with a key-scoped id; canonical calls it directly with a
 * target-scoped one. There is exactly one implementation of replay, conflict and staging, so the two
 * transports cannot drift into disagreeing about what a replay is.
 *
 * On an existing idempotency document it FULLY validates the stored record — deserialize, identity
 * coherence, recomputed-fingerprint coherence — then: same fingerprint → replayed (no duplicate);
 * different → IdempotencyConflictError; malformed → MalformedStoredRecordError. It never independently
 * commits (staging is via the injected store) and does not mutate its inputs.
 */
async function stageReceivingOrderValue(store, value, docId, deps) {
    if (!isActor(deps.actor) || !(deps.now instanceof Date) || Number.isNaN(deps.now.getTime())) {
        throw new receivingTypes_js_1.InvalidReceivingError("stage_deps_invalid");
    }
    if (!RECEIVING_ID_RE.test(docId))
        throw new receivingTypes_js_1.InvalidReceivingError("receiving_id_invalid");
    const fp = fingerprintReceivingOrder(value);
    const existing = await store.read(docId);
    if (existing !== null) {
        const stored = deserializeReceivingOrder(existing); // malformed -> MalformedStoredRecordError
        if (stored.receivingId !== docId) {
            throw new receivingTypes_js_1.MalformedStoredRecordError("stored receivingId does not match its document id");
        }
        // IDENTITY COHERENCE, per namespace. The legacy check re-derived the id from the stored
        // idempotency key; a canonical id cannot be re-derived from the key alone (that is the entire
        // point of scoping it to the target), so the equivalent guarantee there is the prefix plus the
        // receivingId/docId agreement above. Re-deriving a legacy id from a canonical record — or the
        // reverse — is exactly the silent reinterpretation §4 forbids, so neither is attempted.
        if (docId.startsWith("rcv_") && receivingOrderDocId(stored.value.idempotencyKey) !== docId) {
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
    store.create(docId, serializeReceivingOrder(value, deps.actor, deps.now, fp, docId));
    return { outcome: "applied", receivingId: docId, fingerprint: fp };
}
//# sourceMappingURL=receivingRepository.js.map