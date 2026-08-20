// RECEIVING MULTI-SCAN QUEUE — pure. No I/O, no JSX, no transport, unit-tested.
//
// A scan adds an OBSERVATION to a queue. It never moves inventory, never mutates a purchase order,
// and never decides authority — the governed command does all three, and re-validates everything this
// module concluded. This is the operator's working surface between picking a box up and submitting a
// receipt.
//
// ============================ RAW OBSERVATIONS, DERIVED AGGREGATE ============================
//
// The queue stores every scan in order, and the per-line totals are a PROJECTION over them rather
// than a running counter. That is the whole design, and three requirements fall out of it for free:
//
//   - "undo last scan" is dropping the last observation, not reversing arithmetic;
//   - correcting one entry cannot corrupt a total, because there is no total to corrupt;
//   - "each scan = +1" and "type a quantity" are the same thing — one observation of qty 1, or one
//     of qty N.
//
// A running counter would make undo and correction into inverse operations that have to agree with
// the thing they are inverting, which is exactly where off-by-one bugs live.
//
// ============================ SERIALS ARE NEVER AGGREGATED ============================
//
// One serial is one physical unit. Serialized observations stay separate entries of quantity one and
// are never merged, because merging them would destroy the identity that makes them serialized. A
// repeated serial is a DUPLICATE — the same unit scanned twice — and is blocked rather than counted.

/** What a queue entry is, once reconciled against the purchase order. */
export const ENTRY_STATE = Object.freeze({
  VALID: "VALID",
  /** Resolved and counted, but the line is now over its remaining quantity. */
  OVER_RECEIPT: "OVER_RECEIPT",
  /** The scanned part is not on this purchase order at all. */
  NOT_ON_ORDER: "NOT_ON_ORDER",
  /** This serial was already scanned in this session. */
  DUPLICATE_SERIAL: "DUPLICATE_SERIAL",
  /** The line is already fully received by earlier committed receipts. */
  ALREADY_SATISFIED: "ALREADY_SATISFIED",
  /** A serialized part scanned without a serial, or a non-serialized part scanned with one. */
  SERIAL_REQUIRED: "SERIAL_REQUIRED",
  SERIAL_NOT_ALLOWED: "SERIAL_NOT_ALLOWED",
});

/** States that prevent submission. VALID is the only one that does not. */
export const BLOCKING_STATES = Object.freeze([
  ENTRY_STATE.OVER_RECEIPT,
  ENTRY_STATE.NOT_ON_ORDER,
  ENTRY_STATE.DUPLICATE_SERIAL,
  ENTRY_STATE.ALREADY_SATISFIED,
  ENTRY_STATE.SERIAL_REQUIRED,
  ENTRY_STATE.SERIAL_NOT_ALLOWED,
]);

let entrySeq = 0;
/** Stable per-entry id. Scoped to the module, so a correction targets one entry unambiguously. */
function nextEntryId() {
  entrySeq += 1;
  return `e${entrySeq}`;
}

/** An empty queue for one purchase order. */
export function createQueue() {
  return Object.freeze({ observations: Object.freeze([]) });
}

/**
 * Record one scan.
 *
 * `partId` is what the scan RESOLVED to (domain/scannedIdentity.js owns resolution; this module never
 * parses a barcode). `serialNo` is present only for a serialized unit. `quantity` defaults to 1 —
 * "each scan = +1" — and may be supplied where a keyed quantity is appropriate.
 *
 * Nothing is validated here. An observation is a record of what was scanned, including scans that
 * turn out to be wrong; reconcile() decides what each one means. Refusing at scan time would throw
 * away the operator's evidence that they scanned something unexpected, which is the one thing they
 * most need to see.
 */
export function addScan(queue, { partId, serialNo = null, quantity = 1 } = {}) {
  if (typeof partId !== "string" || partId.trim() === "") return queue;
  const isSerial = typeof serialNo === "string" && serialNo.trim() !== "";
  const qty = isSerial ? 1 : Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const observation = Object.freeze({
    entryId: nextEntryId(),
    partId,
    serialNo: isSerial ? serialNo.trim() : null,
    quantity: qty,
  });
  return Object.freeze({ observations: Object.freeze([...queue.observations, observation]) });
}

