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

export function mapCycleCountActionError(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return Object.prototype.hasOwnProperty.call(HTTPS_MESSAGE, code) ? HTTPS_MESSAGE[code] : "The cycle count action could not be completed.";
}

export function describeCycleCountOutcome(action, outcome) {
  const verb = { create: "created", submit: "recorded", reconcile: "reconciled", cancel: "cancelled" }[action] ?? action;
  return outcome === "replayed" ? `Already ${verb} (no change made).` : `Cycle count ${verb}.`;
}
