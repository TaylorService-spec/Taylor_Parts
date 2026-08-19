// Enterprise Inventory -- Cycle Count operating authority: PURE mapping of a cycle count callable's
// outcome/error into an honest, human-readable status for the Cycle Counts workspace. No Firebase, no
// I/O. Mirrors domain/transferActionResult.js.

const HTTPS_MESSAGE = Object.freeze({
  "unauthenticated": "You must be signed in to do this.",
  "permission-denied": "You are not authorized to perform this cycle count action.",
  "not-found": "That cycle count could not be found.",
  "failed-precondition": "This cycle count action is not currently permitted (check its status, and whether a reconciliation reason is required).",
  "invalid-argument": "The request was invalid.",
  "internal": "The cycle count action could not be completed.",
});

// M23 blind-count remediation: a plain missing-grant denial and the NEW separation-of-duties refusal
// ("You submitted this count and cannot approve or reject its own material variance…",
// functions/src/cycleCount/cycleCountCallables.ts) both surface as the same "permission-denied" code --
// Firebase's HttpsError plumbing preserves the server's exact message text on err.message, so for THIS
// one code prefer it over the generic table entry (every permission-denied HttpsError this backend
// throws already carries a deliberately written, safe-to-display sentence -- never a raw exception).
// Every other code keeps the fixed table text, matching this function's pre-existing behavior.
export function mapCycleCountActionError(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  if (code === "permission-denied" && typeof err?.message === "string" && err.message.trim() !== "") return err.message;
  return Object.prototype.hasOwnProperty.call(HTTPS_MESSAGE, code) ? HTTPS_MESSAGE[code] : "The cycle count action could not be completed.";
}

export function describeCycleCountOutcome(action, outcome, decision) {
  const verb =
    action === "reconcile"
      ? decision === "REJECT" ? "rejected" : "approved"
      : { create: "created", submit: "recorded", cancel: "cancelled" }[action] ?? action;
  return outcome === "replayed" ? `Already ${verb} (no change made).` : `Cycle count ${verb}.`;
}
