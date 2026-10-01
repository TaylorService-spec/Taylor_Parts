// STOCK MOVEMENT SESSION — warehouse multi-scan for moving stock (BIN-P6, Decision #170).
// PURE: no I/O, no JSX, no transport. Spec: docs/specifications/bin-stock-relocation-and-multi-scan.md §8–§9.
//
// ============================ SCAN = OBSERVATION. CONFIRMED COMMAND = MOVEMENT. ============================
//
// Nothing here moves stock. Scans become observations in the ONE shared queue (scanObservationQueue.js,
// the same queue Receiving uses). Observations group into movement LINES. Confirming freezes the lines
// into a BATCH, and only then does the screen send one governed command per line.
//
// ============================ THE OPERATOR NEVER PICKS A LEDGER TYPE ============================
//
// deriveMoveRoute reads the two endpoints and answers RELOCATION or TRANSFER with the SAME custody rule
// the server uses: one Warehouse parent is a relocation, two parents -- or any truck -- is a Transfer.
// The server re-derives and refuses a mismatch; this is a routing hint, never the authority.
//
// ============================ WHY A CONFIRMED BATCH IS FROZEN ============================
//
// Each line's idempotency key is what makes a retry safe: an applied line replays instead of moving
// twice. But a key built only from "session + part" breaks the moment the operator scans three MORE of a
// part they already moved -- the new line would reuse the old key, and the server would REPLAY the old
// quantity, so the new units would silently never move. Confirming therefore freezes the current lines
// into batch N with keys that include N. A retry re-runs the frozen line under the same key and the same
// intent; new scans afterwards form batch N+1. Changing a failed line means discarding it and scanning
// again -- never editing the intent behind a key that may already have been used.
//
// ============================ PER-LINE TRUTH ============================
//
// Every line gets its own result. A failure on line 7 never retracts lines 1–6. No aggregate "Success"
// may hide a partial failure. Business refusals are final; only RETRYABLE_TECHNICAL_FAILURE retries.

/** Where stock can move from or to in a warehouse session. */
export const MOVE_ENDPOINT = Object.freeze({ WAREHOUSE: "WAREHOUSE", BIN: "BIN", MOBILE: "MOBILE" });

export const MOVE_ROUTE = Object.freeze({
  RELOCATION: "RELOCATION",
  TRANSFER: "TRANSFER",
  INVALID: "INVALID",
});

/**
 * Which governed command a pair of endpoints needs. An endpoint is
 * `{ type, locationId, custodyWarehouseId, label }`, where custodyWarehouseId is the Warehouse id for a
 * WAREHOUSE, the bin's governed parent (from the trusted bin resolve) for a BIN, and null for a truck.
 */
export function deriveMoveRoute(source, destination) {
  if (!source || !destination) return Object.freeze({ route: MOVE_ROUTE.INVALID, reason: "endpoint_missing" });
  if (source.type === destination.type && source.locationId === destination.locationId) {
    return Object.freeze({ route: MOVE_ROUTE.INVALID, reason: "same_location" });
  }
  if (source.type === MOVE_ENDPOINT.MOBILE || destination.type === MOVE_ENDPOINT.MOBILE) {
    // A truck is custody of its own. Every movement touching one crosses a boundary.
    return Object.freeze({ route: MOVE_ROUTE.TRANSFER, reason: null });
  }
  const a = source.custodyWarehouseId ?? null;
  const b = destination.custodyWarehouseId ?? null;
  if (a === null || b === null) return Object.freeze({ route: MOVE_ROUTE.INVALID, reason: "custody_unresolved" });
  return Object.freeze({ route: a === b ? MOVE_ROUTE.RELOCATION : MOVE_ROUTE.TRANSFER, reason: null });
}

