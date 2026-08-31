// Reorder — the trusted-callable transport (Workstream 2B, Owner rulings R-13 / R-15 / R-16).
//
// The two reorder writes that author a governed ownership fact no longer go to Firestore from the
// browser. `firestore.rules` retires their direct paths in the same change that adds this file, so
// this transport and the callables behind it are the only way those two records get written.
//
// ============================ WHAT THIS FILE MAY NOT DO ============================
//
// NEVER SENDS operatingCompanyId. Not as a hint, not as a convenience, not even when the browser
// happens to know it. The server derives it from the governed Warehouse and REFUSES a caller that
// supplies one -- so sending it would not merely be ignored, it would fail the command. The payload
// builders below construct an exact field set for that reason: a caller cannot pass one through by
// spreading an object it happened to have.
//
// NEVER FALLS BACK. If a callable fails, the failure surfaces. There is deliberately no retry into
// the old `runTransaction` path: that would recreate two write authorities for one command, which
// is precisely what the Rules retirement exists to prevent (R-15).
//
// NEVER COMPUTES COMPANY. The browser may DISPLAY the company a callable returns. It must not
// derive one for any authoritative purpose.
//
// Firebase is imported LAZILY, matching services/receivingCallableClient.js: firebase/firebase.js
// runs initializeApp on import, so a static import here would give this module an import-time side
// effect and make it unsafe to load in tests.

export const REORDER_CALLABLES = Object.freeze({
  createReorderRequest: "createReorderRequest",
  recordReorderPurchaseOrder: "recordReorderPurchaseOrder",
  // R-17. The warehouse pick-list. A trusted projection, NOT a `warehouses` collection read: the
  // browser has no LIST authority on that collection and is not gaining one.
  listReorderWarehouseOptions: "listReorderWarehouseOptions",
});

async function defaultInvoke(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

/**
 * An idempotency key for one user action.
 *
 * The server binds the key to the payload it was used with, so a retry of the SAME action replays
 * and a materially different retry is refused. Generated per invocation here: a React retry of the
 * same click reuses nothing, which is the honest behaviour -- a second click IS a second intent, and
 * pretending otherwise would hide double-submits rather than handle them.
 */
function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Translate a callable error into the message the UI already showed for this failure, WHERE THAT
 * REMAINS TRUTHFUL (ruling requirement 6).
 *
 * The governed refusals have no pre-existing user-facing equivalent -- there was no warehouse and no
 * company before this change -- so they get plain new sentences rather than being forced into an old
 * message that would misdescribe them.
 */
export function reorderCallableMessage(err) {
  const code = err?.details?.code ?? "";
  switch (code) {
    case "WAREHOUSE_REQUIRED":
      return "Choose the warehouse this reorder is for.";
    case "WAREHOUSE_NOT_GOVERNED":
      return "That warehouse is not an active, governed warehouse.";
    case "WAREHOUSE_NOT_IN_SCOPE":
      // R-17. Distinct from "not governed": the warehouse is real and fine, and this person is not
      // the one who may reorder for it. Saying so plainly beats a generic denial that reads like a
      // bug in the picker.
      return "You are not authorized to raise a reorder for that warehouse.";
    case "WAREHOUSE_NO_COMPANY":
      return "That warehouse has no operating company recorded, so a reorder against it has no owner.";
    case "REQUEST_NO_COMPANY":
      return "This reorder request has no operating company recorded, so a purchase order cannot be raised for it.";
    case "COMPANY_NOT_CLIENT_SUPPLIABLE":
      // A caller bug, not a user mistake. Said plainly rather than dressed up as a user error.
      return "The operating company is derived from the warehouse and cannot be supplied.";
    case "PO_ALREADY_EXISTS":
      return "This reorder request already has a purchase order.";
    case "REQUEST_STATE_INVALID":
      return "This reorder request is not in a state that accepts a purchase order.";
    case "IDEMPOTENCY_PAYLOAD_MISMATCH":
      return "That action was already submitted with different details.";
    default:
      // Preserve the existing semantics for the ordinary cases the UI already handled.
      if (err?.code === "functions/permission-denied") return "You are not authorized to do that.";
      if (err?.code === "functions/unauthenticated") return "You must be signed in.";
      return err?.message ?? "The request could not be completed.";
  }
}

/**
 * Create a reorder request through the trusted command.
 *
 * The payload is built field by field ON PURPOSE. `operatingCompanyId` has no branch here that could
 * ever set it, so there is no path -- accidental or otherwise -- by which the browser sends one.
 */
export async function submitCreateReorderRequest(input, invoke = defaultInvoke) {
  const payload = {
    partId: input.partId,
    warehouseId: input.warehouseId,
    recommendationStatus: input.recommendationStatus,
    quantitySource: input.quantitySource,
    requestedQty: input.requestedQty,
    urgency: input.urgency ?? null,
    recommendedQty: input.recommendedQty ?? null,
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
  };
  if (input.workOrderId != null) payload.workOrderId = input.workOrderId;
  return invoke(REORDER_CALLABLES.createReorderRequest, payload);
}

/** Record the purchase order and flip the request to ORDERED, as one server-side transaction. */
export async function submitRecordReorderPurchaseOrder(input, invoke = defaultInvoke) {
  const payload = {
    reorderRequestId: input.reorderRequestId,
    supplierName: input.supplierName,
    externalPoNumber: input.externalPoNumber,
    orderedQuantity: input.orderedQuantity,
    orderedDate: input.orderedDate,
    expectedArrivalDate: input.expectedArrivalDate ?? null,
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
  };
  return invoke(REORDER_CALLABLES.recordReorderPurchaseOrder, payload);
}

/**
 * The warehouses this signed-in principal may raise a reorder for (Owner ruling R-17).
 *
 * REPLACES a `warehouses` collection LIST, it does not supplement one. `firestore.rules` grants the
 * browser no LIST on that collection and this change does not ask it to: the server reads the
 * warehouses, applies the same eligibility the create enforces, and returns a two-field projection.
 *
 * There is deliberately NO fallback to a direct Firestore read if this fails. A fallback would leave
 * the selector with two read-authority models and would quietly show a user warehouses the create
 * would then refuse -- the exact divergence the shared server-side resolver exists to prevent.
 *
 * Returns `{ options: [{ warehouseId, label }], reason }`. An empty list with a `reason` is a real
 * answer, not an error: a principal may legitimately be governed to no warehouse at all.
 */
export async function fetchReorderWarehouseOptions(invoke = defaultInvoke) {
  const data = await invoke(REORDER_CALLABLES.listReorderWarehouseOptions, {});
  const options = Array.isArray(data?.options) ? data.options : [];
  return {
    // Mapped to the selector's { value, label } shape here rather than in the component, so the
    // component stays presentational and the wire shape stays the server's business.
    options: options
      .filter((o) => typeof o?.warehouseId === "string" && o.warehouseId !== "")
      .map((o) => ({ value: o.warehouseId, label: typeof o.label === "string" && o.label !== "" ? o.label : o.warehouseId })),
    reason: typeof data?.reason === "string" ? data.reason : null,
  };
}
