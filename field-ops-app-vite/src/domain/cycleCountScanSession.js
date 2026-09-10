// CYCLE COUNT BY SCAN -- the multi-part counting session (BIN-P8 / Cycle Count A2). PURE: no I/O, no JSX.
//
// A sheet is locked to ONE location (usually a scanned Bin). Every scan is an observation in the SAME
// queue Receiving and Move stock use (domain/scanObservationQueue.js) -- no third queue. This module turns
// those observations, plus what the server has said about each line, into the lines a counter reviews.
//
// ============================ THE COUNT IS BLIND ============================
//
// DECISIONS #111 / A1 Revision 2. A line's expected value exists on the server from the moment the line
// opens, and crosses the wire only in THAT line's submit response. So nothing here accepts, derives or
// displays an expected figure for a line that has not been submitted -- not as a number, not as an
// "over/short" hint, not as a per-serial "was this expected?" tell. After a line is submitted, its own
// expected value (from its own response or the durable read) may be shown; its siblings stay blind.
//
// ============================ OBSERVATION IS NOT ADJUSTMENT ============================
//
// Submitting records what was seen and moves no stock. Reconciliation is a separate capability and a
// separate screen. There is no reconcile path in this module.
//
// ============================ SERIALS STAY UNITS ============================
//
// A serial is one unit and one observation; the same serial twice on one line is refused at scan time.
// NONE-tracked scans aggregate: each scan is +1, and a keyed quantity is the same thing.

/** Where a line stands, from the counter's point of view. */
export const COUNT_LINE_STATE = Object.freeze({
  COUNTING: "COUNTING",     // open on the server; this device holds an unsubmitted count (possibly zero)
  NOT_COUNTED: "NOT_COUNTED", // open on the server; nothing counted here yet (e.g. resumed on another device)
  SUBMITTED: "SUBMITTED",   // COUNTED on the server -- its own expected value may now be shown
  DECIDED: "DECIDED",       // RECONCILED or REJECTED by a reviewer
  REMOVED: "REMOVED",       // cancelled before it was counted
});

const SUBMITTED_STATUSES = new Set(["COUNTED", "RECONCILED", "REJECTED"]);

/** Is this exact serial already an observation on this part's line? Case-insensitive, trimmed. */
export function isDuplicateSerial(observations, partId, serialNo) {
  const want = String(serialNo ?? "").trim().toLowerCase();
  return want !== "" && observations.some((o) => o.partId === partId && o.serialNo && o.serialNo.toLowerCase() === want);
}

/**
 * Build the lines a counter reviews.
 *
 * @param observations  the shared queue's observations for this sheet
 * @param parts         partId -> { trackingMode, label } for every Part resolved this session
 * @param serverLines   partId -> the durable line projection (or a submit response), when known
 * @param zeroed        partIds the counter explicitly marked "none here" -- a real count of zero
 */
export function buildCountLines({ observations = [], parts = new Map(), serverLines = new Map(), zeroed = new Set() } = {}) {
  const ids = new Set([...observations.map((o) => o.partId), ...serverLines.keys(), ...zeroed]);
  const lines = [];
  for (const partId of ids) {
    const info = parts.get(partId) ?? {};
    const server = serverLines.get(partId) ?? null;
    const trackingMode = server?.trackingMode ?? info.trackingMode ?? "NONE";
    const own = observations.filter((o) => o.partId === partId);
    const serials = trackingMode === "SERIAL" ? own.filter((o) => o.serialNo).map((o) => o.serialNo) : [];
    const quantity = trackingMode === "SERIAL" ? serials.length : own.reduce((n, o) => n + (o.quantity ?? 1), 0);
    const status = server?.status ?? "OPEN";
    const submitted = SUBMITTED_STATUSES.has(status);
    const state = status === "CANCELLED" ? COUNT_LINE_STATE.REMOVED
      : status === "RECONCILED" || status === "REJECTED" ? COUNT_LINE_STATE.DECIDED
      : submitted ? COUNT_LINE_STATE.SUBMITTED
      : own.length > 0 || zeroed.has(partId) ? COUNT_LINE_STATE.COUNTING
      : COUNT_LINE_STATE.NOT_COUNTED;
    lines.push(Object.freeze({
      partId,
      label: info.label ?? partId,
      trackingMode,
      state,
      serverStatus: status,
      countedQuantity: submitted ? (server.countedQuantity ?? server.countedSerialNumbers?.length ?? 0) : quantity,
      countedSerialNumbers: Object.freeze(submitted ? [...(server.countedSerialNumbers ?? [])] : serials),
      entryIds: Object.freeze(own.map((o) => o.entryId)),
      // ONLY a submitted line carries these, and only from the server.
      ...(submitted ? {
        expectedQuantity: server.expectedQuantity,
        variance: server.variance,
        serialVariance: server.serialVariance,
      } : {}),
    }));
  }
  return Object.freeze(lines.sort((a, b) => a.label.localeCompare(b.label)));
}

/** Lines ready to submit: counted here (a zero included) and not yet on the server as counted. */
export function linesToSubmit(lines) {
  return lines.filter((l) => l.state === COUNT_LINE_STATE.COUNTING);
}

/** The submit draft for one line, in the shape buildSubmitLineRequest expects. Serials stay a LIST. */
export function lineDraft(line) {
  return line.trackingMode === "SERIAL"
    ? { countedSerialNumbers: [...line.countedSerialNumbers] }
    : { countedQuantity: line.countedQuantity };
}

/**
 * Unsubmitted work the screen must protect from an accidental exit, counted in SCANS ("discard 3 scans"
 * is a different sentence from "discard your work"). An explicit "none here" zero counts as one.
 */
export function pendingWorkCount(lines) {
  return linesToSubmit(lines).reduce((n, l) => n + Math.max(l.entryIds.length, 1), 0);
}