/** What a line can be, before anything is sent. Only READY is sendable. */
export const LINE_STATE = Object.freeze({
  READY: "READY",
  DUPLICATE_SERIAL: "DUPLICATE_SERIAL",
  SERIAL_REQUIRED: "SERIAL_REQUIRED",
  SERIAL_NOT_ALLOWED: "SERIAL_NOT_ALLOWED",
  PART_UNKNOWN: "PART_UNKNOWN",
  /** LOT or dual-tracked: no lot custody model has been decided, so these are refused before sending. */
  UNSUPPORTED_TRACKING: "UNSUPPORTED_TRACKING",
});

export const LINE_STATE_TEXT = Object.freeze({
  [LINE_STATE.READY]: "Ready to move",
  [LINE_STATE.DUPLICATE_SERIAL]: "This serial was already scanned",
  [LINE_STATE.SERIAL_REQUIRED]: "Scan the serial number for this part",
  [LINE_STATE.SERIAL_NOT_ALLOWED]: "This part is not serialized — scan it without a serial",
  [LINE_STATE.PART_UNKNOWN]: "This part could not be identified",
  [LINE_STATE.UNSUPPORTED_TRACKING]: "Lot-tracked parts cannot be moved from the scanner yet",
});

/**
 * Group observations into movement lines.
 *
 * `trackingByPartId` maps partId -> "NONE" | "SERIAL" from the Part Master read the screen already did.
 * NONE observations of one part sum into ONE line (repeated scans count, intentionally). Each SERIAL
 * observation is its own line; the second scan of one serial is a DUPLICATE and blocks.
 */
export function buildMovementLines(observations, trackingByPartId) {
  const lines = [];
  const noneByPart = new Map();
  const seenSerials = new Set();
  for (const o of observations ?? []) {
    const mode = trackingByPartId?.get?.(o.partId) ?? trackingByPartId?.[o.partId] ?? null;
    if (mode !== null && mode !== "NONE" && mode !== "SERIAL") {
      // Only NONE and SERIAL have a custody model. Sending anything else would be refused by the
      // server anyway; saying so here keeps it out of a batch the operator believes will move.
      lines.push(Object.freeze({ lineId: `unsupported:${o.entryId}`, partId: o.partId, serialNo: o.serialNo, quantity: o.quantity, state: LINE_STATE.UNSUPPORTED_TRACKING, entryIds: [o.entryId] }));
      continue;
    }
    if (mode === null) {
      lines.push(Object.freeze({ lineId: `unknown:${o.entryId}`, partId: o.partId, serialNo: o.serialNo, quantity: o.quantity, state: LINE_STATE.PART_UNKNOWN, entryIds: [o.entryId] }));
      continue;
    }
    if (mode === "SERIAL") {
      if (!o.serialNo) {
        lines.push(Object.freeze({ lineId: `noserial:${o.entryId}`, partId: o.partId, serialNo: null, quantity: 1, state: LINE_STATE.SERIAL_REQUIRED, entryIds: [o.entryId] }));
        continue;
      }
      const serialKey = JSON.stringify([o.partId, o.serialNo]); // unambiguous: no separator a code could contain
      const duplicate = seenSerials.has(serialKey);
      seenSerials.add(serialKey);
      lines.push(Object.freeze({
        lineId: duplicate ? `dup:${o.entryId}` : `serial:${o.partId}:${o.serialNo}`,
        partId: o.partId, serialNo: o.serialNo, quantity: 1,
        state: duplicate ? LINE_STATE.DUPLICATE_SERIAL : LINE_STATE.READY,
        entryIds: [o.entryId],
      }));
      continue;
    }
    if (o.serialNo) {
      lines.push(Object.freeze({ lineId: `serialnotallowed:${o.entryId}`, partId: o.partId, serialNo: o.serialNo, quantity: o.quantity, state: LINE_STATE.SERIAL_NOT_ALLOWED, entryIds: [o.entryId] }));
      continue;
    }
    const existing = noneByPart.get(o.partId);
    if (existing) {
      existing.quantity += o.quantity;
      existing.entryIds.push(o.entryId);
    } else {
      const line = { lineId: `part:${o.partId}`, partId: o.partId, serialNo: null, quantity: o.quantity, state: LINE_STATE.READY, entryIds: [o.entryId] };
      noneByPart.set(o.partId, line);
      lines.push(line);
    }
  }
  return lines.map((l) => Object.freeze({ ...l, entryIds: Object.freeze([...l.entryIds]) }));
}

