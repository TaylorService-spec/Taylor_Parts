// Sales Order operational actions -- PURE helpers (no Firebase, no I/O; Node-importable and
// unit-tested), mirroring the three trusted WRITE commands this UI wires up:
//   • transitionSalesOrder  (capability salesOrder.write)  -- functions/src/salesOrder/salesOrderCallables.ts
//   • allocateSalesOrder    (capability salesOrder.fulfill) -- functions/src/fulfillment/allocateSalesOrder.ts
//   • createServiceForSalesOrder (capability salesOrder.service) -- functions/src/salesOrder/createServiceForSalesOrder.ts
//
// The offer-gates below (canAdvance/canCancel/canAllocate/canCreateService) are a CLIENT MIRROR of
// each command's own state precondition (salesOrderLifecycle.ts's checkTransition, and the
// state === CONFIRMED|IN_FULFILLMENT checks in allocateSalesOrder.ts / createServiceForSalesOrder.ts).
// They exist ONLY to decide which button to show -- they are NEVER the security control. Every one of
// these commands re-checks its own precondition server-side and is the sole authority; if this mirror
// ever drifts from the backend, the backend's own check is what actually protects the data (a stale
// mirror only produces a worse error message, never an unauthorized write).
//
// Known gap (documented, not silently papered over): the trusted `getSalesOrderContext` read
// projection (salesOrderReadService.ts) does not expose `allocatedAt`, so canCreateService cannot
// mirror createServiceForSalesOrder's "PART lines require allocation to have run" gate precisely.
// It offers Create Service whenever the state/no-existing-Service preconditions hold; if allocation
// hasn't run, the server rejects with failed-precondition and the UI surfaces that as a normal,
// honest error (never a silent failure or a fabricated success).

const FORWARD = Object.freeze({
  CONFIRMED: "IN_FULFILLMENT",
  IN_FULFILLMENT: "FULFILLED",
  FULFILLED: "CLOSED",
  CLOSED: null,
  CANCELLED: null,
});

const TERMINAL_STATES = new Set(["CLOSED", "CANCELLED"]);
const ACTIVE_FULFILL_STATES = new Set(["CONFIRMED", "IN_FULFILLMENT"]);

// The state ADVANCE would move to, or null if there is none (mirrors salesOrderLifecycle.ts's FORWARD).
export function nextAdvanceState(state) {
  return FORWARD[state] ?? null;
}

// Mirrors checkTransition(state, "ADVANCE", { allLinesFulfilled }).ok.
export function canAdvance(state, { allLinesFulfilled = false } = {}) {
  if (TERMINAL_STATES.has(state)) return false;
  const to = FORWARD[state];
  if (!to) return false;
  if (state === "IN_FULFILLMENT" && allLinesFulfilled !== true) return false;
  return true;
}

// Mirrors checkTransition(state, "CANCEL").ok -- CANCEL is illegal once FULFILLED (return/credit, not cancel).
export function canCancel(state) {
  if (TERMINAL_STATES.has(state)) return false;
  if (state === "FULFILLED") return false;
  return true;
}

// Mirrors allocateSalesOrder.ts's `so.state !== "CONFIRMED" && so.state !== "IN_FULFILLMENT"` guard.
export function canAllocate(state) {
  return ACTIVE_FULFILL_STATES.has(state);
}

// Mirrors createServiceForSalesOrder.ts's state guard + its "already has Service Work Order(s)"
// idempotency guard. Does NOT (cannot) mirror the allocatedAt gate -- see the file header.
export function canCreateService(state, { serviceWorkOrderIds = [] } = {}) {
  if (!ACTIVE_FULFILL_STATES.has(state)) return false;
  if (Array.isArray(serviceWorkOrderIds) && serviceWorkOrderIds.length > 0) return false;
  return true;
}

// ---- Governed outcome mapping ----
// Map a callable HttpsError `code` to a stable UI outcome + a human, SAFE message -- never a raw
// provider detail. The client never invents a success: a resolved callable is "applied"/"replayed"
// per the command's own outcome (identical convention to domain/partMasterWrite.js).
const CODE_OUTCOMES = Object.freeze({
  "permission-denied": { kind: "denied", message: "You are not authorized to perform this action on this Sales Order." },
  unauthenticated: { kind: "denied", message: "You must be signed in." },
  "invalid-argument": { kind: "invalid", message: "That request was invalid. Reload and try again." },
  "not-found": { kind: "notFound", message: "This Sales Order no longer exists. Reload the page." },
  "failed-precondition": { kind: "invalid", message: "That action isn't allowed for this Sales Order's current state. Reload to see the latest state." },
  internal: { kind: "error", message: "The request could not be completed. Try again." },
});

export function outcomeFromErrorCode(code) {
  return CODE_OUTCOMES[code] ?? { kind: "error", message: "The request could not be completed. Try again." };
}

// transitionSalesOrder resolves { success, replayed, salesOrderId, state }.
export function outcomeFromTransitionResult(data) {
  if (!data || typeof data.state !== "string") return { kind: "error", message: "The request could not be completed. Try again." };
  return {
    kind: data.replayed ? "replayed" : "applied",
    state: data.state,
    message: data.replayed ? "Already recorded (no change)." : "Updated.",
  };
}

// allocateSalesOrder resolves { success, salesOrderId, readiness, counts }.
export function outcomeFromAllocateResult(data) {
  if (!data || typeof data.readiness !== "string") return { kind: "error", message: "The request could not be completed. Try again." };
  return { kind: "applied", readiness: data.readiness, counts: data.counts ?? null, message: "Allocation updated." };
}

// createServiceForSalesOrder resolves { success, salesOrderId, workOrderId, woNumber }.
export function outcomeFromServiceResult(data) {
  if (!data || typeof data.workOrderId !== "string") return { kind: "error", message: "The request could not be completed. Try again." };
  return { kind: "applied", workOrderId: data.workOrderId, woNumber: data.woNumber ?? null, message: "Service Work Order created." };
}