/** Drop the most recent observation. A no-op on an empty queue rather than an error. */
export function undoLastScan(queue) {
  if (queue.observations.length === 0) return queue;
  return Object.freeze({ observations: Object.freeze(queue.observations.slice(0, -1)) });
}

/** Drop one observation by id — correction without rescanning the rest of the delivery. */
export function removeEntry(queue, entryId) {
  const next = queue.observations.filter((o) => o.entryId !== entryId);
  if (next.length === queue.observations.length) return queue;
  return Object.freeze({ observations: Object.freeze(next) });
}

/**
 * Change one observation's quantity. Serialized entries are always one unit and are left alone —
 * silently accepting a quantity on a serial would break the one-serial-one-unit invariant.
 */
export function setEntryQuantity(queue, entryId, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) return queue;
  return Object.freeze({
    observations: Object.freeze(queue.observations.map((o) =>
      o.entryId === entryId && o.serialNo === null ? Object.freeze({ ...o, quantity }) : o)),
  });
}

export function clearQueue() {
  return createQueue();
}

/**
 * Reconcile the queue against the purchase order's lines.
 *
 * `poLines` are the server's derived per-line facts: { lineId, partId, orderedQuantity,
 * receivedQuantity, remainingQuantity, trackingMode }. Everything here is computed FROM them; this
 * module holds no opinion about what remains and never carries one over between reconciliations.
 *
 * Returns the queue entries with their state, the per-line reconciliation, and whether the whole
 * queue may be submitted.
 */
