// RECORDED NONPROD ACTIVATION DECISIONS NOT PREVIOUSLY CAPTURED AS DATA (#210 pre-integration reconciliation, 2026-10-04).
//
// The governed authority baseline of a tenant is the canonical catalog + the measured baseline + the tenant's Administration
// decisions. Every other nonprod activation window recorded its ruled grants as a reviewed data delta in this directory
// (serviceActivation, salesManagerParity, partsPurchasingReceiving, inventoryWarehouse, equipment, truckInventory …). Two
// windows applied ruled grants through the Administration API WITHOUT such a delta, so a fresh replay of the recorded decisions
// produced 530 grants against nonprod's 542. The reconciliation (read-only nonprod census, job-db10vuugekts73bmd860) found the
// set difference to be EXACTLY these twelve rows -- every one ADMIN_GRANTED in nonprod by the administering Principal with the
// ruling quoted as its reason -- and nothing in the opposite direction:
//
//   CATALOG / REORDER (Controller GO 2026-09-28 on candidate 2d2bd40d; applied in the 2026-09-30 activation window, 415 -> 424):
//     Parts Manager   reorder.request.read*, approve, reject, cancel, reorder.purchaseOrder.void   (* read held already)
//     Parts Associate reorder.request.read, startPurchasing, postPurchasingUpdate, recordPurchaseOrder, markReceived
//   SERVICE EXPERIENCE (Controller #2007 MERGE CONFIRMED -- SERVICE EXPERIENCE NONPROD ACTIVATION 2026-09-30, "A"; 442 -> 446):
//     Dispatcher      workOrder.selfScheduling.issue
//     Service Manager workOrder.selfScheduling.issue, workOrder.selfScheduling.configure   (fieldManager)
//
// DATA ONLY, exactly like the other deltas: read by no command; nothing changes until Administration applies it. Nonprod already
// holds every row (no nonprod mutation follows from this file); it exists so a replay -- local proof, a rebuilt environment, a
// baseline-equal test tenant -- reproduces the governed nonprod state instead of silently diverging from it.
export const CATALOG_REORDER_ACTIVATION_RULING = "Controller ruling 2026-09-30 Catalog/Reorder nonprod activation (GO 2026-09-28, candidate 2d2bd40d)";
export const SELF_SCHEDULING_ACTIVATION_RULING = "Controller #2007 MERGE CONFIRMED -- SERVICE EXPERIENCE NONPROD ACTIVATION 2026-09-30, A";

export interface RecordedGrantDecision {
  readonly roleKey: string;
  readonly capabilityKey: string;
  readonly objectKey: string;
  readonly actionKey: string;
  readonly reason: string;
}

const g = (roleKey: string, capabilityKey: string, objectKey: string, actionKey: string, reason: string): RecordedGrantDecision =>
  Object.freeze({ roleKey, capabilityKey, objectKey, actionKey, reason });

export const CATALOG_REORDER_ACTIVATION_GRANTS: readonly RecordedGrantDecision[] = Object.freeze([
  g("partsManager", "reorder.request.approve", "reorderRequest", "approve", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Manager approves Reorder Requests`),
  g("partsManager", "reorder.request.reject", "reorderRequest", "reject", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Manager rejects Reorder Requests`),
  g("partsManager", "reorder.request.cancel", "reorderRequest", "cancel", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Manager cancels Reorder Requests`),
  g("partsManager", "reorder.purchaseOrder.void", "purchaseOrder", "void", `${CATALOG_REORDER_ACTIVATION_RULING}: void is a management exception (no assignee); the Owner does not get it because legacy had it`),
  g("partsAssociate", "reorder.request.read", "reorderRequest", "read", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Associate reads the Reorder queue (within REORDER_QUEUE scope)`),
  g("partsAssociate", "reorder.request.startPurchasing", "reorderRequest", "startPurchasing", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Associate starts purchasing`),
  g("partsAssociate", "reorder.request.postPurchasingUpdate", "reorderRequest", "postPurchasingUpdate", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Associate posts purchasing updates`),
  g("partsAssociate", "reorder.request.recordPurchaseOrder", "reorderRequest", "recordPurchaseOrder", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Associate records the Purchase Order`),
  g("partsAssociate", "reorder.request.markReceived", "reorderRequest", "markReceived", `${CATALOG_REORDER_ACTIVATION_RULING}: the Parts Associate marks receipt (inert once PG Receiving is active, per R2)`),
]);

export const SELF_SCHEDULING_ACTIVATION_GRANTS: readonly RecordedGrantDecision[] = Object.freeze([
  g("dispatcher", "workOrder.selfScheduling.issue", "workOrder", "issueSchedulingLink", `${SELF_SCHEDULING_ACTIVATION_RULING}: the Dispatcher issues customer self-scheduling links`),
  g("fieldManager", "workOrder.selfScheduling.issue", "workOrder", "issueSchedulingLink", `${SELF_SCHEDULING_ACTIVATION_RULING}: the Service Manager issues customer self-scheduling links`),
  g("fieldManager", "workOrder.selfScheduling.configure", "workOrder", "configureSelfScheduling", `${SELF_SCHEDULING_ACTIVATION_RULING}: the Service Manager configures the self-scheduling policy`),
]);

/** The Administration operations a replay issues, in the order nonprod applied them. */
export function recordedActivationOperations(): readonly { readonly operation: "grantObjectActionToRole"; readonly input: Record<string, unknown> }[] {
  return Object.freeze([...CATALOG_REORDER_ACTIVATION_GRANTS, ...SELF_SCHEDULING_ACTIVATION_GRANTS].map((d) => Object.freeze({
    operation: "grantObjectActionToRole" as const,
    input: Object.freeze({ roleKey: d.roleKey, objectKey: d.objectKey, actionKey: d.actionKey, reason: d.reason }),
  })));
}
