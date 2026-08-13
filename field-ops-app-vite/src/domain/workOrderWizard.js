// Work Order Wizard -- PURE, UI-agnostic helpers for the creation wizard:
// the step model (for the progress indicator), the per-step "can this advance,
// and if not, why" rule, and the create-call error messaging. No React/Firebase
// import, so all of this is directly unit-testable in Node (same pattern as
// domain/accountPortfolio.js). modules/workOrders/WorkOrderWizard.jsx owns all
// state/effects; this file owns the copy and the gating rule so the two can't
// drift (a disabled "Next" and its inline explanation come from ONE source).

export const WIZARD_STEPS = [
  { n: 1, label: "Customer" },
  { n: 2, label: "Location" },
  { n: 3, label: "Service Details" },
  { n: 4, label: "Review & Create" },
];

export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

// Create-call error messaging -- an EXPLICIT map from the Firebase callable's
// error.code to a user-facing message. Each class of failure gets its own
// actionable message, and ONLY invalid-argument's server message (a
// deliberately-authored, safe validation string -- e.g. "customerId is
// required.") is ever surfaced to the user. internal/unknown detail is NEVER
// appended (it can carry raw runtime text), and any unrecognized code fails
// closed to the generic message with nothing appended.
export const CREATE_UNAVAILABLE_MESSAGE = "Work Order creation service is not currently available in this environment.";
export const CREATE_UNAUTHENTICATED_MESSAGE = "You must be signed in to create a Work Order. Please sign in and try again.";
export const CREATE_PERMISSION_DENIED_MESSAGE = "You do not have permission to create a Work Order for this customer.";
export const CREATE_FAILED_MESSAGE = "Work Order could not be created. Please check the details and try again.";
export const CREATE_INTERNAL_MESSAGE = "Work Order could not be created due to an unexpected error. No Work Order was created -- please try again.";

// The codes whose server message is safe to append (validation feedback only).
const APPENDABLE_DETAIL_CODES = new Set(["functions/invalid-argument"]);

function safeServerDetail(err) {
  return typeof err?.message === "string" && err.message.trim() ? err.message.trim() : null;
}

export function getWizardCreateErrorMessage(err) {
  const code = err?.code ?? "";
  switch (code) {
    case "functions/not-found":
    case "functions/unavailable":
      return CREATE_UNAVAILABLE_MESSAGE;
    case "functions/unauthenticated":
      return CREATE_UNAUTHENTICATED_MESSAGE;
    case "functions/permission-denied":
      return CREATE_PERMISSION_DENIED_MESSAGE;
    case "functions/invalid-argument": {
      const detail = APPENDABLE_DETAIL_CODES.has(code) ? safeServerDetail(err) : null;
      return detail ? `${CREATE_FAILED_MESSAGE} ${detail}` : CREATE_FAILED_MESSAGE;
    }
    case "functions/internal":
    case "functions/unknown":
      // Never append raw internal/unknown detail -- state failure + that no
      // record was created, nothing more.
      return CREATE_INTERNAL_MESSAGE;
    default:
      // Unrecognized code: fail closed, no untrusted detail appended.
      return CREATE_FAILED_MESSAGE;
  }
}

// Why the current step is not yet ready to advance -- a single, human-readable
// requirement string, or null when the step CAN advance. The component both
// renders this inline (so a disabled control always explains itself) and drives
// the control's disabled state from it (reason === null), so "can advance" has
// exactly one definition. `state` carries only primitives/booleans the caller
// already has, keeping this free of any React/Firestore shape.
export function stepBlockedReason(step, state = {}) {
  const { selectedAccountId, hasLocations, selectedLocationId, type, complaint } = state;
  switch (step) {
    case 1:
      return selectedAccountId ? null : "Search for and select a customer to continue.";
    case 2:
      if (!hasLocations) {
        return "This customer has no locations yet. Add one from the Customer Detail page first.";
      }
      return selectedLocationId ? null : "Select a location to continue.";
    case 3:
      return type || (complaint ?? "").trim() ? null : "Choose a Type, or enter a Complaint, to continue.";
    default:
      return null; // step 4 gates on the submit itself, not a field requirement
  }
}

export function canAdvance(step, state) {
  return stepBlockedReason(step, state) === null;
}

// site-work #2 -- wo-wizard-missing-idempotency-key. createWorkOrder (functions/src/createWorkOrder.ts)
// fully supports an optional idempotencyKey: a retry/double-submit carrying the SAME key replays the
// already-created Work Order instead of minting a duplicate and burning a WO number. The wizard was never
// sending one. Same key-shape convention as domain/truckManagement.js's makeIdempotencyKey (crypto.randomUUID,
// with a browser-safe fallback), just prefixed for this domain.
export function makeWorkOrderIdempotencyKey() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `wo_${c.randomUUID()}`;
  return `wo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

// Stable-per-submission key holder: getKey() returns the SAME key on every call until reset() is
// called. Pulled out as a pure, injectable-factory helper (not inlined as component state) so the
// "generate once, reuse on retry -- never regenerate on a second click/network retry" rule is
// unit-testable without rendering React. WorkOrderWizard.jsx keeps exactly one instance of this per
// mount (via useRef) so every createWorkOrder() call from a given wizard session -- including a retry
// after a failed attempt -- carries the same idempotencyKey.
export function createIdempotencyKeyHolder(factory = makeWorkOrderIdempotencyKey) {
  let current = null;
  return {
    getKey() {
      if (!current) current = factory();
      return current;
    },
    reset() {
      current = null;
    },
  };
}
