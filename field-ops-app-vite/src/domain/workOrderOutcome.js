// THE ONE WORK ORDER OUTCOME CLASSIFIER -- what a Work Order read, command or boundary MEANS to the person
// looking at it, decided once, here, and rendered by every Work Order surface's message helper
// (loadErrorMessage, workflowActionErrorMessage, schedulingRefusalMessage, WorkOrderAuthorityNotice, the
// technician's Complete action).
//
// Owner ruling (Work Order cutover completion pass, 2026-09-30): "The client should distinguish UNAUTHORIZED,
// NOT_YET_ACTIVATED, INTEGRITY/INVALID_STATE, UNAVAILABLE. Do not present all four as generic errors." They are
// four different facts with four different remedies:
//
//   UNAUTHORIZED       the platform refused THIS caller.            Remedy: ask an administrator.
//   NOT_YET_ACTIVATED  the capability is not switched on for EOS.   Remedy: none today -- it is a readiness state.
//   INTEGRITY          the record's state does not allow this.      Remedy: refresh; the record moved or is invalid.
//   UNAVAILABLE        the service could not answer.                Remedy: try again.
//
// Anything this module cannot recognise is FAILED -- the generic sentence, never a guess at one of the four.
//
// NAMED BOUNDARIES. Within NOT_YET_ACTIVATED, the specific boundaries the ruling names are said as themselves:
//
//   WORK_ORDER_AUTHORITY        server NOT_ACTIVATED: the governed Work Order authority is not switched on
//   COMMERCIAL_FULFILLMENT_HOLD SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE: completing a Sales-Order-linked Work
//                               Order is held (DQ-015) -- it is NOT an outage, although the server answers 503
//   SERIALIZED_INSTALL          Equipment install: not activated on EOS (no Firebase install is invoked)
//   OPERATION_NOT_YET_AVAILABLE NOT_YET_IMPLEMENTED: a reserved operation the server does not serve yet
//
// and the inventory boundaries that ride on SUCCESSFUL results (never failures, never dropped):
//
//   RESERVE_NOT_APPLIED  dispatch reserved no parts       CONSUME_NOT_APPLIED  completion consumed no stock
//   RELEASE_NOT_APPLIED  cancel had nothing to release    NO_STOCK_MOVEMENT    recorded usage moved no stock
//   INVENTORY_READINESS  a readiness read did not consult live stock
//
// Dependency-free (node-importable, unit-tested directly): test/workOrderOutcome.test.mjs.

export const WORK_ORDER_OUTCOME = Object.freeze({
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_YET_ACTIVATED: "NOT_YET_ACTIVATED",
  INTEGRITY: "INTEGRITY",
  UNAVAILABLE: "UNAVAILABLE",
  FAILED: "FAILED",
});

export const WORK_ORDER_BOUNDARY = Object.freeze({
  WORK_ORDER_AUTHORITY: "WORK_ORDER_AUTHORITY",
  COMMERCIAL_FULFILLMENT_HOLD: "COMMERCIAL_FULFILLMENT_HOLD",
  SERIALIZED_INSTALL: "SERIALIZED_INSTALL",
  OPERATION_NOT_YET_AVAILABLE: "OPERATION_NOT_YET_AVAILABLE",
});

/** The server's code for the Commercial fulfillment hold on completing a Sales-Order-linked Work Order. */
export const COMMERCIAL_FULFILLMENT_HOLD_CODE = "SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE";

/** The refusal the client itself states for Equipment install while it is not activated on EOS. */
export const SERIALIZED_INSTALL_NOT_ACTIVATED = Object.freeze({
  code: "NOT_YET_ACTIVATED",
  reason: "SERIALIZED_INSTALL_NOT_ACTIVATED",
  boundary: WORK_ORDER_BOUNDARY.SERIALIZED_INSTALL,
  message: "Equipment install is not activated yet.",
});

export const BOUNDARY_MESSAGES = Object.freeze({
  WORK_ORDER_AUTHORITY:
    "Work Orders are not yet activated on EOS (NOT_YET_ACTIVATED).",
  COMMERCIAL_FULFILLMENT_HOLD:
    "Completion is on hold: this Work Order fulfils a Sales Order, and Commercial fulfillment is not activated on EOS yet, so completing it cannot record that fulfillment.",
  SERIALIZED_INSTALL:
    "Equipment install is not activated yet. Serialized equipment cannot be installed from a Work Order on EOS until the serialized custody authority is switched on.",
  OPERATION_NOT_YET_AVAILABLE:
    "This is not available on EOS yet (NOT_YET_ACTIVATED).",
});

// ── failure classification ──

const UNAUTHORIZED_CODES = new Set([
  "FORBIDDEN", "UNAUTHENTICATED", "NOT_SIGNED_IN", "permission-denied", "unauthenticated",
]);
const INTEGRITY_CODES = new Set([
  "INVALID_INPUT", "PRECONDITION_FAILED", "CONFLICT", "NOT_FOUND",
  "invalid-argument", "failed-precondition", "out-of-range", "not-found", "aborted", "already-exists",
]);
const UNAVAILABLE_CODES = new Set([
  "UNAVAILABLE", "UNREACHABLE", "NOT_CONFIGURED", "UNKNOWN_OPERATION", "unavailable", "deadline-exceeded",
]);

const tail = (code) => (typeof code === "string" && code.includes("/") ? code.split("/").pop() : code);

/**
 * Classify one Work Order failure. Accepts a thrown WorkOrderApiError, a workOrderApiClient failure value
 * ({ ok:false, code, reason, status }), a Firebase-style { code }, or anything else (FAILED).
 *
 * @returns {{ kind: string, boundary: string | null, reason: string | null }}
 */
