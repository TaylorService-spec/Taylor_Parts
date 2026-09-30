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

// The governed EOS Work Order route (services/workOrderService.ts) throws a WorkOrderApiError whose
// `code` is a category. Mapped onto the same messages; INVALID_INPUT appends the server's validation
// message the same way invalid-argument always did, and NOT_ACTIVATED is said as the readiness state.
export const CREATE_NOT_ACTIVATED_MESSAGE =
  "Work Orders are not yet activated on EOS (NOT_YET_ACTIVATED). No Work Order was created.";
const EOS_CREATE_CATEGORY = Object.freeze({
  NOT_CONFIGURED: "functions/unavailable",
  UNREACHABLE: "functions/unavailable",
  UNAVAILABLE: "functions/unavailable",
  UNAUTHENTICATED: "functions/unauthenticated",
  NOT_SIGNED_IN: "functions/unauthenticated",
  FORBIDDEN: "functions/permission-denied",
  INVALID_INPUT: "functions/invalid-argument",
  PRECONDITION_FAILED: "functions/invalid-argument",
  NOT_FOUND: "functions/invalid-argument",
  CONFLICT: "functions/invalid-argument",
  INTERNAL: "functions/internal",
});

export const CREATE_IDEMPOTENCY_KEY_REUSED_MESSAGE =
  "An earlier attempt from this form already created a Work Order with different details, so nothing new was created. " +
  "Review the details; pressing Create again will submit them as a new Work Order.";

export function getWizardCreateErrorMessage(err) {
  if (err?.code === "NOT_ACTIVATED") return CREATE_NOT_ACTIVATED_MESSAGE;
  if (err?.reason === "IDEMPOTENCY_KEY_REUSED") return CREATE_IDEMPOTENCY_KEY_REUSED_MESSAGE;
  const code = EOS_CREATE_CATEGORY[err?.code] ?? err?.code ?? "";
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
      // The governed createWorkOrder command requires a Work Order type (workOrderType); a complaint
      // alone is no longer enough.
      void complaint;
      return type ? null : "Choose a Type to continue.";
    default:
      return null; // step 4 gates on the submit itself, not a field requirement
  }
}

// THE OPERATING COMPANY. The governed createWorkOrder command requires an explicit, governed
// operatingCompanyId (OPERATING_COMPANY_REQUIRED) and infers nothing. The choices come ONLY from the governed
// listWorkOrderOperatingCompanies read (the tenant's ACTIVE companies with an ACTIVE key binding). A list of
// one is preselected but still SHOWN as the stated company -- an explicit choice from a list of one, not an
// inference. None, a refused read, or NOT_ACTIVATED keeps Create refused, naming the missing company.
export const WIZARD_COMPANY_UNAVAILABLE_MESSAGE =
  "Work Order creation is refused: the operating company for this Work Order is missing. No governed operating-company choice is available to this screen, and EOS never infers one.";
export const WIZARD_COMPANY_CHOICE_REQUIRED_MESSAGE = "Choose the operating company this Work Order belongs to.";

export const COMPANY_READ = Object.freeze({ LOADING: "LOADING", READY: "READY", FAILED: "FAILED" });

/**
 * The company step's state from the governed read. Pure.
 * Returns { options, preselectedId, mustChoose }: `preselectedId` only for a list of exactly one.
 */
export function companyChoice({ status, companies } = {}) {
  const options = status === COMPANY_READ.READY && Array.isArray(companies)
    ? companies.filter((c) => c && typeof c.operatingCompanyId === "string" && c.operatingCompanyId.trim() !== "")
    : [];
  return {
    options,
    preselectedId: options.length === 1 ? options[0].operatingCompanyId : null,
    mustChoose: options.length > 1,
  };
}

/**
 * Why the Create button is blocked, or null. Pure. `options` is the governed list; the chosen id must be
 * one of them (a stale or foreign id is never sent).
 */
export function createBlockedReason({ operatingCompanyId, options = null } = {}) {
  const list = Array.isArray(options) ? options : null;
  if (list && list.length === 0) return WIZARD_COMPANY_UNAVAILABLE_MESSAGE;
  const chosen = typeof operatingCompanyId === "string" ? operatingCompanyId.trim() : "";
  if (!chosen) return list && list.length > 1 ? WIZARD_COMPANY_CHOICE_REQUIRED_MESSAGE : WIZARD_COMPANY_UNAVAILABLE_MESSAGE;
  if (list && !list.some((c) => c.operatingCompanyId === chosen)) return WIZARD_COMPANY_CHOICE_REQUIRED_MESSAGE;
  return null;
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
