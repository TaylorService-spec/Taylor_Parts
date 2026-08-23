// WHAT A TECHNICIAN IS TOLD ABOUT WORK THAT HAS NOT LANDED.
//
// ============================ THE RULE THIS FILE EXISTS TO KEEP ============================
//
// A refusal is not an error message. It is a situation, and the person reading it is standing in a
// plant room with a box in their hands deciding what to do next. So every entry below answers four
// questions in the technician's own terms:
//
//   what did I try     because by the time they see this, they have done six other things
//   what happened      in the world, not in the transport
//   what is kept       so they know their work was not thrown away
//   what now           an action, or an honest "somebody else has to"
//
// ============================ NO RAW CODES AS PRIMARY COPY ============================
//
// `permission-denied` and `ASSET_INSTALLED_ELSEWHERE` are facts for a diagnostic, not sentences for a
// person. Both are preserved — see intentQueue.js's diagnosticView — and neither is ever the headline.
//
// ============================ STATUS IS NEVER COLOUR ALONE ============================
//
// Every status carries a word. A phone in direct sunlight, a colour-blind technician and a greyscale
// screenshot in a support ticket all have to be able to tell Pending from Conflict.
import { SYNC_STATE, SYNC_PRESENTATION } from "../domain/technicianHandheld.js";
import { INTENT_TYPE } from "./technicianIntent.js";
import { HOLD_REASON } from "./intentQueue.js";

/** What each intent type is called on a phone. Never the enum. */
export const INTENT_LABEL = Object.freeze({
  [INTENT_TYPE.NOTE_ADD]: "Note",
  [INTENT_TYPE.LABOR_RECORD]: "Time",
  [INTENT_TYPE.PARTS_USAGE]: "Parts used",
  [INTENT_TYPE.EQUIPMENT_INSTALL]: "Installation",
  [INTENT_TYPE.WORK_ORDER_COMPLETE]: "Finishing the job",
});

/** The status word, plus whether it is allowed to imply the work is real. */
export function statusFor(intent) {
  const p = SYNC_PRESENTATION[intent?.state] ?? SYNC_PRESENTATION[SYNC_STATE.PENDING_SYNC];
  return Object.freeze({ label: p.label, tone: p.tone, claimsComplete: p.claimsComplete });
}

/**
 * Why the server said no, in words that describe the WORLD.
 *
 * Keyed on the command's own business code, because that is the specific fact. The transport code is
 * a fallback for failures that never reached a command.
 */
