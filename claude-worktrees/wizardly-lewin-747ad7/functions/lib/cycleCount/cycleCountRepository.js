"use strict";
// Enterprise Inventory -- Cycle Count operating authority: `cycle_counts` PERSISTENCE boundary
// (serialize / fail-closed deserialize / deterministic identity + fingerprint). Mirrors
// transferOrderRepository.ts exactly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprintCycleCount = fingerprintCycleCount;
exports.toIdentity = toIdentity;
exports.cycleCountDocId = cycleCountDocId;
exports.serializeCycleCount = serializeCycleCount;
exports.submitFields = submitFields;
exports.reconcileFields = reconcileFields;
exports.cancelFields = cancelFields;
exports.deserializeCycleCount = deserializeCycleCount;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
const cycleCountValidation_js_1 = require("./cycleCountValidation.js");
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = value;
        return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
// 16-hex fingerprint over the request-derived IDENTITY only (never the server-computed expected
// snapshot): replay iff equal, conflict iff not.
function fingerprintCycleCount(identity) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalJson(identity)).digest("hex").slice(0, 16);
}
// Extracts exactly the 4 identity fields from a full stored value -- NEVER pass a CycleCountValue
// directly to fingerprintCycleCount (its extra expectedQuantity/expectedSerialNumbers keys would change
// the hash and defeat the point of freezing the snapshot out of replay detection).
function toIdentity(value) {
    return { partId: value.partId, trackingMode: value.trackingMode, location: value.location, idempotencyKey: value.idempotencyKey };
}
// Deterministic, PATH-SAFE cycle count identity from the caller idempotencyKey.
function cycleCountDocId(idempotencyKey) {
    return "cyc_" + (0, node_crypto_1.createHash)("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}
function isActor(a) {
    return (0, cycleCountValidation_js_1.isPlainObject)(a) && (a.kind === "USER" || a.kind === "SYSTEM") && (0, cycleCountValidation_js_1.isNonEmptyString)(a.id);
}
// Serialize a validated CREATE value (with its server-computed expected snapshot already attached) into
// the stored OPEN/version-1 record.
function serializeCycleCount(value, actor, now, fingerprint) {
    return {
        schemaVersion: cycleCountTypes_js_1.CYCLE_COUNT_SCHEMA_VERSION,
        partId: value.partId,
        trackingMode: value.trackingMode,
        location: { type: value.location.type, locationId: value.location.locationId },
        expectedQuantity: value.expectedQuantity,
        ...(value.expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: [...value.expectedSerialNumbers] }),
        status: "OPEN",
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
// Build the fields for the submitCycleCount transition (OPEN -> COUNTED): records counted values +
// computed variance evidence. Never touches the create-time snapshot fields. `submittedBy` is written
// independently of `updatedBy` -- the separation-of-duties guard in reconcileCycleCount needs to know
// who submitted THIS count even after a later reconcile/reject call overwrites `updatedBy`.
function submitFields(nextVersion, actor, now, countedQuantity, countedSerialNumbers, variance, serialVariance) {
    return {
        status: "COUNTED",
        version: nextVersion,
        updatedAt: firestore_1.Timestamp.fromDate(now),
        updatedBy: actor.id,
        submittedBy: actor.id,
        ...(countedQuantity === undefined ? {} : { countedQuantity }),
        ...(countedSerialNumbers === undefined ? {} : { countedSerialNumbers: [...countedSerialNumbers] }),
        ...(variance === undefined ? {} : { variance }),
        ...(serialVariance === undefined ? {} : { serialVariance: { missing: [...serialVariance.missing], unexpected: [...serialVariance.unexpected] } }),
    };
}
// Build the fields for the reconcileCycleCount transition (COUNTED -> RECONCILED, `decision` APPROVE)
// or (COUNTED -> REJECTED, `decision` REJECT). Both are a manager's terminal disposition of a submitted
// count, sharing the same "reviewed at/by" bookkeeping -- only the resulting status/ledgerEventIds
// differ (REJECT always carries an empty ledgerEventIds; reconcileCycleCount enforces that it never
// stages ledger writes on the reject path).
function reconcileFields(nextVersion, actor, now, reason, ledgerEventIds, decision) {
    return {
        status: (decision === "REJECT" ? "REJECTED" : "RECONCILED"),
        version: nextVersion,
        updatedAt: firestore_1.Timestamp.fromDate(now),
        updatedBy: actor.id,
        reviewDecision: decision,
        ...(reason === null ? {} : { reconciliationReason: reason }),
        reconciledAt: firestore_1.Timestamp.fromDate(now),
        reconciledBy: actor.id,
        ledgerEventIds: [...ledgerEventIds],
    };
}
function cancelFields(nextVersion, actor, now) {
    return { status: "CANCELLED", version: nextVersion, updatedAt: firestore_1.Timestamp.fromDate(now), updatedBy: actor.id };
}
const STORED_KEYS = new Set([
    "schemaVersion", "partId", "trackingMode", "location", "expectedQuantity", "expectedSerialNumbers",
    "status", "version", "idempotencyKey", "actor", "createdAt", "createdBy", "updatedAt", "updatedBy",
    "fingerprint", "countedQuantity", "countedSerialNumbers", "variance", "serialVariance", "submittedBy",
    "reviewDecision", "reconciliationReason", "reconciledAt", "reconciledBy", "ledgerEventIds",
]);
// Fail-closed deserialize of a stored cycle_counts record. Never normalizes malformed data into
// validity -- throws CycleCountMalformedStoredRecordError on anything unexpected.
function deserializeCycleCount(docId, data) {
    if (!(0, cycleCountValidation_js_1.isPlainObject)(data))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored cycle count is not an object");
    if (data.schemaVersion !== cycleCountTypes_js_1.CYCLE_COUNT_SCHEMA_VERSION)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored schemaVersion invalid");
    if (Object.keys(data).some((k) => !STORED_KEYS.has(k)))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored record has unknown field");
    if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.partId))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored partId invalid");
    if (typeof data.trackingMode !== "string" || !cycleCountTypes_js_1.CYCLE_COUNT_SUPPORTED_TRACKING_MODES.includes(data.trackingMode)) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored trackingMode invalid");
    }
    const trackingMode = data.trackingMode;
    const location = (0, cycleCountValidation_js_1.validateCycleCountLocationRef)(data.location);
    if (location === null)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored location invalid");
    if (typeof data.expectedQuantity !== "number" || !Number.isInteger(data.expectedQuantity) || data.expectedQuantity < 0) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored expectedQuantity invalid");
    }
    let expectedSerialNumbers;
    if (trackingMode === "SERIAL") {
        if (!Array.isArray(data.expectedSerialNumbers))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored SERIAL count has no expectedSerialNumbers");
        const serials = data.expectedSerialNumbers;
        if (!serials.every((s) => (0, cycleCountValidation_js_1.isNonEmptyString)(s)))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored expectedSerialNumbers invalid");
        if (new Set(serials).size !== serials.length)
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored expectedSerialNumbers contain duplicates");
        if (serials.length !== data.expectedQuantity)
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored expectedSerialNumbers count does not match expectedQuantity");
        expectedSerialNumbers = [...serials];
    }
    else if (data.expectedSerialNumbers !== undefined) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored NONE count must not carry expectedSerialNumbers");
    }
    if (typeof data.status !== "string" || !cycleCountTypes_js_1.CYCLE_COUNT_STATUSES.includes(data.status)) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored status invalid");
    }
    if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < 1) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored version invalid");
    }
    if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.idempotencyKey))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored idempotencyKey invalid");
    if (!isActor(data.actor))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored actor invalid");
    if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.createdBy) || !(0, cycleCountValidation_js_1.isNonEmptyString)(data.updatedBy))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored createdBy/updatedBy invalid");
    if (!(data.createdAt instanceof firestore_1.Timestamp) || !(data.updatedAt instanceof firestore_1.Timestamp))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored timestamps are not server Timestamps");
    if (typeof data.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(data.fingerprint))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored fingerprint invalid");
    const value = {
        partId: data.partId,
        trackingMode,
        location,
        expectedQuantity: data.expectedQuantity,
        ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }),
        idempotencyKey: data.idempotencyKey,
    };
    let countedQuantity;
    if (data.countedQuantity !== undefined) {
        if (typeof data.countedQuantity !== "number" || !Number.isInteger(data.countedQuantity) || data.countedQuantity < 0) {
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored countedQuantity invalid");
        }
        countedQuantity = data.countedQuantity;
    }
    let countedSerialNumbers;
    if (data.countedSerialNumbers !== undefined) {
        if (!Array.isArray(data.countedSerialNumbers) || !data.countedSerialNumbers.every((s) => (0, cycleCountValidation_js_1.isNonEmptyString)(s))) {
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored countedSerialNumbers invalid");
        }
        countedSerialNumbers = [...data.countedSerialNumbers];
    }
    let variance;
    if (data.variance !== undefined) {
        if (typeof data.variance !== "number" || !Number.isInteger(data.variance))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored variance invalid");
        variance = data.variance;
    }
    let serialVariance;
    if (data.serialVariance !== undefined) {
        const sv = data.serialVariance;
        if (!(0, cycleCountValidation_js_1.isPlainObject)(sv) || !Array.isArray(sv.missing) || !Array.isArray(sv.unexpected)) {
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored serialVariance invalid");
        }
        if (!sv.missing.every((s) => (0, cycleCountValidation_js_1.isNonEmptyString)(s)) || !sv.unexpected.every((s) => (0, cycleCountValidation_js_1.isNonEmptyString)(s))) {
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored serialVariance invalid");
        }
        serialVariance = { missing: [...sv.missing], unexpected: [...sv.unexpected] };
    }
    let submittedBy;
    if (data.submittedBy !== undefined) {
        if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.submittedBy))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored submittedBy invalid");
        submittedBy = data.submittedBy;
    }
    let reviewDecision;
    if (data.reviewDecision !== undefined) {
        if (typeof data.reviewDecision !== "string" || !cycleCountTypes_js_1.CYCLE_COUNT_REVIEW_DECISIONS.includes(data.reviewDecision)) {
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored reviewDecision invalid");
        }
        reviewDecision = data.reviewDecision;
    }
    let reconciliationReason;
    if (data.reconciliationReason !== undefined) {
        if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.reconciliationReason))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored reconciliationReason invalid");
        reconciliationReason = data.reconciliationReason;
    }
    let reconciledAt;
    let reconciledBy;
    if (data.reconciledAt !== undefined || data.reconciledBy !== undefined) {
        if (!(data.reconciledAt instanceof firestore_1.Timestamp) || !(0, cycleCountValidation_js_1.isNonEmptyString)(data.reconciledBy)) {
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored reconciledAt/reconciledBy invalid");
        }
        reconciledAt = data.reconciledAt.toDate().getTime();
        reconciledBy = data.reconciledBy;
    }
    let ledgerEventIds;
    if (data.ledgerEventIds !== undefined) {
        if (!Array.isArray(data.ledgerEventIds) || !data.ledgerEventIds.every((s) => (0, cycleCountValidation_js_1.isNonEmptyString)(s))) {
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored ledgerEventIds invalid");
        }
        ledgerEventIds = [...data.ledgerEventIds];
    }
    return {
        cycleCountId: docId,
        value,
        status: data.status,
        version: data.version,
        actor: { kind: data.actor.kind, id: data.actor.id },
        createdAt: data.createdAt.toDate().getTime(),
        updatedAt: data.updatedAt.toDate().getTime(),
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
        schemaVersion: cycleCountTypes_js_1.CYCLE_COUNT_SCHEMA_VERSION,
        fingerprint: data.fingerprint,
        ...(countedQuantity === undefined ? {} : { countedQuantity }),
        ...(countedSerialNumbers === undefined ? {} : { countedSerialNumbers }),
        ...(variance === undefined ? {} : { variance }),
        ...(serialVariance === undefined ? {} : { serialVariance }),
        ...(submittedBy === undefined ? {} : { submittedBy }),
        ...(reviewDecision === undefined ? {} : { reviewDecision }),
        ...(reconciliationReason === undefined ? {} : { reconciliationReason }),
        ...(reconciledAt === undefined ? {} : { reconciledAt }),
        ...(reconciledBy === undefined ? {} : { reconciledBy }),
        ...(ledgerEventIds === undefined ? {} : { ledgerEventIds }),
    };
}
//# sourceMappingURL=cycleCountRepository.js.map