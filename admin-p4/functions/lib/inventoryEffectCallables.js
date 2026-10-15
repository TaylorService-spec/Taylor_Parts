"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectInventoryEffects = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("./callerContext");
const collections_1 = require("./constants/collections");
const inventoryEffectDetection_1 = require("./inventoryEffectDetection");
exports.detectInventoryEffects = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const id = request.data?.workOrderId;
    if (typeof id !== "string" || !id.trim())
        throw new https_1.HttpsError("invalid-argument", "workOrderId is required.");
    const caller = await (0, callerContext_1.getCallerContext)(request.auth.uid);
    if (caller.role !== "admin" && caller.role !== "dispatcher")
        throw new https_1.HttpsError("permission-denied", "Not authorized to inspect inventory effects.");
    const db = (0, firestore_1.getFirestore)();
    const [wo, sync] = await Promise.all([db.collection(collections_1.WORK_ORDERS_COLLECTION).doc(id).get(), db.collection(collections_1.INVENTORY_SYNC_STATUS_COLLECTION).doc(id).get()]);
    if (!wo.exists)
        throw new https_1.HttpsError("not-found", "Work Order not found.");
    const data = wo.data() ?? {};
    return (0, inventoryEffectDetection_1.detectWorkOrderInventoryEffects)({ workOrderId: id, status: data.status, executionTimestamps: data, inventorySnapshotItemCount: Array.isArray(data.inventorySnapshot) ? data.inventorySnapshot.length : null }, { exists: sync.exists, ...(sync.data() ?? {}) });
});
//# sourceMappingURL=inventoryEffectCallables.js.map