export function reconcile(queue, poLines) {
  const lines = Array.isArray(poLines) ? poLines : [];
  const byPartId = new Map();
  for (const l of lines) {
    // A part appearing on two lines of one order is real. The FIRST line is used and the ambiguity
    // is reported, rather than silently splitting a scan across lines — deciding which line a box
    // belongs to is the operator's call, not a guess this module should make.
    if (!byPartId.has(l.partId)) byPartId.set(l.partId, l);
  }

  const seenSerials = new Set();
  const runningByLineId = new Map();
  const entries = [];

  for (const o of queue.observations) {
    const line = byPartId.get(o.partId);
    if (line === undefined) {
      entries.push(Object.freeze({ ...o, lineId: null, state: ENTRY_STATE.NOT_ON_ORDER }));
      continue;
    }
    const isSerialLine = line.trackingMode === "SERIAL";

    if (isSerialLine && o.serialNo === null) {
      entries.push(Object.freeze({ ...o, lineId: line.lineId, state: ENTRY_STATE.SERIAL_REQUIRED }));
      continue;
    }
    if (!isSerialLine && o.serialNo !== null) {
      entries.push(Object.freeze({ ...o, lineId: line.lineId, state: ENTRY_STATE.SERIAL_NOT_ALLOWED }));
      continue;
    }
    if (o.serialNo !== null) {
      if (seenSerials.has(o.serialNo)) {
        // Blocked, NOT counted. The same physical unit scanned twice is one unit.
        entries.push(Object.freeze({ ...o, lineId: line.lineId, state: ENTRY_STATE.DUPLICATE_SERIAL }));
        continue;
      }
      seenSerials.add(o.serialNo);
    }

    if (line.remainingQuantity <= 0) {
      entries.push(Object.freeze({ ...o, lineId: line.lineId, state: ENTRY_STATE.ALREADY_SATISFIED }));
      continue;
    }

    const running = (runningByLineId.get(line.lineId) ?? 0) + o.quantity;
    runningByLineId.set(line.lineId, running);
    // Over-receipt is attributed to the scan that CROSSED the limit, not to the whole line. The
    // operator needs to know which box was the extra one, and the earlier scans of that line are
    // genuinely fine.
    const state = running > line.remainingQuantity ? ENTRY_STATE.OVER_RECEIPT : ENTRY_STATE.VALID;
    entries.push(Object.freeze({ ...o, lineId: line.lineId, state }));
  }

  const countedByLineId = new Map();
  const serialsByLineId = new Map();
  for (const e of entries) {
    if (e.state !== ENTRY_STATE.VALID) continue;
    countedByLineId.set(e.lineId, (countedByLineId.get(e.lineId) ?? 0) + e.quantity);
    if (e.serialNo !== null) {
      if (!serialsByLineId.has(e.lineId)) serialsByLineId.set(e.lineId, []);
      serialsByLineId.get(e.lineId).push(e.serialNo);
    }
  }

  const reconciledLines = lines.map((l) => {
    const observedNow = countedByLineId.get(l.lineId) ?? 0;
    return Object.freeze({
      lineId: l.lineId,
      partId: l.partId,
      trackingMode: l.trackingMode,
      orderedQuantity: l.orderedQuantity,
      previouslyReceived: l.receivedQuantity,
      remainingBefore: l.remainingQuantity,
      observedNow,
      // What would remain if this queue were submitted as it stands.
      remainingAfter: Math.max(0, l.remainingQuantity - observedNow),
      serialNumbers: Object.freeze([...(serialsByLineId.get(l.lineId) ?? [])]),
    });
  });

  const blocked = entries.filter((e) => e.state !== ENTRY_STATE.VALID);
  return Object.freeze({
    entries: Object.freeze(entries),
    lines: Object.freeze(reconciledLines),
    blocked: Object.freeze(blocked),
    scanCount: entries.length,
    totalQuantity: reconciledLines.reduce((s, l) => s + l.observedNow, 0),
    // A queue with ANY blocked entry cannot be submitted. A blocked entry is never silently
    // dropped and never silently included -- the operator resolves it, one way or the other.
    submittable: entries.length > 0 && blocked.length === 0 && reconciledLines.some((l) => l.observedNow > 0),
    ambiguousParts: Object.freeze(
      [...new Set(lines.filter((l, i) => lines.findIndex((x) => x.partId === l.partId) !== i).map((l) => l.partId))],
    ),
  });
}

/**
 * The governed command's `lines` payload for a reconciled queue.
 *
 * Only lines with a positive observed quantity are sent — a line nobody scanned is not part of this
 * receipt, and sending it as zero would be a claim that nothing arrived rather than that nothing was
 * looked at.
 *
 * Returns null when the queue is not submittable, so a caller cannot build a payload from a queue
 * carrying blocked entries.
 */
export function buildSubmissionLines(reconciliation) {
  if (!reconciliation?.submittable) return null;
  return Object.freeze(
    reconciliation.lines
      .filter((l) => l.observedNow > 0)
      .map((l) => Object.freeze({
        lineId: l.lineId,
        partId: l.partId,
        receivedQuantity: l.observedNow,
        ...(l.trackingMode === "SERIAL" ? { serialNumbers: Object.freeze([...l.serialNumbers]) } : {}),
      })),
  );
}

/** Plain-language reason for a blocked entry — the operator has to act on these. */
export const ENTRY_STATE_REASON = Object.freeze({
  [ENTRY_STATE.OVER_RECEIPT]: "More than the outstanding quantity for this line. Remove a scan or correct the quantity.",
  [ENTRY_STATE.NOT_ON_ORDER]: "This part is not on this purchase order.",
  [ENTRY_STATE.DUPLICATE_SERIAL]: "This serial was already scanned — the same unit cannot be received twice.",
  [ENTRY_STATE.ALREADY_SATISFIED]: "This line has already been received in full.",
  [ENTRY_STATE.SERIAL_REQUIRED]: "This part is serialized. Scan the unit's serial, not the part.",
  [ENTRY_STATE.SERIAL_NOT_ALLOWED]: "This part is not serialized, so it carries no serial number.",
});
