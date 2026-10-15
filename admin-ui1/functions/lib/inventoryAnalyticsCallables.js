"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInventoryAnalytics = exports.INVENTORY_ANALYTICS_READ_CAPABILITY = void 0;
exports.computeAnalyticsOnHandByPart = computeAnalyticsOnHandByPart;
exports.projectHealthForWire = projectHealthForWire;
exports.assertWireEncodable = assertWireEncodable;
exports.partitionLedgerDocsForAnalytics = partitionLedgerDocsForAnalytics;
const binParentage_js_1 = require("./inventoryLocation/binParentage.js");
const locationOnHand_js_1 = require("./inventoryLedger/locationOnHand.js");
const operationalMovementRepository_js_1 = require("./inventoryLedger/operationalMovementRepository.js");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("./access/effectiveAccessFeed");
const collections_1 = require("./constants/collections");
const ledgerNormalizer_1 = require("./ledgerNormalizer");
const inventoryAnalyticsService_1 = require("./inventoryAnalyticsService");
const fulfillmentAvailability_1 = require("./fulfillment/fulfillmentAvailability");
exports.INVENTORY_ANALYTICS_READ_CAPABILITY = "inventory.analytics.read";
/**
 * The physical baseline per part, from governed current sources only. PURE — the callable supplies
 * the reads, so this is unit-testable without the emulator and cannot drift from what the callable
 * would compute.
 */
