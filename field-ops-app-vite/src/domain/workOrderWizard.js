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

// Create-call error messaging -- moved verbatim from the component so it is
// unit-testable and shares its constants with the wizard. Two genuinely
// different failure shapes are distinguished (see the component's header for
// the full Firebase-callable rationale):
//   (A) the callable can't be reached at all (not deployed / network) -- the
//       ONLY case where "service is not currently available" is true; vs
//   (B) the callable ran but rejected the call (bad input / permission /
//       runtime) -- shown with its own safe, deliberately-authored message
//       appended when present (HttpsError messages are safe user-facing
//       strings, never raw stack traces).
export const CALLABLE_UNAVAILABLE_CODES = new Set(["functions/not-found", "functions/unavailable"]);
export const CREATE_UNAVAILABLE_MESSAGE = "Work Order creation service is not currently available in this environment.";
export const CREATE_FAILED_MESSAGE = "Work Order could not be created. Please check the details and try again.";

export function getWizardCreateErrorMessage(err) {
  const code = err?.code ?? "";
  if (CALLABLE_UNAVAILABLE_CODES.has(code)) {
    return CREATE_UNAVAILABLE_MESSAGE;
  }
  const safeDetail = typeof err?.message === "string" && err.message.trim() ? err.message.trim() : null;
  return safeDetail ? `${CREATE_FAILED_MESSAGE} ${safeDetail}` : CREATE_FAILED_MESSAGE;
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
