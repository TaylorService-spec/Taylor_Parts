"use strict";
// listWorkOrderConsumptionSources — the ONE narrow trusted read that makes source selection possible.
//
// It exists because no trusted Work Order execution read existed to extend: the client reads
// `fieldops_wos` directly under Rules, so there was no server-composed response to add a projection
// to. This is the smaller of the two options Decision #171 permits, and it is scoped to one question.
//
// IT GRANTS NOTHING STANDING. Same actor boundary as the command that records usage — technician
// role, and assigned to THIS Work Order. A principal who may not record execution data may not
// enumerate sources either; otherwise this becomes a way to probe locations from outside the
// workflow it serves. Rules are unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWorkOrderConsumptionSources = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const callerContext_js_1 = require("../callerContext.js");
const transitionEngine_js_1 = require("../transitionEngine.js");
const consumptionSourceService_js_1 = require("./consumptionSourceService.js");
const consumptionPartTracking_js_1 = require("./consumptionPartTracking.js");
exports.listWorkOrderConsumptionSources = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {});
    const workOrderId = typeof data.workOrderId === "string" ? data.workOrderId.trim() : "";
    const partId = typeof data.partId === "string" ? data.partId.trim() : "";
    if (!workOrderId || !partId)
        throw new https_1.HttpsError("invalid-argument", "workOrderId and partId are required.");
    // THE SAME GATE AS updateWorkOrderExecutionData, deliberately duplicated rather than relaxed.
    const caller = await (0, callerContext_js_1.getCallerContext)(request.auth.uid);
    if (caller.role !== "technician") {
        throw new https_1.HttpsError("permission-denied", "Only technicians may look up consumption sources.");
    }
    if (!caller.technicianId) {
        throw new https_1.HttpsError("failed-precondition", "This account has no technicianId mapping yet.");
    }
    const db = (0, firestore_1.getFirestore)();
    const wo = await (0, consumptionSourceService_js_1.readWorkOrderForSourceLookup)(db, workOrderId);
    if (wo === null)
        throw new https_1.HttpsError("not-found", `No Work Order with id ${workOrderId}`);
    if (wo.assignedTechId !== caller.technicianId) {
        throw new https_1.HttpsError("permission-denied", "This Work Order is not assigned to you.");
    }
    if (typeof wo.status === "string" && transitionEngine_js_1.TERMINAL_STATUSES.has(wo.status)) {
        throw new https_1.HttpsError("failed-precondition", "Execution data cannot be changed on a terminal Work Order.");
    }
    // THE SAME AUTHORITY THE SUBMIT USES, ASKED THE SAME WAY. The picker and the writer now derive the
    // mode from one place, so this screen cannot offer a selection the command would then refuse.
    const trackingMode = (0, consumptionPartTracking_js_1.consumptionTrackingModeFor)(await (0, consumptionSourceService_js_1.readConsumptionTrackingModes)(db, [partId]), partId);
    if (!(0, consumptionPartTracking_js_1.isQuantityTracked)(trackingMode)) {
        // Not "choose one" — there is nothing to choose, and nothing this workflow can record. Same
        // shape as the resolver's other unavailable answers, so the client branches on a reason rather
        // than on an error.
        return {
            autoSource: null,
            selectableSources: [],
            serializedSource: null,
            sourceRequired: false,
            autoSourceUnavailableReason: consumptionPartTracking_js_1.PART_NOT_QUANTITY_TRACKED,
            mobileAmbiguous: false,
        };
    }
    const options = await (0, consumptionSourceService_js_1.resolveConsumptionSourceOptions)(db, {
        workOrderId,
        partId,
        requestedQuantity: typeof data.requestedQuantity === "number" && data.requestedQuantity > 0 ? data.requestedQuantity : 1,
        trackingMode: consumptionPartTracking_js_1.WORK_ORDER_CONSUMPTION_TRACKING_MODE,
        serialNo: null,
        technicianId: caller.technicianId,
    });
    // Identities and labels only. No quantities of any kind — see consumptionSourceOptions.ts.
    return {
        autoSource: options.autoSource,
        selectableSources: options.selectableSources,
        serializedSource: options.serializedSource,
        sourceRequired: options.sourceRequired,
        autoSourceUnavailableReason: options.autoSourceUnavailableReason,
        // Surfaced so a broken one-truck-per-driver promise is visible rather than silently costing the
        // technician their truck option.
        mobileAmbiguous: options.mobileAmbiguous,
    };
});
//# sourceMappingURL=consumptionSourceCallables.js.map