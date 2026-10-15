"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInventoryAnalytics = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("./callerContext");
const collections_1 = require("./constants/collections");
const ledgerNormalizer_1 = require("./ledgerNormalizer");
const inventoryAnalyticsService_1 = require("./inventoryAnalyticsService");
exports.getInventoryAnalytics = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const caller = await (0, callerContext_1.getCallerContext)(request.auth.uid);
    if (caller.role !== "admin" && caller.role !== "dispatcher")
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
    return { health: (0, inventoryAnalyticsService_1.generateInventoryHealthDashboard)(transactions, stockSnapshots) };
});
//# sourceMappingURL=inventoryAnalyticsCallables.js.map