const REASON_BY_DETAIL = Object.freeze({
  ASSET_INSTALLED_ELSEWHERE: {
    happened: "That machine is already installed for another customer.",
    next: "Check the serial on the unit you have. If it is right, a manager needs to look at it.",
  },
  ASSET_NOT_INSTALLABLE: {
    happened: "That machine is not in a state that can be installed.",
    next: "Confirm the serial. It may already be installed, or it may not be at your location.",
  },
  ALREADY_INSTALLED_FOR_THIS_WORK_ORDER: {
    happened: "This installation was already recorded for this job.",
    next: "Nothing to do — the machine is recorded. You can finish the job.",
  },
  SCAN_AMBIGUOUS: {
    happened: "That scan matched more than one machine.",
    next: "Enter the full serial instead of scanning.",
  },
  ASSET_NOT_RESOLVED: {
    happened: "The scanned serial was never matched to a machine.",
    next: "Open the installation and pick the unit from the list.",
  },
  NOT_ASSIGNED_TECHNICIAN: {
    happened: "This job is no longer assigned to you.",
    next: "Your work is saved here. Talk to dispatch before anything else.",
  },
  WORK_ORDER_STATE_INVALID: {
    happened: "This job is no longer in a state that accepts this.",
    next: "It was probably finished or cancelled. A manager can still add this for you.",
  },
  WORK_ORDER_NOT_FOUND: {
    happened: "That job could not be found.",
    next: "Talk to dispatch — it may have been cancelled.",
  },
  INVALID_TRANSITION: {
    happened: "This job had already moved on.",
    next: "Check the job — it may already be finished.",
  },
  OVERLAPPING_ENTRY: {
    happened: "That time overlaps time you already recorded.",
    next: "Check what is already on the job, then enter the difference.",
  },
  IDEMPOTENCY_CONFLICT: {
    happened: "This was sent once already, with different details.",
    next: "A manager has to decide which version is right. Nothing was changed.",
  },
  PERMISSION_DENIED: {
    happened: "You are not authorized to do this.",
    next: "Your work is saved here. Ask your manager to record it.",
  },
  NO_COMMAND_BOUND: {
    happened: "This app cannot send that kind of work.",
    next: "Report it — this is a fault in the app, not something you did.",
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
  "not-found": REASON_BY_DETAIL.WORK_ORDER_NOT_FOUND,
});

const UNKNOWN_REASON = Object.freeze({
  happened: "The platform did not accept this, and did not say why.",
  next: "It stays here. Try again, or report it if it keeps happening.",
});

/**
 * The whole card for one intent that needs a person.
 *
 * `preserved` is not padding. The single most common fear at this moment is that the work is gone,
 * and it never is — everything captured stays on the device until a person decides otherwise. Saying
 * so, every time, is the difference between a technician who reports a problem and one who quietly
 * re-does the work by hand.
 */
export function conflictCard(intent) {
  const detail = intent?.lastServerError?.details;
  const code = intent?.lastServerError?.code;
  const reason = (detail && REASON_BY_DETAIL[String(detail).toUpperCase()])
    ?? (code && REASON_BY_CODE[String(code).replace(/^functions\//, "")])
    ?? UNKNOWN_REASON;

  return Object.freeze({
    intentId: intent.intentId,
    attempted: INTENT_LABEL[intent.type] ?? intent.type,
    workOrderId: intent.workOrderId,
    status: statusFor(intent),
    happened: reason.happened,
    preserved: "Your entry is saved on this phone. Nothing has been lost.",
    next: reason.next,
    /** For a diagnostic, never for the headline. */
    technical: Object.freeze({ code: code ?? null, details: detail ?? null, attempts: intent.attemptCount }),
  });
}

/** Why something is waiting, when it is waiting on other work rather than on a signal. */
export const HOLD_TEXT = Object.freeze({
  [HOLD_REASON.AWAITING_REQUIRED]: "Waiting for the installation to be recorded first.",
  [HOLD_REASON.BLOCKED_BY_FAILED_REQUIREMENT]: "Cannot finish the job until the installation is sorted out.",
  [HOLD_REASON.AWAITING_SEQUENCED]: "Waiting for earlier work on this job to be sent.",
  [HOLD_REASON.BACKOFF]: "Waiting to try again.",
  [HOLD_REASON.NOT_SENDABLE]: null,
});

/**
 * The one line Home shows, and the rule for whether to shout.
 *
 * Work that needs a person is reported SEPARATELY from work that is merely waiting — a technician who
 * sees "3 waiting to sync" and walks away, when one of the three was refused an hour ago, has been
 * misled by a number that was technically accurate.
 */
export function syncIndicator(summary, { durable = true, online = true } = {}) {
  if (!durable) {
    return Object.freeze({
      severity: "attention",
      headline: "This phone cannot save work offline",
      detail: "Anything you enter may be lost if the app closes. Stay online if you can.",
      count: summary?.unsynced ?? 0,
    });
  }
  if ((summary?.attentionCount ?? 0) > 0) {
    const n = summary.attentionCount;
    return Object.freeze({
      severity: "attention",
      headline: n === 1 ? "1 item needs your attention" : `${n} items need your attention`,
      detail: "Something was not accepted. Open Sync to see what.",
      count: summary.unsynced,
    });
  }
  const unsynced = summary?.unsynced ?? 0;
  if (unsynced === 0) {
    return Object.freeze({ severity: "ok", headline: "Everything is saved", detail: null, count: 0 });
  }
  return Object.freeze({
    severity: "pending",
    headline: unsynced === 1 ? "1 item waiting to sync" : `${unsynced} items waiting to sync`,
    // The device's own belief about connectivity is a HINT and is worded as one. It is never
    // presented as knowledge that the platform is reachable.
    detail: online ? "It will send by itself." : "It will send when you are back in signal.",
    count: unsynced,
  });
}
