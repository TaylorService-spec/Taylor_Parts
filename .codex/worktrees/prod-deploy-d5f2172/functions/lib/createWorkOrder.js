"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkOrder = void 0;
// Work Order Engine v1.2 -- createWorkOrder callable.
//
// Only admin/dispatcher may call this (see the Create row of the
// permissions matrix, functions/src/transitionEngine.ts's
// ACTION_PERMISSIONS). This is the first of exactly two ways
// fieldops_wos is ever written -- firestore.rules denies all direct
// client writes to that collection unconditionally.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("./callerContext");
const woNumbering_1 = require("./woNumbering");
const collections_1 = require("./constants/collections");
function assertValidInput(data) {
    const input = data;
    if (!input || typeof input !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    if (!input.customerId) {
        throw new https_1.HttpsError("invalid-argument", "customerId is required.");
    }
    if (!input.locationId) {
        throw new https_1.HttpsError("invalid-argument", "locationId is required.");
    }
    if (![1, 2, 3, 4].includes(input.priority)) {
        throw new https_1.HttpsError("invalid-argument", "priority is required and must be 1-4.");
    }
    if (!input.type && !input.complaint) {
        throw new https_1.HttpsError("invalid-argument", "Either complaint or type (service classification) is required.");
    }
}
exports.createWorkOrder = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const caller = await (0, callerContext_1.getCallerContext)(request.auth.uid);
    if (caller.role !== "admin" && caller.role !== "dispatcher") {
        throw new https_1.HttpsError("permission-denied", "Only admin/dispatcher may create Work Orders.");
    }
    assertValidInput(request.data);
    const { customerId, locationId, priority, severity, type, complaint } = request.data;
    const db = (0, firestore_1.getFirestore)();
    const year = new Date().getFullYear();
    return db.runTransaction(async (tx) => {
        const { woNumber } = await (0, woNumbering_1.allocateWorkOrderNumber)(tx, year);
        const woRef = db.collection(collections_1.WORK_ORDERS_COLLECTION).doc();
        tx.set(woRef, {
            woNumber,
            status: "CREATED",
            priority,
            ...(severity ? { severity } : {}),
            ...(type ? { type } : {}),
            customerId,
            locationId,
            ...(complaint ? { complaint } : {}),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return { id: woRef.id, woNumber };
    });
});
//# sourceMappingURL=createWorkOrder.js.map