/** True when the pending lines may be confirmed: at least one line, and nothing blocking. */
export function canConfirm(lines, route) {
  return route?.route !== MOVE_ROUTE.INVALID
    && Array.isArray(lines) && lines.length > 0
    && lines.every((l) => l.state === LINE_STATE.READY);
}

/**
 * Freeze the current lines into batch `batchNo`. Each line gets the key it will use for its first
 * attempt AND every retry, derived from the session, the batch and the line -- so no line can ever
 * replay another's, and a later batch never replays an earlier one.
 */
export function freezeBatch({ sessionId, batchNo, lines, source, destination, route }) {
  return Object.freeze({
    batchNo,
    route: route.route,
    source,
    destination,
    lines: Object.freeze(lines.map((l) => Object.freeze({
      lineId: l.lineId,
      partId: l.partId,
      serialNo: l.serialNo,
      quantity: l.quantity,
      idempotencyKey: `move:${sessionId}:b${batchNo}:${l.lineId}`,
    }))),
  });
}

/** One governed request per frozen line. The operator's endpoints; the server re-checks everything. */
export function toRelocationRequest(batch, line, { recordPlacement = false } = {}) {
  return {
    partId: line.partId,
    source: { type: batch.source.type, locationId: batch.source.locationId },
    destination: { type: batch.destination.type, locationId: batch.destination.locationId },
    ...(line.serialNo ? { serialNumbers: [line.serialNo] } : { quantity: line.quantity }),
    idempotencyKey: line.idempotencyKey,
    ...(recordPlacement ? { recordPlacement: true } : {}),
  };
}

export function toTransferRequest(batch, line) {
  return {
    partId: line.partId,
    origin: { type: batch.source.type, locationId: batch.source.locationId },
    destination: { type: batch.destination.type, locationId: batch.destination.locationId },
    ...(line.serialNo ? { serialNumbers: [line.serialNo] } : { quantity: line.quantity }),
    idempotencyKey: line.idempotencyKey,
  };
}

// ============================ results ============================

export const LINE_RESULT = Object.freeze({
  PENDING: "PENDING",
  APPLIED: "APPLIED",
  /** Already applied by an earlier attempt of THIS line -- nothing moved twice. */
  REPLAYED: "REPLAYED",
  FAILED: "FAILED",
});

/**
 * The failure vocabulary a warehouse operator sees. Never collapsed into "failed" -- each one sends
 * them to a different fix. RETRYABLE_TECHNICAL_FAILURE is the ONLY code retried automatically.
 */
export const FAILURE = Object.freeze({
  UNAUTHENTICATED: "UNAUTHENTICATED",
  DENIED: "DENIED",
  INVALID: "INVALID",
  NOT_FOUND: "NOT_FOUND",
  RETIRED_BIN: "RETIRED_BIN",
  CROSS_WAREHOUSE: "CROSS_WAREHOUSE",
  WRONG_ROUTE: "WRONG_ROUTE",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  SERIAL_NOT_AT_SOURCE: "SERIAL_NOT_AT_SOURCE",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  INTEGRITY: "INTEGRITY",
  // The EOS writer is not switched on in this environment (HTTP 503 NOT_ACTIVATED). Not retried automatically: it
  // will not change by retrying, and it is never sent anywhere else instead.
  NOT_ACTIVATED: "NOT_ACTIVATED",
  RETRYABLE_TECHNICAL_FAILURE: "RETRYABLE_TECHNICAL_FAILURE",
});