function computeAnalyticsOnHandByPart(ledgerRows, serializedAssets, eligibleWarehouseIds, 
// Model A: governed bin -> warehouse parentage for every bin these rows or assets name.
binParentage) {
    const rowsByPart = new Map();
    for (const row of ledgerRows) {
        if (typeof row.partId !== "string" || row.partId === "")
            continue; // malformed rows never inflate
        const list = rowsByPart.get(row.partId);
        if (list)
            list.push(row);
        else
            rowsByPart.set(row.partId, [row]);
    }
    const onHand = new Map();
    for (const [partId, rows] of rowsByPart) {
        const sum = (0, fulfillmentAvailability_1.sumLedgerEligibleOnHand)(rows, eligibleWarehouseIds, binParentage);
        // null means NO physical evidence at all. Omit the part rather than asserting a zero it has not
        // earned -- the same distinction the previous stock_locations contract drew.
        if (sum !== null)
            onHand.set(partId, sum);
    }
    for (const asset of serializedAssets) {
        if (typeof asset.partId !== "string" || asset.partId === "")
            continue;
        if (asset.inventoryState !== "AVAILABLE")
            continue;
        // currentLocationId is a typeless scalar. A serial put away into a Bin carries the bin id, and its
        // custody Warehouse is that bin's governed parent -- resolved from the bins document, never from
        // the id's prefix (Decision #170 Part B; bin-stock-relocation-and-multi-scan.md sec6).
        if (typeof asset.currentLocationId !== "string")
            continue;
        const custody = binParentage.get(asset.currentLocationId) ?? asset.currentLocationId;
        if (!eligibleWarehouseIds.has(custody))
            continue;
        onHand.set(asset.partId, (onHand.get(asset.partId) ?? 0) + 1);
    }
    return onHand;
}
function projectHealthForWire(entries) {
    return entries.map((entry) => {
        const e = entry;
        const rec = e.recommendation;
        if (!rec)
            return e;
        const days = rec.daysRemaining;
        return {
            ...e,
            recommendation: {
                ...rec,
                daysRemaining: days === Infinity ? null : days,
            },
        };
    });
}
/** Throws with the exact path of the first non-encodable number, instead of a bare 500 after return. */
function assertWireEncodable(value, path = "result") {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`non-finite number at ${path}: ${String(value)}`);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => assertWireEncodable(v, `${path}[${i}]`));
        return;
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
        for (const [k, v] of Object.entries(value))
            assertWireEncodable(v, `${path}.${k}`);
    }
}
exports.getInventoryAnalytics = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    // AUTHORITY NORMALIZATION. This was the only trusted read in the repo authorizing via
    // a direct role comparison instead of the capability catalog, which meant its audience
    // was invisible to resolveEffectiveAccess, to the permission catalog, and to every tool
    // that reasons about who can read what.
    //
    // inventory.analytics.read is granted through SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS,
    // so the effective audience is unchanged: admin and dispatcher, exactly as the role
    // check allowed. Fail closed on resolver error, matching every sibling read service.
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: [exports.INVENTORY_ANALYTICS_READ_CAPABILITY],
        });
        allowed = decisions[exports.INVENTORY_ANALYTICS_READ_CAPABILITY] === true;
    }
    catch (err) {
        console.error(`[getInventoryAnalytics] capability resolution failed for ${exports.INVENTORY_ANALYTICS_READ_CAPABILITY}`, err);
        allowed = false;
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "Not authorized to read inventory analytics.");
    const db = (0, firestore_1.getFirestore)();
    const [ledger, warehouses, serialized] = await Promise.all([
        db.collection(collections_1.INVENTORY_TRANSACTIONS_COLLECTION).get(),
        // Eligible pool = status==ACTIVE warehouses, the same fence Sales-Order allocation applies.
        // MOBILE/truck and customer-held stock live in their own collections and are deliberately not
        // warehouse stock.
        db.collection(collections_1.WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get(),
        db.collection(collections_1.SERIALIZED_ASSETS_COLLECTION).where("inventoryState", "==", "AVAILABLE").get(),
    ]);
    // DQ-027 (Controller ruling 2026-09-28): malformed ledger evidence is NEVER silently omitted. A part named by
    // an unreadable row gets no figures and is REPORTED in `integrity.unavailablePartIds`; every other part is
    // computed from its own readable rows and stays truthful. An unreadable row naming no part makes every
    // figure untrustworthy, so the read fails (failed-precondition) rather than answer.
    const integrity = partitionLedgerDocsForAnalytics(ledger.docs);
    if (integrity.state === "UNAVAILABLE") {
        throw new https_1.HttpsError("failed-precondition", "Inventory analytics are unavailable: a ledger record cannot be read or attributed to a part.", { code: "LEDGER_ROW_UNREADABLE" });
    }
    const usableDocs = integrity.readableDocs;
    const transactions = (0, ledgerNormalizer_1.normalizeLedgerTransactions)(usableDocs.map((d) => ({ ...d.data(), id: d.id })));
    // The physical baseline comes from the RAW ledger rows, not the normalized ones: normalization
    // drops `location` and `trackingMode`, which are exactly the two facts the warehouse fence and the
    // serial exclusion depend on.
    const eligibleWarehouseIds = new Set(warehouses.docs.map((d) => d.id));
    const rawRows = usableDocs.map((d) => d.data());
    // An affected part is withheld WHOLE: its serialized units are not half an answer either.
    const unavailableParts = new Set(integrity.unavailablePartIds);
    const rawAssets = serialized.docs.map((d) => d.data())
        .filter((a) => !(typeof a.partId === "string" && unavailableParts.has(a.partId)));
    // Resolve only the bins actually referenced: ledger rows at a BIN, and serials whose scalar location
    // is not an eligible warehouse id (a candidate bin). A non-bin id simply resolves to nothing.
    const candidateBinIds = [
        ...(0, locationOnHand_js_1.binIdsReferenced)(rawRows),
        ...rawAssets
            .map((a) => a.currentLocationId)
            .filter((id) => typeof id === "string" && id !== "" && !eligibleWarehouseIds.has(id)),
    ];
    const binParentage = await (0, binParentage_js_1.readBinParentage)(db, candidateBinIds);
    const onHandByPart = computeAnalyticsOnHandByPart(rawRows, rawAssets, eligibleWarehouseIds, binParentage);
    // availableStock nets outstanding reservations off that baseline -- the same
    // "physical - (grossReserved - released)" definition every other availableStock consumer uses, so
    // this callable's figure agrees with them instead of overstating it.
    const netReservedByPart = new Map();
    transactions.forEach((t) => {
        const delta = t.type === "RESERVED" ? t.quantity : t.type === "RELEASED" ? -t.quantity : 0;
        if (delta !== 0)
            netReservedByPart.set(t.partId, (netReservedByPart.get(t.partId) ?? 0) + delta);
    });
    const stockSnapshots = [...onHandByPart].map(([partId, onHand]) => ({ partId, availableStock: onHand - (netReservedByPart.get(partId) ?? 0) }));
    const health = projectHealthForWire((0, inventoryAnalyticsService_1.generateInventoryHealthDashboard)(transactions, stockSnapshots));
    try {
        assertWireEncodable({ health });
    }
    catch (err) {
        // Server-side detail so the next one is diagnosable from the log; the client message stays
        // generic and carries no field values, paths, or record content.
        console.error("getInventoryAnalytics: refusing to return a non-encodable payload", err);
        throw new https_1.HttpsError("internal", "Inventory analytics could not be encoded. Try again shortly.");
    }
    return {
        health,
        integrity: {
            state: integrity.state,
            reason: integrity.state === "COMPLETE" ? null : "LEDGER_ROW_UNREADABLE",
            unavailablePartIds: integrity.unavailablePartIds,
        },
    };
});
/**
 * DQ-027 partition, through the server's ONE strict reader. Legacy rows stay (location-less commitment
 * events, used for the reservation netting); operational rows must deserialize; anything else is
 * unreadable. All rows of an affected part are withheld -- a partial figure computed from its readable
 * rows would be a wrong figure presented as a right one.
 */
function partitionLedgerDocsForAnalytics(docs) {
    const unavailable = new Set();
    let unattributable = 0;
    for (const d of docs) {
        const data = d.data();
        const cls = (0, operationalMovementRepository_js_1.classifyLedgerDoc)(data);
        if (cls === "legacy")
            continue;
        if (cls === "operational") {
            try {
                (0, operationalMovementRepository_js_1.deserializeOperationalMovement)(data);
                continue;
            }
            catch { /* unreadable -- recorded below */ }
        }
        const partId = data && typeof data === "object" && !Array.isArray(data) ? data.partId : undefined;
        if (typeof partId === "string" && partId.trim() !== "")
            unavailable.add(partId);
        else
            unattributable += 1;
    }
    const state = unattributable > 0 ? "UNAVAILABLE" : unavailable.size > 0 ? "INCOMPLETE" : "COMPLETE";
    return {
        state,
        readableDocs: state === "UNAVAILABLE" ? [] : docs.filter((d) => {
            const pid = d.data()?.partId;
            return !(typeof pid === "string" && unavailable.has(pid));
        }),
        unavailablePartIds: [...unavailable].sort(),
    };
}
//# sourceMappingURL=inventoryAnalyticsCallables.js.map