// SHARED SCANNER INPUT — the rules that are the same whatever you are scanning. PURE: no I/O, no
// JSX, no DOM, no timers of its own.
//
// ============================ WHY THIS IS SHARED ============================
//
// Receiving, transfers, counting, lookup and the technician scanner all take the same three kinds of
// input — a hardware wedge acting as a keyboard, a camera decode, and someone typing — and they all
// face the same three hazards: a wedge that double-fires, a camera that decodes the same label
// forty times a second while it sits in frame, and a person who cannot tell whether their scan
// registered.
//
// Solving those five times produces five slightly different answers. This module is the one answer;
// shared/ui/ScanInput.jsx is the one input.
//
// ============================ IT DOES NOT RESOLVE IDENTITY ============================
//
// What a scanned value MEANS is `resolveScannedIdentity`'s job, and the workflow's own rules decide
// what to do about it. This module only decides whether a keystroke burst is one scan or two, and
// what noise to make about the answer. Nothing here can widen access or change a command.

/** How a scan should be acknowledged. Deliberately three, matching what an operator needs to know. */
export const FEEDBACK = Object.freeze({
  ACCEPTED: "ACCEPTED",   // it counted
  REJECTED: "REJECTED",   // it did not count, and something needs doing
  NEUTRAL: "NEUTRAL",     // it registered but changed nothing (a duplicate, say)
});

/** Where a value came from. The two sources repeat for completely different reasons. */
export const SCAN_SOURCE = Object.freeze({
  KEYED: "KEYED",     // a hardware wedge typing, or a person typing
  CAMERA: "CAMERA",   // continuous decode
});

/**
 * How long the same value is treated as one scan — and why the two sources differ.
 *
 * THIS IS THE LOAD-BEARING DISTINCTION. Counting ten identical boxes means scanning the SAME VALUE
 * ten times in a row, deliberately. Suppressing that would silently under-count, which is the worst
 * possible failure in a cycle count. So the window must be only just long enough to kill the
 * accidental repeats, and no longer.
 *
 * KEYED (250ms): a wedge can emit a code twice on one trigger pull, milliseconds apart. It cannot
 * emit twice 250ms apart. A person deliberately scanning a second identical box has to move the
 * first one out of the way, which takes far longer. So 250ms kills the stutter and never a real
 * count.
 *
 * CAMERA (1500ms): a decoder emits the same label EVERY FRAME while it sits in view — sixty times a
 * second. Nothing shorter than about a second is enough, and unlike a wedge there is no way to scan
 * a second identical box without first moving the camera off the first one, which comfortably
 * exceeds this.
 */
export const REPEAT_WINDOW_MS = Object.freeze({
  [SCAN_SOURCE.KEYED]: 250,
  [SCAN_SOURCE.CAMERA]: 1500,
});

/** The window for a source, defaulting to the SAFER (shorter) one for an unrecognized source. */
export function repeatWindowFor(source) {
  // Defaulting short means an unknown source can produce a duplicate the operator can see and undo,
  // rather than silently swallowing a real count.
  return REPEAT_WINDOW_MS[source] ?? REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED];
}

/**
 * Is this scan a repeat of the last one, or a new one?
 *
 * PURE and clock-injected: the caller supplies `now`, so this is testable without timers and cannot
 * drift with the event loop.
 *
 * @param last  the previous accepted scan: { value, at } — or null.
 * @param value the raw value just received.
 * @param now   milliseconds.
 */
export function isRepeatScan(last, value, now, windowMs = REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED]) {
  if (!last || typeof last.value !== "string" || typeof last.at !== "number") return false;
  if (typeof value !== "string") return false;
  if (last.value.trim().toLowerCase() !== value.trim().toLowerCase()) return false;
  const elapsed = now - last.at;
  // A negative elapsed means the clock moved backwards. Treating that as "not a repeat" is the safe
  // direction: an extra scan the operator can undo beats a silently swallowed one.
  return elapsed >= 0 && elapsed < windowMs;
}

/**
 * Decide what to do with an incoming raw value.
 *
 * Returns { accept, feedback, reason }. A SUPPRESSED repeat is NEUTRAL rather than REJECTED: nothing
 * is wrong, and buzzing an error at an operator whose scanner stuttered teaches them to ignore the
 * buzzer.
 *
 * @param source SCAN_SOURCE.KEYED or .CAMERA — they repeat for different reasons and get different
 *               windows. See REPEAT_WINDOW_MS.
 */
export function admitScan({ last, value, now, source = SCAN_SOURCE.KEYED, windowMs } = {}) {
  const effectiveWindow = typeof windowMs === "number" ? windowMs : repeatWindowFor(source);
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "") {
    return Object.freeze({ accept: false, feedback: FEEDBACK.NEUTRAL, reason: "EMPTY" });
  }
  if (isRepeatScan(last, trimmed, now, effectiveWindow)) {
    return Object.freeze({ accept: false, feedback: FEEDBACK.NEUTRAL, reason: "REPEAT" });
  }
  return Object.freeze({ accept: true, feedback: null, reason: null, value: trimmed });
}

/**
 * The vibration pattern for a feedback kind, in the shape `navigator.vibrate` takes.
 *
 * ACCEPTED is one short pulse; REJECTED is two, because a warehouse is loud and a glove-covered hand
 * feels a rhythm more reliably than it distinguishes one buzz from another. NEUTRAL is silent — a
 * suppressed repeat has nothing to say.
 */
export function vibrationPattern(feedback) {
  if (feedback === FEEDBACK.ACCEPTED) return [40];
  if (feedback === FEEDBACK.REJECTED) return [80, 60, 80];
  return null;
}

/**
 * The tone for a feedback kind: { frequency, durationMs } or null.
 *
 * Rising for accepted, falling for rejected. The distinction has to survive being heard across a
 * room over a forklift, which is why it is pitch and not volume.
 */
export function feedbackTone(feedback) {
  if (feedback === FEEDBACK.ACCEPTED) return Object.freeze({ frequency: 1200, durationMs: 90 });
  if (feedback === FEEDBACK.REJECTED) return Object.freeze({ frequency: 300, durationMs: 220 });
  return null;
}

/**
 * The spoken/announced text for a scan outcome, for screen readers and for the visible line.
 *
 * One sentence, and it always names the VALUE — an operator scanning a wall of similar boxes needs
 * to know which one registered, not merely that something did.
 */
export function feedbackText(feedback, value, detail = null) {
  const shown = typeof value === "string" && value.trim() !== "" ? value.trim() : "that code";
  if (feedback === FEEDBACK.ACCEPTED) return `Scanned ${shown}.`;
  if (feedback === FEEDBACK.REJECTED) return detail ? `${shown} — ${detail}` : `${shown} was not accepted.`;
  return `${shown} was already scanned.`;
}
