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
    const totals = new Map();
    stock.docs.forEach((d) => { const s = d.data(); totals.set(s.partId, (totals.get(s.partId) ?? 0) + s.quantity); });
    return { health: (0, inventoryAnalyticsService_1.generateInventoryHealthDashboard)((0, ledgerNormalizer_1.normalizeLedgerTransactions)(ledger.docs.map((d) => ({ ...d.data(), id: d.id }))), [...totals].map(([partId, availableStock]) => ({ partId, availableStock }))) };
});
//# sourceMappingURL=inventoryAnalyticsCallables.js.map