export const FAILURE_TEXT = Object.freeze({
  [FAILURE.UNAUTHENTICATED]: "You are signed out. Sign in and try again.",
  [FAILURE.DENIED]: "You are not authorized to make this move.",
  [FAILURE.INVALID]: "This move could not be accepted.",
  [FAILURE.NOT_FOUND]: "Something in this move could not be found.",
  [FAILURE.RETIRED_BIN]: "That location is not in use.",
  [FAILURE.CROSS_WAREHOUSE]: "Those locations are in different warehouses. This needs a transfer.",
  [FAILURE.WRONG_ROUTE]: "Those locations are in the same warehouse. This needs a move, not a transfer.",
  [FAILURE.INSUFFICIENT_STOCK]: "There is not enough of this at the source location.",
  [FAILURE.SERIAL_NOT_AT_SOURCE]: "That serial is not available at the source location.",
  [FAILURE.IDEMPOTENCY_CONFLICT]: "This line was already submitted with different details.",
  [FAILURE.INTEGRITY]: "The stored records for this line are inconsistent. Ask an administrator.",
  [FAILURE.NOT_ACTIVATED]: "Moving stock is not switched on in this environment yet. Nothing was changed.",
  [FAILURE.RETRYABLE_TECHNICAL_FAILURE]: "This did not go through. It is safe to try again.",
});

const TRANSFER_CODE_TO_FAILURE = Object.freeze({
  PERMISSION_DENIED: FAILURE.DENIED,
  INSUFFICIENT_STOCK: FAILURE.INSUFFICIENT_STOCK,
  SAME_CUSTODY_PARENT: FAILURE.WRONG_ROUTE,
  IDEMPOTENCY_CONFLICT: FAILURE.IDEMPOTENCY_CONFLICT,
  ORIGIN_INVALID: FAILURE.RETIRED_BIN,
  DESTINATION_INVALID: FAILURE.RETIRED_BIN,
  SERIAL_INVALID: FAILURE.SERIAL_NOT_AT_SOURCE,
  TRANSFER_INTEGRITY: FAILURE.INTEGRITY,
  MALFORMED_STORED_RECORD: FAILURE.INTEGRITY,
});

const TECHNICAL_CODES = new Set(["unavailable", "deadline-exceeded", "aborted", "resource-exhausted", "cancelled"]);

/** Turn a callable error into the operator's failure code. Unknown and network failures are retryable. */
export function classifyMovementError(err) {
  const raw = typeof err?.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  const detail = err?.details && typeof err.details === "object" ? err.details : null;
  const governed = typeof detail?.code === "string" ? detail.code : null;

  if (governed === FAILURE.RETRYABLE_TECHNICAL_FAILURE) return FAILURE.RETRYABLE_TECHNICAL_FAILURE;
  if (governed && Object.prototype.hasOwnProperty.call(FAILURE, governed)) return governed;
  if (governed && TRANSFER_CODE_TO_FAILURE[governed]) return TRANSFER_CODE_TO_FAILURE[governed];
  if (code === "unauthenticated") return FAILURE.UNAUTHENTICATED;
  if (code === "permission-denied") return FAILURE.DENIED;
  if (code === "invalid-argument") return FAILURE.INVALID;
  if (code === "not-found") return FAILURE.NOT_FOUND;
  // No code at all is a network failure; the listed codes are contention and availability. A retry with
  // the SAME key is safe either way, which is what makes offering it honest.
  if (code === "" || TECHNICAL_CODES.has(code) || code === "internal") return FAILURE.RETRYABLE_TECHNICAL_FAILURE;
  return FAILURE.INVALID;
}

export const isRetryable = (failure) => failure === FAILURE.RETRYABLE_TECHNICAL_FAILURE;

