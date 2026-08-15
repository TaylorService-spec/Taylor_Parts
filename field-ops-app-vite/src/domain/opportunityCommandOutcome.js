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

export function outcomeFromErrorCode(code) {
  return CODE_OUTCOMES[code] ?? { kind: "error", message: "The request could not be completed. Try again." };
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
