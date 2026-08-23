// WHAT A WAREHOUSE WORKER IS TOLD ABOUT WORK THAT HAS NOT LANDED.
//
// ============================ A CONFLICT CARD IS AN OBJECT, NOT A SENTENCE ============================
//
// The technician's conflict card is prose, and prose is right there: a note either saved or did not,
// and there is one thing to say about it. A warehouse conflict is different — a person needs to know
// WHICH FIELD MOVED. Part? Quantity? Destination? Which transfer? Was it the source that changed or
// the status?
//
// So a warehouse conflict renders as discrete fields, per the structured-object standard. This is
// the case that standard exists for: at the exact moment somebody has to make a decision, they need
// attributes they can compare, not a line they have to parse.
//
// ============================ TWO STATUSES, AND THEY ARE NOT THE SAME FACT ============================
//
//     Transfer Status : Requested        <- what the BUSINESS says the transfer is
//     Sync Status     : Pending          <- what THIS DEVICE has managed to send
//
// Collapsing them would produce a screen that cannot distinguish "the transfer has not been
// dispatched" from "your dispatch has not been sent", which are opposite problems with opposite
// fixes. They are always two fields.
import { field, statusField, FIELD_KIND } from "../domain/structuredFields.js";
import { statusFor } from "./syncPresentation.js";
import { WAREHOUSE_INTENT_LABEL } from "./warehouseIntent.js";

/** Why the platform said no, in words about the WORLD rather than about the transport. */
const REASON_BY_DETAIL = Object.freeze({
  TRANSFER_CANCELLED: {
    happened: "That transfer was cancelled while you were offline.",
    next: "Nothing was moved. Check with whoever cancelled it before moving stock.",
  },
  AWAITING_DISPATCH: {
    happened: "This transfer has not been sent from the other end yet.",
    next: "Nothing to do — it will go through once the other end dispatches it.",
  },
  BIN_NOT_ACTIVE: {
    happened: "That bin is no longer in use.",
    next: "Scan a different bin. Do not put the stock down until it is recorded somewhere real.",
  },
  CYCLE_COUNT_CANCELLED: {
    happened: "That count was cancelled.",
    next: "Your numbers are kept here. Ask your manager whether a new count is needed.",
  },
  CYCLE_COUNT_ALREADY_RECONCILED: {
    happened: "That count was already reviewed and closed.",
    next: "Your numbers are kept here, but they cannot be added now. Show them to your manager.",
  },
  OVER_RECEIPT: {
    happened: "More was received than the order still expects — somebody else received part of it.",
    next: "Recount what you physically have, then receive the remainder.",
  },
  DUPLICATE_SERIAL: {
    happened: "That serial number was already received.",
    next: "Check the unit in your hands. Two units cannot share a serial.",
  },
  SERIAL_ALREADY_RECEIVED: {
    happened: "That serial number was already received.",
    next: "Check the unit in your hands. Two units cannot share a serial.",
  },
  IDEMPOTENCY_CONFLICT: {
    happened: "This was sent once already, with different numbers.",
    next: "A manager has to decide which is right. Nothing was changed.",
  },
  PERMISSION_DENIED: {
    happened: "You are not authorized to do this.",
    next: "Your work is kept here. Ask your manager to record it.",
  },
  RECEIVE_FAILED: {
    happened: "The platform would not accept this receipt.",
    next: "Your scan is kept here. Report it if it keeps happening.",
  },
});

const REASON_BY_CODE = Object.freeze({
  "permission-denied": REASON_BY_DETAIL.PERMISSION_DENIED,
  unauthenticated: {
    happened: "You were signed out before this could be sent.",
    next: "Sign in again — your work is still here.",
  },
  "invalid-argument": {
    happened: "The platform would not accept the details of this.",
    next: "Report it. Nothing was changed, and your entry is still here.",
  },
  "not-found": {
    happened: "The record this belongs to could not be found.",
    next: "Check with your manager — it may have been removed.",
  },
});

const UNKNOWN = Object.freeze({
  happened: "The platform did not accept this, and did not say why.",
  next: "It stays here. Try again, or report it if it keeps happening.",
});

/** The order references are shown in. Identity first, then what, then where. */
const REFERENCE_ORDER = Object.freeze([
  "Transfer", "Cycle count", "Work order", "Source", "Part", "Serial", "Quantity",
  "Condition", "Location", "Destination",
]);

/**
 * One conflicted or refused warehouse intent, as fields.
 *
 * @param intent        the queued intent.
 * @param domainStatus  the CURRENT business status of the record, where the caller could read one.
 *                      Deliberately separate from the sync status — see the header.
 */
export function warehouseConflictCard(intent, { domainStatus = null, domainStatusLabel = "Status" } = {}) {
  const detail = intent?.lastServerError?.details;
  const code = intent?.lastServerError?.code;
  const reason = (detail && REASON_BY_DETAIL[String(detail).toUpperCase()])
    ?? (code && REASON_BY_CODE[String(code).replace(/^functions\//, "")])
    ?? UNKNOWN;

  const references = intent?.references ?? {};
  const referenceFields = REFERENCE_ORDER
    // A reference nobody recorded is omitted rather than rendered as an empty row: unlike an object's
    // own attributes, these vary legitimately by intent type, and "Serial: Not recorded" on a
    // quantity-tracked part would be noise pretending to be information.
    .filter((label) => references[label] !== null && references[label] !== undefined && references[label] !== "")
    .map((label) => (label === "Quantity"
      ? field({ label, value: String(references[label]), raw: references[label], kind: FIELD_KIND.QUANTITY })
      : field({ label, value: String(references[label]), raw: references[label], kind: FIELD_KIND.IDENTIFIER })));

  return Object.freeze({
    intentId: intent.intentId,
    attempted: WAREHOUSE_INTENT_LABEL[intent.type] ?? intent.type,
    fields: Object.freeze([
      ...referenceFields,
      // TWO STATUSES, ALWAYS. The business's, and this device's.
      ...(domainStatus ? [statusField(domainStatus, { label: domainStatusLabel })] : []),
      field({ label: "Sync status", value: statusFor(intent).label, raw: intent.state, kind: FIELD_KIND.STATUS }),
    ]),
    happened: reason.happened,
    // The first fear at this moment is that the work is gone. It never is, and saying so every time
    // is the difference between somebody reporting a problem and quietly re-doing it by hand.
    preserved: "Your work is kept on this phone. Nothing has been lost.",
    next: reason.next,
    /** For a support conversation, one level deeper. Never the headline. */
    technical: Object.freeze({ code: code ?? null, details: detail ?? null, attempts: intent.attemptCount }),
  });
}

/**
 * A queued warehouse intent that is simply waiting, as fields.
 *
 * Same field discipline as a conflict, because "what is this and where is it going" is the question
 * either way — a person scanning a queue should not have to switch reading modes between the two.
 */
export function warehousePendingCard(intent) {
  const references = intent?.references ?? {};
  return Object.freeze({
    intentId: intent.intentId,
    attempted: WAREHOUSE_INTENT_LABEL[intent.type] ?? intent.type,
    fields: Object.freeze([
      ...REFERENCE_ORDER
        .filter((label) => references[label] !== null && references[label] !== undefined && references[label] !== "")
        .map((label) => field({ label, value: String(references[label]), raw: references[label] })),
      field({ label: "Sync status", value: statusFor(intent).label, raw: intent.state, kind: FIELD_KIND.STATUS }),
    ]),
  });
}