/** A line result, derived from a response or an error. */
export function resultFromResponse(line, response) {
  const replayed = response?.outcome === "replayed";
  return Object.freeze({ lineId: line.lineId, status: replayed ? LINE_RESULT.REPLAYED : LINE_RESULT.APPLIED, failure: null });
}
export function resultFromError(line, err) {
  return Object.freeze({ lineId: line.lineId, status: LINE_RESULT.FAILED, failure: classifyMovementError(err) });
}

/**
 * A summary DERIVED from per-line results. There is no field that says "success": a batch is complete
 * only when every line applied or replayed, and the counts are always shown so a partial result can
 * never hide inside a headline.
 */
export function summarizeBatch(batch, resultsByLineId) {
  const counts = { applied: 0, replayed: 0, failed: 0, retryable: 0, pending: 0 };
  for (const line of batch.lines) {
    const r = resultsByLineId?.[line.lineId];
    if (!r || r.status === LINE_RESULT.PENDING) counts.pending += 1;
    else if (r.status === LINE_RESULT.APPLIED) counts.applied += 1;
    else if (r.status === LINE_RESULT.REPLAYED) counts.replayed += 1;
    else {
      counts.failed += 1;
      if (isRetryable(r.failure)) counts.retryable += 1;
    }
  }
  return Object.freeze({ ...counts, total: batch.lines.length, complete: counts.failed === 0 && counts.pending === 0 });
}

/** The lines a retry would resend: failed AND retryable. Business refusals are never auto-retried. */
export function retryableLines(batch, resultsByLineId) {
  return batch.lines.filter((l) => {
    const r = resultsByLineId?.[l.lineId];
    return r?.status === LINE_RESULT.FAILED && isRetryable(r.failure);
  });
}

// ============================ endpoints from governed resolution ============================

/**
 * How to ask the server about a scanned location. A printed label carries `EOS-LOC:<binId>`, which the
 * shared normalizer reduces to the stable binId -- that is a TOKEN resolve. Anything else is a typed
 * human code, resolved within the session's warehouse. The client never decides a bin exists.
 */
export function binScanRequest(raw, warehouseId, normalize) {
  const token = typeof normalize === "function" ? normalize(raw) : raw;
  if (typeof token === "string" && token.startsWith("bin_")) {
    return Object.freeze({ kind: "token", request: { warehouseId, token } });
  }
  return Object.freeze({ kind: "code", request: { warehouseId, code: raw } });
}

export const BIN_SCAN_TEXT = Object.freeze({
  NOT_FOUND: "No bin with that code in this warehouse.",
  INACTIVE: "That bin is out of use.",
  WRONG_WAREHOUSE: "That bin belongs to a different warehouse.",
  MALFORMED: "That is not a bin label.",
});

/**
 * An endpoint from the trusted bin resolve, or a reason it is not one. The custody parent is the one the
 * SERVER reported for this bin -- never inferred from the code or the label text.
 */
export function endpointFromBinResolution(resolution) {
  const ok = resolution?.result === "FOUND" || resolution?.result === "FOUND_SUPERSEDED_CODE";
  if (!ok || typeof resolution.binId !== "string" || typeof resolution.warehouseId !== "string") {
    return Object.freeze({ endpoint: null, reason: BIN_SCAN_TEXT[resolution?.result] ?? "That bin cannot be used." });
  }
  return Object.freeze({
    endpoint: Object.freeze({
      type: MOVE_ENDPOINT.BIN,
      locationId: resolution.binId,
      custodyWarehouseId: resolution.warehouseId,
      label: resolution.code ?? resolution.binId,
    }),
    reason: null,
  });
}

/** The unbinned stock of a warehouse, as an endpoint. */
export function warehouseEndpoint(warehouse) {
  return Object.freeze({
    type: MOVE_ENDPOINT.WAREHOUSE,
    locationId: warehouse.id,
    custodyWarehouseId: warehouse.id,
    label: `${warehouse.name || warehouse.id} (not in a bin)`,
  });
}
