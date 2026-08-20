// Opportunity WRITE commands — PURE outcome/error mapping (no I/O; unit-tested). Mirrors
// domain/salesOrderActions.js's "Governed outcome mapping" section exactly, for the two Opportunity write
// callables (functions/src/opportunity/opportunityCallables.ts's createOpportunity / transitionOpportunity).
// The client never invents a success: a resolved callable is "applied"/"replayed" per the command's own
// result; a callable HttpsError code maps to a stable, safe, human message — never a raw provider detail.

const CODE_OUTCOMES = Object.freeze({
  "permission-denied": { kind: "denied", message: "You are not authorized to write Opportunities." },
  unauthenticated: { kind: "denied", message: "You must be signed in." },
  "invalid-argument": { kind: "invalid", message: "That request was invalid. Reload and try again." },
  "not-found": { kind: "notFound", message: "This Opportunity no longer exists. Reload the page." },
  // Covers ALREADY_CLOSED / ILLEGAL_TRANSITION / OUTCOME_REQUIRES_DECISION / NO_LINES /
  // LINE_QTY_REQUIRED_FOR_WON — every one of these maps to failed-precondition server-side
  // (opportunityCallables.ts's mapCommandError). The client-side legality mirror
  // (domain/opportunityLifecycle.js's allowedActions) only mirrors the stage graph, not the WON
  // line-qty guard, so a WON attempt on a qty-less-line Opportunity can legitimately land here even
  // though the client thought it was offering a legal action — an honest, known gap (same posture as
  // domain/salesOrderActions.js's documented createService/allocation gap), not a silent failure.
  "failed-precondition": { kind: "invalid", message: "That action isn't allowed for this Opportunity's current state. Reload to see the latest state." },
  internal: { kind: "error", message: "The request could not be completed. Try again." },
});

// DOMAIN-CODE outcomes, keyed by what the callable put in `details`. These are strictly more
// specific than the HttpsError code they arrive under, and each one exists because the generic
// message was wrong rather than merely vague:
//   VERSION_CONFLICT — someone else saved first. Not a malformed request; telling the user their
//     input was invalid sends them hunting for a mistake they did not make. `kind: "conflict"`
//     so the surface can offer reload-and-reapply and keep the typed draft on screen.
//   CLOSED — a WON/LOST Opportunity is a historical record. Editing its deal terms would silently
//     disagree with the Sales Order already derived from them.
//   NO_CHANGES — nothing was actually changed. A statement about the request, not a failure of it,
//     so it reads as information rather than an error.
// Anything absent here falls through to the HttpsError-code message, unchanged.
const DETAIL_OUTCOMES = Object.freeze({
  VERSION_CONFLICT: {
    kind: "conflict",
    message: "Someone else saved this Opportunity while you were editing. Reload to see their changes, then reapply yours.",
  },
  CLOSED: { kind: "invalid", message: "This Opportunity is closed and its details can no longer be edited." },
  NO_CHANGES: { kind: "noop", message: "No changes to save." },
  OWNER_REQUIRED: { kind: "invalid", message: "An Opportunity must have an owner." },
  ACCOUNT_REQUIRED: { kind: "invalid", message: "An Opportunity must have a customer." },
  CHANNEL_INVALID: { kind: "invalid", message: "That is not a recognized sales channel." },
  LINE_INVALID: { kind: "invalid", message: "One of the solution lines is incomplete. Each line needs a kind and a reference." },
  SERIALIZED_LINE_FORBIDDEN: {
    kind: "invalid",
    message: "Solution lines reference a product, model or part — not a specific serialized unit. That is decided at fulfillment.",
  },
});

export function outcomeFromErrorCode(code, detail = null) {
  return (
    (detail ? DETAIL_OUTCOMES[detail] : null) ??
    CODE_OUTCOMES[code] ??
    { kind: "error", message: "The request could not be completed. Try again." }
  );
}

// updateOpportunity resolves { success, replayed, opportunityId, changed: string[] }.
export function outcomeFromUpdateResult(data) {
  if (!data || typeof data.opportunityId !== "string") {
    return { kind: "error", message: "The request could not be completed. Try again." };
  }
  const changed = Array.isArray(data.changed) ? data.changed : [];
  return {
    kind: data.replayed ? "replayed" : "applied",
    opportunityId: data.opportunityId,
    changed,
    // A replay is reported as a replay rather than as a fresh save. The two are different
    // facts and the honest one is cheap to state.
    message: data.replayed ? "Already saved (no change)." : "Saved.",
  };
}

// createOpportunity resolves { success, replayed, opportunityId, stage }.
export function outcomeFromCreateResult(data) {
  if (!data || typeof data.opportunityId !== "string") {
    return { kind: "error", message: "The request could not be completed. Try again." };
  }
  return {
    kind: data.replayed ? "replayed" : "applied",
    opportunityId: data.opportunityId,
    stage: data.stage ?? null,
    message: data.replayed ? "Already recorded (no change)." : "Opportunity created.",
  };
}

// transitionOpportunity resolves { success, replayed, opportunityId, stage, outcome }.
export function outcomeFromTransitionResult(data) {
  if (!data || typeof data.opportunityId !== "string") {
    return { kind: "error", message: "The request could not be completed. Try again." };
  }
  return {
    kind: data.replayed ? "replayed" : "applied",
    opportunityId: data.opportunityId,
    stage: data.stage ?? null,
    outcome: data.outcome ?? null,
    message: data.replayed ? "Already recorded (no change)." : "Updated.",
  };
}
