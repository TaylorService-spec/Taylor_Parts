// Enterprise Inventory Phase 4 -- PURE mapping of a transfer callable's outcome/error into an
// honest, human-readable status for the Transfers workspace. No Firebase, no I/O.

const HTTPS_MESSAGE = Object.freeze({
  "unauthenticated": "You must be signed in to do this.",
  "permission-denied": "You are not authorized to perform this transfer action.",
  "not-found": "That transfer order could not be found.",
  "failed-precondition": "This transfer action is not currently permitted (check its status, origin/destination, and stock).",
  "invalid-argument": "The request was invalid.",
  "internal": "The transfer action could not be completed.",
});

export function mapTransferActionError(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return Object.prototype.hasOwnProperty.call(HTTPS_MESSAGE, code) ? HTTPS_MESSAGE[code] : "The transfer action could not be completed.";
}

export function describeOutcome(action, outcome) {
  const verb = { create: "created", dispatch: "dispatched", receive: "received", cancel: "cancelled" }[action] ?? action;
  return outcome === "replayed" ? `Already ${verb} (no change made).` : `Transfer ${verb}.`;
}
