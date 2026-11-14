// Opportunity CREATE FORM — PURE validation + payload builder (no I/O, no JSX; unit-tested). Mirrors the
// governed command's own required-field checks (functions/src/opportunity/opportunityCommands.ts's
// buildCreateOpportunity) closely enough to catch obvious mistakes before a round trip, but is NOT the
// authority — the server re-validates every field and is the sole source of truth. A stale/looser mirror here
// only produces a worse error message, never an unauthorized or malformed write (same posture documented in
// domain/salesOrderActions.js for the Sales Order write mirrors).
//
// Deliberately excludes: solution lines (the create flow seeds accountId/[optional ownerEmployeeId]/salesChannel/
// need/expectedValue/expectedCloseAt only — lines are added afterward via the existing Solution section edit
// once general field editing goes live; CreateOpportunityInput.lines stays optional and unset here) and any
// contactId (Opportunity has no contactId field — see opportunityCommands.ts's CreateOpportunityInput; adding
// a contact picker here would invent a contract that does not exist).

import { SALES_CHANNELS } from "./opportunityLifecycle.js";

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);

// Validates the raw form draft. Returns { ok, errors } where errors is a field-key -> message map (empty when
// ok). Never throws; never partially-succeeds (either every required field is present and well-formed, or the
// caller sees exactly which fields are wrong).
export function validateOpportunityCreateInput(input) {
  const errors = {};
  if (!input || typeof input !== "object") {
    return { ok: false, errors: { form: "Missing form input." } };
  }
  if (!nonEmpty(input.accountId)) {
    errors.accountId = "Select a customer account.";
  }
  // OWNER IS OPTIONAL (Owner ruling D-4, kept 2026-10-21; functions/src/ownership/creationOwnerResolution.ts).
  // Blank -> the server inherits the customer account's owner, or refuses when the account has none. There is
  // NO client default: the signed-in employee is never prefilled or submitted, because the server cannot tell
  // a prefilled id from a deliberate choice and D-4 forbids the creator becoming the owner by acting.
  if (input.ownerEmployeeId != null && typeof input.ownerEmployeeId !== "string") {
    errors.ownerEmployeeId = "Owner must be an employee ID, or left blank.";
  } else if (nonEmpty(input.ownerEmployeeId) && /\s/.test(input.ownerEmployeeId.trim())) {
    errors.ownerEmployeeId = "An employee ID has no spaces. Leave the field blank to use the customer's owner.";
  }
  if (!SALES_CHANNELS.includes(input.salesChannel)) {
    errors.salesChannel = "Select a sales channel.";
  }
  if (input.expectedValue != null && (!finiteNum(input.expectedValue) || input.expectedValue < 0)) {
    errors.expectedValue = "Estimated value must be a non-negative number.";
  }
  if (input.expectedCloseAt != null && !finiteNum(input.expectedCloseAt)) {
    errors.expectedCloseAt = "Expected close date is invalid.";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// Builds the EXACT payload createOpportunity expects from a validated draft (idempotencyKey is added by the
// caller, not here — this module knows nothing about retries/transport). Trims strings; drops an
// empty/whitespace-only `need` rather than sending "" ; null-normalizes the two optional numerics so an
// intentionally-cleared field is sent as `null`, never omitted-vs-null ambiguity.
export function buildOpportunityCreatePayload(input) {
  const payload = {
    accountId: input.accountId.trim(),
    salesChannel: input.salesChannel,
    expectedValue: finiteNum(input.expectedValue) ? input.expectedValue : null,
    expectedCloseAt: finiteNum(input.expectedCloseAt) ? input.expectedCloseAt : null,
  };
  // A blank owner is left OUT of the payload, which the server treats exactly as blank (D-4 inheritance or
  // refusal). An explicit override is sent trimmed and is re-validated server-side.
  if (nonEmpty(input.ownerEmployeeId)) payload.ownerEmployeeId = input.ownerEmployeeId.trim();
  if (nonEmpty(input.need)) payload.need = input.need.trim();
  return payload;
}
