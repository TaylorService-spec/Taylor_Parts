// AUTH-UI-3 -- pure view-model that composes the sanitized eligible-user list,
// per-target eligibility, and the reset action state into render-ready data for
// AdminUsers.jsx. All firebase lives behind the injected `listFn` / controller
// (access/adminPasswordResetClient.js), so this module is fully node-testable
// (matches the codebase's "pure view-model in domain/, thin JSX" pattern).
//
// Truthfulness (DECISIONS #56): no field here ever exposes an email, reset link,
// action code, token, or provider body, and no label claims delivery. Client
// eligibility is a usability filter only -- the backend is the security
// boundary (AUTH-PR-3.5 enforces disabled/break-glass/linkage/final-admin).
import {
  RESET_RESULT,
  resultMessage,
  ariaForState,
  ACTION_PHASE,
  deriveTargetEligibility,
  describeTargetUser,
  ELIGIBILITY_REASON_COPY,
} from "./adminPasswordReset.js";

export const RESET_SECTION_TITLE = "Password reset";
export const RESET_ACTION_LABEL = "Send password reset";
export const RESET_CONFIRM_TITLE = "Send password reset?";
export const RESET_UNAVAILABLE_COPY =
  "The eligible-user list requires the trusted backend, which is not deployed and verified yet. " +
  "This surface will show live content once that backend ships and is verified.";

// Build render-ready rows from the sanitized list result. Each row carries only
// safe display fields + a client eligibility verdict and its user-facing reason.
export function buildResetUserRows(users, actorUid) {
  if (!Array.isArray(users)) return [];
  return users.map((u) => {
    const safe = describeTargetUser(u);
    const eligibility = deriveTargetEligibility(u, actorUid);
    return {
      ...safe,
      eligible: eligibility.eligible,
      ineligibleReason: eligibility.reason,
      ineligibleReasonCopy: eligibility.reason ? ELIGIBILITY_REASON_COPY[eligibility.reason] : null,
    };
  });
}

// Load + compose the eligible-user list via the injected seam list function.
// Resolves (never rejects) to one of:
//   { ok:true, rows }                 -- listed successfully (rows may be empty)
//   { ok:false, result }              -- unavailable/denied/etc. (sanitized state)
export async function loadEligibleUsers(listFn, actorUid, options = {}) {
  let outcome;
  try {
    outcome = await listFn(options);
  } catch {
    // A seam that unexpectedly throws is treated as unavailable, never fatal.
    return { ok: false, result: RESET_RESULT.SERVICE_UNAVAILABLE };
  }
  if (outcome && outcome.ok === true) {
    return { ok: true, rows: buildResetUserRows(outcome.users, actorUid) };
  }
  const result = outcome && typeof outcome.result === "string" ? outcome.result : RESET_RESULT.SERVICE_UNAVAILABLE;
  return { ok: false, result };
}

// Whether the confirm/submit control is actionable for a given row + state.
export function canSubmitReset(row, actionState, inFlight) {
  return (
    !!row &&
    row.eligible === true &&
    !inFlight &&
    (actionState.phase === ACTION_PHASE.IDLE ||
      actionState.phase === ACTION_PHASE.CONFIRMING ||
      actionState.phase === ACTION_PHASE.DONE)
  );
}

// The display props for the current action state -- message + a11y attributes +
// a coarse tone the renderer can style. Never returns a link/token/email.
export function resetStatusView(actionState) {
  if (actionState.phase !== ACTION_PHASE.DONE || actionState.result == null) {
    return {
      show: actionState.phase === ACTION_PHASE.SUBMITTING,
      message: actionState.phase === ACTION_PHASE.SUBMITTING ? "Submitting…" : "",
      tone: "info",
      aria: ariaForState(actionState),
    };
  }
  const tone =
    actionState.result === RESET_RESULT.REQUEST_ACCEPTED
      ? "success"
      : actionState.result === RESET_RESULT.DENIED
        ? "error"
        : "warning";
  return { show: true, message: resultMessage(actionState.result), tone, aria: ariaForState(actionState) };
}
