"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInventoryAnalytics = exports.INVENTORY_ANALYTICS_READ_CAPABILITY = void 0;
exports.projectHealthForWire = projectHealthForWire;
exports.assertWireEncodable = assertWireEncodable;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const effectiveAccessFeed_1 = require("./access/effectiveAccessFeed");
const collections_1 = require("./constants/collections");
const ledgerNormalizer_1 = require("./ledgerNormalizer");
const inventoryAnalyticsService_1 = require("./inventoryAnalyticsService");
exports.INVENTORY_ANALYTICS_READ_CAPABILITY = "inventory.analytics.read";
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
    const [ledger, stock] = await Promise.all([db.collection(collections_1.INVENTORY_TRANSACTIONS_COLLECTION).get(), db.collection(collections_1.STOCK_LOCATIONS_COLLECTION).get()]);
    const transactions = (0, ledgerNormalizer_1.normalizeLedgerTransactions)(ledger.docs.map((d) => ({ ...d.data(), id: d.id })));
    // Physical bin total per part -- the warehouse-wide baseline this
    // callable reads from real STOCK_LOCATIONS_COLLECTION documents
    // (more current than data/partsCatalog.ts's static warehouseQty
    // baseline, which inventoryService.ts's getAvailableQuantity() uses
    // as its baseline instead). availableStock must still be netted
    // against outstanding reservations on top of that baseline -- same
    // "warehouseQty - (grossReserved - released)" definition as
    // getAvailableQuantity() / computeAvailableStockByPart() -- so this
    // callable's figure agrees with every other availableStock consumer
    // instead of overstating it with raw bin totals that ignore
    // outstanding RESERVED transactions.
    const binTotals = new Map();
    stock.docs.forEach((d) => { const s = d.data(); binTotals.set(s.partId, (binTotals.get(s.partId) ?? 0) + s.quantity); });
    const netReservedByPart = new Map();
    transactions.forEach((t) => {
        const delta = t.type === "RESERVED" ? t.quantity : t.type === "RELEASED" ? -t.quantity : 0;
        if (delta !== 0)
            netReservedByPart.set(t.partId, (netReservedByPart.get(t.partId) ?? 0) + delta);
    });
    const stockSnapshots = [...binTotals].map(([partId, binQty]) => ({ partId, availableStock: binQty - (netReservedByPart.get(partId) ?? 0) }));
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
    return { health };
});
//# sourceMappingURL=inventoryAnalyticsCallables.js.map