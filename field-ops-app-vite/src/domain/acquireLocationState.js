// THE COMPANY-LOCATION PICKER'S ONE STATE — pure, and mutually exclusive by construction.
//
// ============================ THE DEFECT THIS EXISTS TO END ============================
//
// The acquisition dialog could show a chosen company location and, directly beneath it, the words
// "the company locations could not be read". Both cannot be true. A person reading that has no way
// to know whether the unit is about to be filed against a real warehouse or against a stale value
// left over from a read that has since failed — on a command with no undo.
//
// The mechanism was a string comparison that could never succeed: the dialog tested
// `status !== "READY"` while the governed transport returns `RECEIVING_OUTCOME.READY`, which is the
// lowercase `"ready"`. Every successful read therefore rendered the failure sentence, beside the
// options it had just successfully loaded. Importing the enum here rather than re-typing its values
// is what stops that particular class of bug coming back.
//
// ============================ WHY A STATE AND NOT A BOOLEAN ============================
//
// "Could not be read" was doing the work of four different answers, and they call for four different
// things from the user:
//
//   LOADING   nothing is wrong; wait
//   READY     choose one
//   EMPTY     the read succeeded and the business has no eligible location — an answer, not a fault
//   DENIED    the read was refused; no amount of waiting or retrying will change it
//   ERROR     the read failed; it may work later
//
// EMPTY and DENIED are the two most often collapsed into "error", and they are the two that most
// mislead: one is a fact about the business, the other is a fact about the reader.
//
// ============================ WHAT IT IS NOT ============================
//
// It is not authority. `warehouses.status` governs which locations are eligible and the acquire
// command re-validates the chosen one inside its transaction. This only decides what a person is
// shown and whether they may choose at all.
import { RECEIVING_OUTCOME } from "./receivingTransport.js";

export const ACQUIRE_LOCATION_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  EMPTY: "EMPTY",
  DENIED: "DENIED",
  ERROR: "ERROR",
});

/**
 * The words for each state.
 *
 * READY has none. A state that is working correctly should say nothing at all — a reassurance line
 * under a working picker is noise, and noise is what a real failure has to compete with.
 */
export const ACQUIRE_LOCATION_MESSAGE = Object.freeze({
  [ACQUIRE_LOCATION_STATE.LOADING]: "Loading company locations…",
  [ACQUIRE_LOCATION_STATE.READY]: null,
  [ACQUIRE_LOCATION_STATE.EMPTY]: "No eligible company locations are available.",
  [ACQUIRE_LOCATION_STATE.DENIED]:
    "You are not able to read company locations, so none can be chosen.",
  [ACQUIRE_LOCATION_STATE.ERROR]: "Company locations could not be loaded.",
});

/** The placeholder in the picker itself, which must not promise options a failed read cannot offer. */
export const ACQUIRE_LOCATION_PLACEHOLDER = Object.freeze({
  [ACQUIRE_LOCATION_STATE.LOADING]: "Loading company locations…",
  [ACQUIRE_LOCATION_STATE.READY]: "Select active warehouse…",
  [ACQUIRE_LOCATION_STATE.EMPTY]: "No eligible company locations",
  [ACQUIRE_LOCATION_STATE.DENIED]: "Company locations unavailable",
  [ACQUIRE_LOCATION_STATE.ERROR]: "Company locations unavailable",
});

/** Transport outcomes that mean the reader was refused, as opposed to the read having failed. */
const REFUSED = new Set([RECEIVING_OUTCOME.DENIED, RECEIVING_OUTCOME.UNAUTHENTICATED]);

/**
 * Derive the one state from what the governed read actually returned.
 *
 * `status === null` is the pre-fetch state, not a failure: the read has not been asked yet. Treating
 * an unasked question as a failed one is how a dialog comes to accuse a working system on its first
 * frame.
 */
export function deriveAcquireLocationState({ status = null, options = [] } = {}) {
  const list = Array.isArray(options) ? options : [];
  if (status === null || status === undefined) {
    return frame(ACQUIRE_LOCATION_STATE.LOADING, []);
  }
  if (status === RECEIVING_OUTCOME.READY) {
    // A successful read that found nothing is EMPTY. It is an answer about the business, and saying
    // "could not be loaded" would blame the platform for a true fact.
    return list.length > 0
      ? frame(ACQUIRE_LOCATION_STATE.READY, list)
      : frame(ACQUIRE_LOCATION_STATE.EMPTY, []);
  }
  if (REFUSED.has(status)) return frame(ACQUIRE_LOCATION_STATE.DENIED, []);
  return frame(ACQUIRE_LOCATION_STATE.ERROR, []);
}

/**
 * One frame, and the invariant lives here rather than in the component.
 *
 * OPTIONS ARE DROPPED IN EVERY NON-READY STATE, on purpose. A component that receives an empty list
 * cannot render a selected location beside a failure message even if it tries, because there is
 * nothing to render. The contradiction is made unrepresentable instead of merely being avoided.
 */
function frame(state, options) {
  const ready = state === ACQUIRE_LOCATION_STATE.READY;
  return Object.freeze({
    state,
    options: Object.freeze(ready ? [...options] : []),
    selectable: ready,
    disabled: !ready,
    message: ACQUIRE_LOCATION_MESSAGE[state],
    placeholder: ACQUIRE_LOCATION_PLACEHOLDER[state],
    // ERROR is the only state where trying again could plausibly produce a different answer. DENIED
    // will refuse identically forever, and offering Retry there teaches a person to keep pressing a
    // button that is working exactly as intended.
    retryable: state === ACQUIRE_LOCATION_STATE.ERROR,
  });
}

/**
 * The selection a form may keep, given the current state.
 *
 * THE INVARIANT, ENFORCED AT THE SOURCE: a location can only be held while the governed read is
 * READY. If the read later fails or is refused, the previously chosen id is not a stale default to
 * be quietly retained — it is a value nothing currently vouches for, and the form drops it.
 */
export function retainedLocationId(locationId, frame) {
  if (!frame?.selectable) return "";
  const id = typeof locationId === "string" ? locationId.trim() : "";
  if (!id) return "";
  // Not merely READY — READY AND STILL OFFERED. A location that dropped out of the governed list
  // between reads is no more choosable than one from a failed read.
  return frame.options.some((option) => option?.value === id) ? id : "";
}
