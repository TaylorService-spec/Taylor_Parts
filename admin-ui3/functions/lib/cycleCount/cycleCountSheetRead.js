"use strict";
// Cycle Count A4 -- the DURABLE governed read of count sheets. The browser never reads `cycle_counts`
// (Rules deny it); this is how a counter resumes a sheet and a reconciler finds counts waiting for review.
//
//   listCycleCountSheets  sheets, newest-id-first is NOT promised -- ordered by document id, paged with an
//                         explicit cursor; a page that ends early says so (nextCursor), never truncates.
//   getCycleCountSheet    one sheet and a page of its lines.
//
// Rules the projection obeys:
//   - v2 ONLY. The population is `schemaVersion == 2`, selected by the query. A v1 record is never read.
//   - BLIND PER LINE. A line's expected value and variance appear only once THAT line is submitted;
//     OPEN (and never-counted CANCELLED) lines carry neither, whoever is asking.
//   - FAIL CLOSED. A malformed sheet or line fails the read; nothing is dropped or turned into zero.
// Authority: the caller must hold at least one Cycle Count capability; the capability is global-scope,
// exactly as the commands' own authorization is.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CycleCountReadInvalidError = exports.LINE_PAGE_MAX = exports.SHEET_PAGE_MAX = void 0;
exports.resolveLocationLabels = resolveLocationLabels;
exports.sheetSummary = sheetSummary;
exports.lineProjection = lineProjection;
exports.listCycleCountSheets = listCycleCountSheets;
exports.getCycleCountSheet = getCycleCountSheet;
const firestore_1 = require("firebase-admin/firestore");
const collections_js_1 = require("../constants/collections.js");
const cycleCountSheetRepository_js_1 = require("./cycleCountSheetRepository.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
const binCommands_js_1 = require("../inventoryLocation/binCommands.js");
const collections_js_2 = require("../constants/collections.js");
const truckRegistryRepository_js_1 = require("../truckRegistry/truckRegistryRepository.js");
/**
 * A human label for each counted location -- the Bin's code, the Warehouse's name, the truck's label --
 * read from the governed documents at READ time (a renamed bin shows its current code). Falls back to the
 * id: a location that no longer resolves is still a real fact about the count.
 */
async function resolveLocationLabels(db, locations) {
    const key = (l) => `${l.type}:${l.locationId}`;
    const unique = [...new Map(locations.map((l) => [key(l), l])).values()];
    const coll = { BIN: binCommands_js_1.BINS_COLLECTION, WAREHOUSE: collections_js_2.WAREHOUSES_COLLECTION, MOBILE: truckRegistryRepository_js_1.MOBILE_LOCATIONS_COLLECTION };
    const refs = unique.map((l) => db.collection(coll[l.type]).doc(l.locationId));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    const out = new Map();
    unique.forEach((l, i) => {
        const d = snaps[i]?.exists ? snaps[i].data() ?? {} : {};
        const label = l.type === "BIN" ? d.code : l.type === "WAREHOUSE" ? d.name : (d.displayLabel ?? d.label);
        out.set(key(l), typeof label === "string" && label.trim() !== "" ? label : l.locationId);
    });
    return out;
}
const labelKey = (l) => `${l.type}:${l.locationId}`;
exports.SHEET_PAGE_MAX = 50;
exports.LINE_PAGE_MAX = 200;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
class CycleCountReadInvalidError extends Error {
}
exports.CycleCountReadInvalidError = CycleCountReadInvalidError;
function sheetSummary(s, labels) {
    return {
        sheetId: s.sheetId, location: s.location, locationLabel: labels?.get(labelKey(s.location)) ?? s.location.locationId, status: s.status,
        createdAt: s.createdAt, createdBy: s.createdBy, updatedAt: s.updatedAt,
        ...(s.closedAt === undefined ? {} : { closedAt: s.closedAt, closedBy: s.closedBy }),
    };
}
/** The per-line projection. Expected/variance only after THIS line was submitted. */
function lineProjection(l) {
    const submitted = l.status === "COUNTED" || l.status === "RECONCILED" || l.status === "REJECTED";
    return {
        lineId: l.lineId, partId: l.partId, trackingMode: l.trackingMode, status: l.status,
        expectedSnapshotAt: l.expectedSnapshotAt, openedBy: l.openedBy, openedAt: l.openedAt,
        ...(submitted ? {
            submittedBy: l.submittedBy, submittedAt: l.submittedAt,
            ...(l.trackingMode === "NONE"
                ? { countedQuantity: l.countedQuantity, variance: l.variance, expectedQuantity: l.expectedQuantity }
                : { countedSerialNumbers: l.countedSerialNumbers, serialVariance: l.serialVariance, expectedSerialNumbers: l.expectedSerialNumbers, expectedQuantity: l.expectedQuantity }),
        } : {}),
        ...(l.reviewDecision === undefined ? {} : {
            reviewDecision: l.reviewDecision, reconciledBy: l.reconciledBy, reconciledAt: l.reconciledAt, ledgerEventIds: l.ledgerEventIds,
            ...(l.reconciliationReason === undefined ? {} : { reconciliationReason: l.reconciliationReason }),
        }),
    };
}
function pageSize(v, max) {
    if (v === undefined)
        return max;
    if (!Number.isInteger(v) || v < 1 || v > max)
        throw new CycleCountReadInvalidError("limit invalid");
    return v;
}
function cursorOf(v) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== "string" || !SAFE_ID.test(v))
        throw new CycleCountReadInvalidError("cursor invalid");
    return v;
}
function onlyKeys(data, allowed) {
    if (Object.keys(data).some((k) => !allowed.includes(k)))
        throw new CycleCountReadInvalidError("unknown field");
}
async function listCycleCountSheets(request, db) {
    const data = (request ?? {});
    if (typeof data !== "object" || Array.isArray(data))
        throw new CycleCountReadInvalidError("request must be an object");
    onlyKeys(data, ["status", "limit", "cursor"]);
    if (data.status !== undefined && !cycleCountSheetRepository_js_1.SHEET_STATUSES.includes(data.status))
        throw new CycleCountReadInvalidError("status invalid");
    const limit = pageSize(data.limit, exports.SHEET_PAGE_MAX);
    const cursor = cursorOf(data.cursor);
    // One equality filter and a document-id order: served by the automatic single-field index, no composite.
    let q = db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).where("schemaVersion", "==", cycleCountSheetRepository_js_1.CYCLE_COUNT_SHEET_SCHEMA_VERSION).orderBy(firestore_1.FieldPath.documentId()).limit(limit + 1);
    if (cursor)
        q = q.startAfter(cursor);
    const snap = await q.get();
    const docs = snap.docs.slice(0, limit);
    const kept = docs.map((d) => (0, cycleCountSheetRepository_js_1.deserializeSheet)(d.id, d.data())) // fails closed on a malformed sheet
        .filter((s) => data.status === undefined || s.status === data.status);
    const labels = await resolveLocationLabels(db, kept.map((s) => s.location));
    const sheets = kept.map((s) => sheetSummary(s, labels));
    // The status filter is applied after the page is read, so a page may hold fewer sheets than `limit`:
    // nextCursor is the only statement about whether more exist, and it is always given.
    return { sheets, nextCursor: snap.docs.length > limit ? docs[docs.length - 1].id : null };
}
async function getCycleCountSheet(request, db) {
    const data = (request ?? {});
    if (typeof data !== "object" || Array.isArray(data))
        throw new CycleCountReadInvalidError("request must be an object");
    onlyKeys(data, ["sheetId", "limit", "cursor"]);
    if (typeof data.sheetId !== "string" || !SAFE_ID.test(data.sheetId))
        throw new CycleCountReadInvalidError("sheetId invalid");
    const limit = pageSize(data.limit, exports.LINE_PAGE_MAX);
    const cursor = cursorOf(data.cursor);
    const ref = db.collection(collections_js_1.CYCLE_COUNTS_COLLECTION).doc(data.sheetId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.schemaVersion !== cycleCountSheetRepository_js_1.CYCLE_COUNT_SHEET_SCHEMA_VERSION)
        throw new cycleCountTypes_js_1.CycleCountSheetNotFoundError();
    const sheet = (0, cycleCountSheetRepository_js_1.deserializeSheet)(snap.id, snap.data());
    let q = ref.collection(cycleCountSheetRepository_js_1.CYCLE_COUNT_LINES_SUBCOLLECTION).orderBy(firestore_1.FieldPath.documentId()).limit(limit + 1);
    if (cursor)
        q = q.startAfter(cursor);
    const lineSnap = await q.get();
    const docs = lineSnap.docs.slice(0, limit);
    const lines = docs.map((d) => lineProjection((0, cycleCountSheetRepository_js_1.deserializeLine)(sheet.sheetId, d.id, d.data())));
    const labels = await resolveLocationLabels(db, [sheet.location]);
    return { sheet: sheetSummary(sheet, labels), lines, nextCursor: lineSnap.docs.length > limit ? docs[docs.length - 1].id : null };
}
//# sourceMappingURL=cycleCountSheetRead.js.map