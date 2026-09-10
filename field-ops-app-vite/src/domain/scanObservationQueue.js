// SCAN OBSERVATION QUEUE — the ONE multi-scan observation store. Pure: no I/O, no JSX, no transport.
//
// Extracted from receivingScanQueue.js by BIN-P6 so warehouse movement sessions use the SAME queue
// Receiving does, rather than a second one that would drift. Receiving re-exports every function here
// unchanged; its purchase-order reconciliation stays in receivingScanQueue.js, because that part is
// genuinely receiving-specific.
//
// A scan adds an OBSERVATION. It never moves inventory, never decides authority, and never validates:
// an observation is a record of what was scanned, including scans that turn out to be wrong. The
// consumer (receiving reconciliation, a movement session) decides what each one means.
//
// ============================ RAW OBSERVATIONS, DERIVED AGGREGATE ============================
//
// Every scan is stored in order and any total is a PROJECTION over them, never a running counter.
// Undo is dropping the last observation; correcting one entry cannot corrupt a total because there is
// no total to corrupt; "each scan = +1" and "type a quantity" are the same thing.
//
// ============================ SERIALS ARE NEVER AGGREGATED ============================
//
// One serial is one physical unit, so serialized observations stay separate entries of quantity one.

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
