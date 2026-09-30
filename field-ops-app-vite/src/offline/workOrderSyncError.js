// The governed EOS Work Order route (services/workOrderService.ts) throws a WorkOrderApiError whose
// `code` is a CATEGORY and whose `reason` is the server's specific code. The sync executor classifies
// TRANSPORT codes (syncFailureClassification.js), so each category is translated to the transport code
// that means the same thing. NOT_ACTIVATED is a wait, not a refusal, so it stays retryable ("unavailable").
// Pure, dependency-free.
const TRANSPORT_BY_CATEGORY = Object.freeze({
  INVALID_INPUT: "invalid-argument",
  FORBIDDEN: "permission-denied",
  UNAUTHENTICATED: "unauthenticated",
  NOT_SIGNED_IN: "unauthenticated",
  NOT_FOUND: "not-found",
  CONFLICT: "failed-precondition",
  PRECONDITION_FAILED: "failed-precondition",
  NOT_ACTIVATED: "unavailable",
  UNAVAILABLE: "unavailable",
  UNREACHABLE: "unavailable",
  NOT_CONFIGURED: "unavailable",
  INTERNAL: "internal",
});

/** A thrown Work Order command error as the executor's { code, details }. */
export const workOrderSyncError = (err) => ({
  code: TRANSPORT_BY_CATEGORY[err?.code] ?? err?.code ?? null,
  details: err?.reason ?? err?.details ?? null,
});
