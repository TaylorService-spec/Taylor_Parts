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

// The governed failure class the Transfer callables send as `details.code` (transferCallables.ts
// mapTransferError). The server sends it precisely so a screen can tell "not enough stock at the
// origin" from "those are in the same warehouse -- use a relocation"; mapping only the HTTP code
// collapsed all of them into one generic sentence. Bounded codes only -- never a stored value.
const DETAIL_MESSAGE = Object.freeze({
  INSUFFICIENT_STOCK: "There is not enough stock at the origin for this transfer.",
  SAME_LOCATION: "The origin and destination are the same location.",
  SAME_CUSTODY_PARENT: "Those locations are in the same warehouse — move the stock with a relocation instead of a transfer.",
  ORIGIN_INVALID: "The origin is not a location stock can be transferred from.",
  DESTINATION_INVALID: "The destination is not a location stock can be transferred to.",
  PART_INVALID: "That part cannot be transferred.",
  SERIAL_INVALID: "One or more serial numbers are not valid for this transfer.",
  STATUS_INVALID: "This transfer is not in a state that allows that action.",
  IDEMPOTENCY_CONFLICT: "This request conflicts with an earlier one sent under the same key. Start the action again.",
  // EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): the server's own specific codes.
  NOT_ACTIVATED: "Transfers are not switched on in this environment yet. Nothing was changed.",
  OUTSIDE_OPERATIONAL_SCOPE: "That warehouse is outside your operational scope.",
  WORK_ELIGIBILITY_MISSING: "Transfers require the Warehouse Operations work eligibility.",
  CAPABILITY_MISSING: "You are not authorized to perform this transfer action.",
  EMPLOYEE_LINK_REQUIRED: "Only an Employee can perform transfer actions.",
});

export function mapTransferActionError(err) {
  const detail = err && err.details && typeof err.details === "object" && typeof err.details.code === "string" ? err.details.code : "";
  if (Object.prototype.hasOwnProperty.call(DETAIL_MESSAGE, detail)) return DETAIL_MESSAGE[detail];
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return Object.prototype.hasOwnProperty.call(HTTPS_MESSAGE, code) ? HTTPS_MESSAGE[code] : "The transfer action could not be completed.";
}

export function describeOutcome(action, outcome) {
  const verb = { create: "created", dispatch: "dispatched", receive: "received", cancel: "cancelled" }[action] ?? action;
  return outcome === "replayed" ? `Already ${verb} (no change made).` : `Transfer ${verb}.`;
}
