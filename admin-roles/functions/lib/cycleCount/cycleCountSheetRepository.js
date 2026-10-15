"use strict";
// Cycle Count A1 -- the SHEET / LINE stored shape (schema v2), per the Owner-approved A1 Revision 2
// (docs/specifications/cycle-count-multi-part-sheet.md, Decision #179).
//
//   cycle_counts/{sheetId}                 schemaVersion 2 -- location, lifecycle, identity, audit
//   cycle_counts/{sheetId}/lines/{lineId}  schemaVersion 1 -- one per Part: expected snapshot, count,
//                                          variance, disposition, ledger evidence
//
// STRICT VERSION BOUNDARY (M-1). v1 records stay in the same collection as inert history. A sheet id is
// "ccs_" + sha256(idempotencyKey), never v1's "cyc_" derivation, so a v2 sheet can never land on a v1
// document; every reader here refuses anything that is not exactly schema v2 / line v1. There is no v1
// reader in this module and none may be added (no dual reader, no v1 -> v2 interpretation).
//
// Fail-closed deserialize: unknown fields, missing invariants or a wrong schema are
// CycleCountMalformedStoredRecordError -- never "normalized" into validity, never UNKNOWN turned into 0.
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNonEmptyString = exports.isPlainObject = exports.lineCancelFields = exports.lineDecisionFields = exports.lineSubmitFields = exports.sheetStatusFields = exports.fingerprintLine = exports.fingerprintSheet = exports.cycleCountLineId = exports.cycleCountSheetId = exports.LINE_STATUSES = exports.SHEET_STATUSES = exports.CYCLE_COUNT_LINES_SUBCOLLECTION = exports.CYCLE_COUNT_LINE_SCHEMA_VERSION = exports.CYCLE_COUNT_SHEET_SCHEMA_VERSION = void 0;
exports.serializeNewSheet = serializeNewSheet;
exports.deserializeSheet = deserializeSheet;
exports.serializeNewLine = serializeNewLine;
exports.deserializeLine = deserializeLine;
const firestore_1 = require("firebase-admin/firestore");
const node_crypto_1 = require("node:crypto");
const operatingCompanyAuthority_js_1 = require("../ownership/operatingCompanyAuthority.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
const cycleCountValidation_js_1 = require("./cycleCountValidation.js");
Object.defineProperty(exports, "isPlainObject", { enumerable: true, get: function () { return cycleCountValidation_js_1.isPlainObject; } });
Object.defineProperty(exports, "isNonEmptyString", { enumerable: true, get: function () { return cycleCountValidation_js_1.isNonEmptyString; } });
exports.CYCLE_COUNT_SHEET_SCHEMA_VERSION = 2;
exports.CYCLE_COUNT_LINE_SCHEMA_VERSION = 1;
exports.CYCLE_COUNT_LINES_SUBCOLLECTION = "lines";
exports.SHEET_STATUSES = ["OPEN", "CLOSED", "CANCELLED"];
exports.LINE_STATUSES = ["OPEN", "COUNTED", "RECONCILED", "REJECTED", "CANCELLED"];
const hash = (v) => (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(v)).digest("hex");
const cycleCountSheetId = (idempotencyKey) => "ccs_" + hash(["cycle-count-sheet", idempotencyKey]).slice(0, 40);
exports.cycleCountSheetId = cycleCountSheetId;
/** One Part, one addressable line per sheet: the path IS the one-part-one-line rule (D5). */
const cycleCountLineId = (partId) => "ccl_" + hash(["cycle-count-line", partId]).slice(0, 40);
exports.cycleCountLineId = cycleCountLineId;
/** Request-derived identity ONLY -- server-computed values never participate (replay must not turn into conflict). */
const fingerprintSheet = (location, idempotencyKey) => hash({ location: { type: location.type, locationId: location.locationId }, idempotencyKey }).slice(0, 16);
exports.fingerprintSheet = fingerprintSheet;
const fingerprintLine = (partId, trackingMode) => hash({ partId, trackingMode }).slice(0, 16);
exports.fingerprintLine = fingerprintLine;
const ts = (ms) => firestore_1.Timestamp.fromMillis(ms);
function millis(v, field) {
    if (!(v instanceof firestore_1.Timestamp))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError(`stored ${field} invalid`);
    return v.toMillis();
}
function optionalMillis(v, field) {
    return v === undefined ? undefined : millis(v, field);
}
function sortedUniqueSerials(v, field) {
    if (!Array.isArray(v) || !v.every((s) => (0, cycleCountValidation_js_1.isNonEmptyString)(s)))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError(`stored ${field} invalid`);
    const out = [...v];
    if (new Set(out).size !== out.length)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError(`stored ${field} duplicate`);
    return out;
}
// ------------------------------------------------------------------ sheet
function serializeNewSheet(sheetId, location, idempotencyKey, actor, now, operatingCompanyId) {
    return {
        schemaVersion: exports.CYCLE_COUNT_SHEET_SCHEMA_VERSION,
        location: { type: location.type, locationId: location.locationId },
        status: "OPEN",
        version: 1,
        idempotencyKey,
        actor: { kind: actor.kind, id: actor.id },
        createdAt: ts(now.getTime()), createdBy: actor.id,
        updatedAt: ts(now.getTime()), updatedBy: actor.id,
        fingerprint: (0, exports.fingerprintSheet)(location, idempotencyKey),
        ...(operatingCompanyId ? { operatingCompanyId } : {}),
    };
}
const SHEET_KEYS = new Set([
    "schemaVersion", "location", "status", "version", "idempotencyKey", "actor", "createdAt", "createdBy",
    "updatedAt", "updatedBy", "fingerprint", "operatingCompanyId", "closedAt", "closedBy",
]);
function deserializeSheet(sheetId, data) {
    if (!(0, cycleCountValidation_js_1.isPlainObject)(data))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored sheet is not an object");
    if (data.schemaVersion !== exports.CYCLE_COUNT_SHEET_SCHEMA_VERSION)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored record is not a schema v2 sheet");
    if (Object.keys(data).some((k) => !SHEET_KEYS.has(k)))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored sheet has unknown field");
    const location = (0, cycleCountValidation_js_1.validateCycleCountLocationRef)(data.location);
    if (location === null)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored location invalid");
    if (!exports.SHEET_STATUSES.includes(data.status))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored status invalid");
    if (!Number.isInteger(data.version) || data.version < 1)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored version invalid");
    if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.idempotencyKey) || (0, exports.cycleCountSheetId)(data.idempotencyKey) !== sheetId)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored idempotencyKey does not derive the sheet id");
    const actor = data.actor;
    if (!(0, cycleCountValidation_js_1.isPlainObject)(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !(0, cycleCountValidation_js_1.isNonEmptyString)(actor.id))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored actor invalid");
    if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.createdBy) || !(0, cycleCountValidation_js_1.isNonEmptyString)(data.updatedBy))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored audit fields invalid");
    if (data.fingerprint !== (0, exports.fingerprintSheet)(location, data.idempotencyKey))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored sheet fingerprint mismatch");
    if (data.operatingCompanyId !== undefined && !(0, operatingCompanyAuthority_js_1.isOperatingCompanyIdShape)(data.operatingCompanyId))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored operatingCompanyId invalid");
    const closed = data.status === "CLOSED";
    if (closed !== (data.closedAt !== undefined) || closed !== (data.closedBy !== undefined))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored close fields inconsistent with status");
    return {
        sheetId,
        location,
        status: data.status,
        version: data.version,
        idempotencyKey: data.idempotencyKey,
        actor: { kind: actor.kind, id: actor.id },
        createdAt: millis(data.createdAt, "createdAt"),
        createdBy: data.createdBy,
        updatedAt: millis(data.updatedAt, "updatedAt"),
        updatedBy: data.updatedBy,
        fingerprint: data.fingerprint,
        ...(data.operatingCompanyId !== undefined ? { operatingCompanyId: data.operatingCompanyId } : {}),
        ...(closed ? { closedAt: millis(data.closedAt, "closedAt"), closedBy: data.closedBy } : {}),
    };
}
const sheetStatusFields = (status, nextVersion, actor, now) => ({
    status, version: nextVersion, updatedAt: ts(now.getTime()), updatedBy: actor.id,
    ...(status === "CLOSED" ? { closedAt: ts(now.getTime()), closedBy: actor.id } : {}),
});
exports.sheetStatusFields = sheetStatusFields;
// ------------------------------------------------------------------ line
function serializeNewLine(partId, trackingMode, expectedQuantity, expectedSerialNumbers, actor, now) {
    return {
        schemaVersion: exports.CYCLE_COUNT_LINE_SCHEMA_VERSION,
        partId, trackingMode, expectedQuantity,
        ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: [...expectedSerialNumbers] }),
        expectedSnapshotAt: ts(now.getTime()),
        status: "OPEN", version: 1,
        fingerprint: (0, exports.fingerprintLine)(partId, trackingMode),
        openedBy: actor.id, openedAt: ts(now.getTime()),
        updatedAt: ts(now.getTime()), updatedBy: actor.id,
    };
}
const LINE_KEYS = new Set([
    "schemaVersion", "partId", "trackingMode", "expectedQuantity", "expectedSerialNumbers", "expectedSnapshotAt",
    "status", "version", "fingerprint", "openedBy", "openedAt", "updatedAt", "updatedBy",
    "countedQuantity", "countedSerialNumbers", "variance", "serialVariance", "submittedBy", "submittedAt",
    "reviewDecision", "reconciliationReason", "reconciledAt", "reconciledBy", "ledgerEventIds",
]);
function deserializeLine(sheetId, lineId, data) {
    if (!(0, cycleCountValidation_js_1.isPlainObject)(data))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored line is not an object");
    if (data.schemaVersion !== exports.CYCLE_COUNT_LINE_SCHEMA_VERSION)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored line schemaVersion invalid");
    if (Object.keys(data).some((k) => !LINE_KEYS.has(k)))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored line has unknown field");
    if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.partId) || (0, exports.cycleCountLineId)(data.partId) !== lineId)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored partId does not derive the line id");
    if (!cycleCountTypes_js_1.CYCLE_COUNT_SUPPORTED_TRACKING_MODES.includes(data.trackingMode))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored trackingMode invalid");
    const trackingMode = data.trackingMode;
    if (data.fingerprint !== (0, exports.fingerprintLine)(data.partId, trackingMode))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored line fingerprint mismatch");
    if (!Number.isInteger(data.expectedQuantity) || data.expectedQuantity < 0)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored expectedQuantity invalid");
    let expectedSerialNumbers;
    if (trackingMode === "SERIAL") {
        expectedSerialNumbers = sortedUniqueSerials(data.expectedSerialNumbers, "expectedSerialNumbers");
        if (expectedSerialNumbers.length !== data.expectedQuantity)
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored expected serial count mismatch");
    }
    else if (data.expectedSerialNumbers !== undefined) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("NONE line must not carry expectedSerialNumbers");
    }
    if (!exports.LINE_STATUSES.includes(data.status))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored line status invalid");
    const status = data.status;
    if (!Number.isInteger(data.version) || data.version < 1)
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored line version invalid");
    if (!(0, cycleCountValidation_js_1.isNonEmptyString)(data.openedBy) || !(0, cycleCountValidation_js_1.isNonEmptyString)(data.updatedBy))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored line actors invalid");
    const submitted = status === "COUNTED" || status === "RECONCILED" || status === "REJECTED";
    const decided = status === "RECONCILED" || status === "REJECTED";
    const hasCounted = data.countedQuantity !== undefined || data.countedSerialNumbers !== undefined;
    if (submitted !== hasCounted || submitted !== (0, cycleCountValidation_js_1.isNonEmptyString)(data.submittedBy) || submitted !== (data.submittedAt !== undefined)) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored count fields inconsistent with status");
    }
    let countedQuantity;
    let countedSerialNumbers;
    let variance;
    let serialVariance;
    if (submitted) {
        if (trackingMode === "NONE") {
            if (!Number.isInteger(data.countedQuantity) || data.countedQuantity < 0)
                throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored countedQuantity invalid");
            countedQuantity = data.countedQuantity;
            if (data.variance !== countedQuantity - data.expectedQuantity)
                throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored variance disagrees with counted - expected");
            variance = data.variance;
        }
        else {
            countedSerialNumbers = sortedUniqueSerials(data.countedSerialNumbers, "countedSerialNumbers");
            const sv = data.serialVariance;
            if (!(0, cycleCountValidation_js_1.isPlainObject)(sv))
                throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored serialVariance invalid");
            serialVariance = { missing: sortedUniqueSerials(sv.missing, "missing"), unexpected: sortedUniqueSerials(sv.unexpected, "unexpected") };
        }
    }
    if (decided !== (data.reviewDecision !== undefined) || decided !== (0, cycleCountValidation_js_1.isNonEmptyString)(data.reconciledBy) || decided !== (data.reconciledAt !== undefined) || decided !== Array.isArray(data.ledgerEventIds)) {
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored disposition fields inconsistent with status");
    }
    if (decided) {
        if (!cycleCountTypes_js_1.CYCLE_COUNT_REVIEW_DECISIONS.includes(data.reviewDecision))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored reviewDecision invalid");
        if ((data.reviewDecision === "REJECT") !== (status === "REJECTED"))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored reviewDecision disagrees with status");
        if (!data.ledgerEventIds.every((x) => (0, cycleCountValidation_js_1.isNonEmptyString)(x)))
            throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored ledgerEventIds invalid");
    }
    if (data.reconciliationReason !== undefined && !(0, cycleCountValidation_js_1.isNonEmptyString)(data.reconciliationReason))
        throw new cycleCountTypes_js_1.CycleCountMalformedStoredRecordError("stored reason invalid");
    return {
        sheetId, lineId, partId: data.partId, trackingMode,
        expectedQuantity: data.expectedQuantity,
        ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }),
        expectedSnapshotAt: millis(data.expectedSnapshotAt, "expectedSnapshotAt"),
        status, version: data.version, fingerprint: data.fingerprint,
        openedBy: data.openedBy, openedAt: millis(data.openedAt, "openedAt"),
        updatedAt: millis(data.updatedAt, "updatedAt"), updatedBy: data.updatedBy,
        ...(countedQuantity === undefined ? {} : { countedQuantity }),
        ...(countedSerialNumbers === undefined ? {} : { countedSerialNumbers }),
        ...(variance === undefined ? {} : { variance }),
        ...(serialVariance === undefined ? {} : { serialVariance }),
        ...(submitted ? { submittedBy: data.submittedBy, submittedAt: optionalMillis(data.submittedAt, "submittedAt") } : {}),
        ...(decided ? {
            reviewDecision: data.reviewDecision,
            reconciledAt: optionalMillis(data.reconciledAt, "reconciledAt"),
            reconciledBy: data.reconciledBy,
            ledgerEventIds: [...data.ledgerEventIds],
        } : {}),
        ...(data.reconciliationReason === undefined ? {} : { reconciliationReason: data.reconciliationReason }),
    };
}
const lineSubmitFields = (line, actor, now, counted) => ({
    status: "COUNTED", version: line.version + 1, updatedAt: ts(now.getTime()), updatedBy: actor.id,
    submittedBy: actor.id, submittedAt: ts(now.getTime()),
    ...("countedQuantity" in counted
        ? { countedQuantity: counted.countedQuantity, variance: counted.variance }
        : { countedSerialNumbers: [...counted.countedSerialNumbers].sort(), serialVariance: counted.serialVariance }),
});
exports.lineSubmitFields = lineSubmitFields;
const lineDecisionFields = (line, actor, now, decision, reason, ledgerEventIds) => ({
    status: decision === "REJECT" ? "REJECTED" : "RECONCILED", version: line.version + 1,
    updatedAt: ts(now.getTime()), updatedBy: actor.id,
    reviewDecision: decision, reconciledAt: ts(now.getTime()), reconciledBy: actor.id,
    ledgerEventIds: [...ledgerEventIds],
    ...(reason ? { reconciliationReason: reason } : {}),
});
exports.lineDecisionFields = lineDecisionFields;
const lineCancelFields = (line, actor, now) => ({
    status: "CANCELLED", version: line.version + 1, updatedAt: ts(now.getTime()), updatedBy: actor.id,
});
exports.lineCancelFields = lineCancelFields;
//# sourceMappingURL=cycleCountSheetRepository.js.map