export function classifyWorkOrderOutcome(err) {
  const code = tail(err && typeof err.code === "string" ? err.code : "");
  const reason = err && typeof err.reason === "string" ? err.reason : null;
  const out = (kind, boundary = null) => Object.freeze({ kind, boundary, reason });

  // The named boundaries first: each is a readiness STATE, whatever transport status carried it.
  if (err && err.boundary === WORK_ORDER_BOUNDARY.SERIALIZED_INSTALL) return out(WORK_ORDER_OUTCOME.NOT_YET_ACTIVATED, WORK_ORDER_BOUNDARY.SERIALIZED_INSTALL);
  if (reason === SERIALIZED_INSTALL_NOT_ACTIVATED.reason) return out(WORK_ORDER_OUTCOME.NOT_YET_ACTIVATED, WORK_ORDER_BOUNDARY.SERIALIZED_INSTALL);
  if (reason === COMMERCIAL_FULFILLMENT_HOLD_CODE || code === COMMERCIAL_FULFILLMENT_HOLD_CODE) {
    return out(WORK_ORDER_OUTCOME.NOT_YET_ACTIVATED, WORK_ORDER_BOUNDARY.COMMERCIAL_FULFILLMENT_HOLD);
  }
  if (code === "NOT_ACTIVATED" || reason === "NOT_ACTIVATED") return out(WORK_ORDER_OUTCOME.NOT_YET_ACTIVATED, WORK_ORDER_BOUNDARY.WORK_ORDER_AUTHORITY);
  if (reason === "NOT_YET_IMPLEMENTED" || code === "NOT_YET_IMPLEMENTED" || code === "NOT_YET_ACTIVATED") {
    return out(WORK_ORDER_OUTCOME.NOT_YET_ACTIVATED, WORK_ORDER_BOUNDARY.OPERATION_NOT_YET_AVAILABLE);
  }
  if (UNAUTHORIZED_CODES.has(code)) return out(WORK_ORDER_OUTCOME.UNAUTHORIZED);
  if (INTEGRITY_CODES.has(code)) return out(WORK_ORDER_OUTCOME.INTEGRITY);
  if (UNAVAILABLE_CODES.has(code)) return out(WORK_ORDER_OUTCOME.UNAVAILABLE);
  return out(WORK_ORDER_OUTCOME.FAILED);
}

/**
 * Safe copy for a classified outcome. `mode` "action" ends every sentence with "Nothing was changed." (a failed
 * action mutated nothing); "load" names what could not be shown. Never a raw code, message or id.
 */
export function workOrderOutcomeMessage(outcome, { mode = "action", entity = "data" } = {}) {
  const o = outcome && outcome.kind ? outcome : classifyWorkOrderOutcome(outcome);
  const suffix = mode === "action" ? " Nothing was changed." : "";
  switch (o.kind) {
    case WORK_ORDER_OUTCOME.NOT_YET_ACTIVATED: {
      if (o.boundary === WORK_ORDER_BOUNDARY.WORK_ORDER_AUTHORITY && mode === "load") {
        return `${BOUNDARY_MESSAGES.WORK_ORDER_AUTHORITY} No ${entity} are shown until the governed Work Order authority is switched on.`;
      }
      return `${BOUNDARY_MESSAGES[o.boundary] ?? BOUNDARY_MESSAGES.OPERATION_NOT_YET_AVAILABLE}${suffix}`;
    }
    case WORK_ORDER_OUTCOME.UNAUTHORIZED:
      return mode === "action"
        ? "You're not allowed to perform this action. Nothing was changed."
        : `You do not have permission to view these ${entity}.`;
    case WORK_ORDER_OUTCOME.INTEGRITY:
      return mode === "action"
        ? "That action isn't valid for this item right now. Nothing was changed."
        : `Couldn't load ${entity}: the record is not in a state this view can read. Refresh and try again.`;
    case WORK_ORDER_OUTCOME.UNAVAILABLE:
      return mode === "action"
        ? "The service is temporarily unavailable. Nothing was changed — please try again."
        : "Can't reach the server right now. Check your connection and try again.";
    default:
      return mode === "action"
        ? "Something went wrong and the action could not be completed. Nothing was changed."
        : `Couldn't load ${entity}. Please try again.`;
  }
}

// ── the inventory boundaries on SUCCESSFUL results ──

export const INVENTORY_BOUNDARY_MESSAGES = Object.freeze({
  RESERVE_NOT_APPLIED: "Dispatched. No parts were reserved: inventory reservation is not activated on EOS yet.",
  CONSUME_NOT_APPLIED: "Completed. No stock was consumed: the recorded parts usage is kept, and stock consumption is not activated on EOS yet.",
  RELEASE_NOT_APPLIED: "Cancelled. No parts reservation existed to release: inventory reservation is not activated on EOS yet.",
  NO_STOCK_MOVEMENT: "Recorded. Parts usage moves no stock: stock movement is not activated on EOS yet.",
  INVENTORY_READINESS: "Parts readiness is not checked against live stock: the Inventory authority is not activated on EOS yet.",
});

/**
 * The boundary CODE carried by a result's `inventoryBoundary` ("CONSUME_NOT_APPLIED: stock consumption is NOT_YET_ACTIVATED ..." or a
 * bare "NO_STOCK_MOVEMENT"), or null. Only a known code is returned: an unknown string is not guessed at.
 */
export function inventoryBoundaryCode(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const code = value.split(":")[0].trim();
  return Object.prototype.hasOwnProperty.call(INVENTORY_BOUNDARY_MESSAGES, code) ? code : null;
}

/** The sentence for a successful result's inventory boundary, or null when there is none to say. */
export function inventoryBoundaryMessage(value) {
  const code = inventoryBoundaryCode(value);
  return code ? INVENTORY_BOUNDARY_MESSAGES[code] : null;
}
