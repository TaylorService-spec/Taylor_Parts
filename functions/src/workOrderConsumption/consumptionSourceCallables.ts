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

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getCallerContext } from "../callerContext.js";
import { TERMINAL_STATUSES } from "../transitionEngine.js";
import { resolveConsumptionSourceOptions, readWorkOrderForSourceLookup } from "./consumptionSourceService.js";

interface ListSourcesInput {
  workOrderId?: unknown;
  partId?: unknown;
  requestedQuantity?: unknown;
  trackingMode?: unknown;
  serialNo?: unknown;
}

export const listWorkOrderConsumptionSources = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const data = (request.data ?? {}) as ListSourcesInput;
  const workOrderId = typeof data.workOrderId === "string" ? data.workOrderId.trim() : "";
  const partId = typeof data.partId === "string" ? data.partId.trim() : "";
  if (!workOrderId || !partId) throw new HttpsError("invalid-argument", "workOrderId and partId are required.");

  // THE SAME GATE AS updateWorkOrderExecutionData, deliberately duplicated rather than relaxed.
  const caller = await getCallerContext(request.auth.uid);
  if (caller.role !== "technician") {
    throw new HttpsError("permission-denied", "Only technicians may look up consumption sources.");
  }
  if (!caller.technicianId) {
    throw new HttpsError("failed-precondition", "This account has no technicianId mapping yet.");
  }

  const db = getFirestore();
  const wo = await readWorkOrderForSourceLookup(db, workOrderId);
  if (wo === null) throw new HttpsError("not-found", `No Work Order with id ${workOrderId}`);
  if (wo.assignedTechId !== caller.technicianId) {
    throw new HttpsError("permission-denied", "This Work Order is not assigned to you.");
  }
  if (typeof wo.status === "string" && (TERMINAL_STATUSES as ReadonlySet<string>).has(wo.status)) {
    throw new HttpsError("failed-precondition", "Execution data cannot be changed on a terminal Work Order.");
  }

  const options = await resolveConsumptionSourceOptions(db, {
    workOrderId,
    partId,
    requestedQuantity: typeof data.requestedQuantity === "number" && data.requestedQuantity > 0 ? data.requestedQuantity : 1,
    trackingMode: typeof data.trackingMode === "string" ? data.trackingMode : "NONE",
    serialNo: typeof data.serialNo === "string" ? data.serialNo : null,
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
