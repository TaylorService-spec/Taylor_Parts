// EI Receiving -- PURE transport contract for the two frozen E1 callables. It mirrors, on the
// client, the EXACT frozen request/response/error contracts pinned in
// functions/src/inventoryReceiving/receivingCallables.ts (E1, PR #551): request builders that
// send only the frozen fields, response validators that reject unknown fields, and an error
// mapper over ONLY the frozen public codes. No Firebase, no transport, no I/O -- every function
// is a pure value transform, Node-importable and unit-tested. The thin client
// (services/receivingCallableClient.js) performs the actual httpsCallable invocation.

// Deployed callable names (functions/src/index.ts re-exports the *Callable symbols under these).
export const CALLABLE_NAMES = Object.freeze({
  receive: "receiveInventoryStock",
  listOptions: "listReceivingLocationOptions",
  // Phase D reads. Both are gated on the SAME inventory.stock.receive capability as the write.
  progress: "getPurchaseOrderReceivingProgress",
  listReceivable: "listReceivablePurchaseOrders",
});

// Bounded, SANITIZED frontend outcome vocabulary. A transport result carries only one of these
// status strings (never a raw backend message/path/details).
export const RECEIVING_OUTCOME = Object.freeze({
  READY: "ready", // options fetched + adapted
  APPLIED: "applied", // receipt applied
  REPLAYED: "replayed", // idempotent replay of a prior receipt
  UNAUTHENTICATED: "unauthenticated",
  DENIED: "denied", // permission-denied
  INVALID: "invalid", // invalid-argument / malformed client request
  NOT_FOUND: "not_found",
  CONFLICT: "conflict", // failed-precondition
  UNAVAILABLE: "unavailable", // not-ready / internal / malformed response / unknown code (generic fail closed)
});

// The frozen public HttpsError codes (receivingCallables.ts error matrices).
const FROZEN_ERROR_CODES = Object.freeze({
  "unauthenticated": RECEIVING_OUTCOME.UNAUTHENTICATED,
  "permission-denied": RECEIVING_OUTCOME.DENIED,
  "invalid-argument": RECEIVING_OUTCOME.INVALID,
  "not-found": RECEIVING_OUTCOME.NOT_FOUND,
  "failed-precondition": RECEIVING_OUTCOME.CONFLICT,
  "internal": RECEIVING_OUTCOME.UNAVAILABLE,
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNonBlankString(v) {
  return typeof v === "string" && v.trim() !== "";
}
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function hasExactKeys(obj, keys) {
  const k = Object.keys(obj);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(obj, x));
}

// ---- receive request (mirrors validateReceiveRequest; exact frozen fields only) ----
const RECEIVE_TOP_KEYS = ["source", "receivingLocation", "lines", "idempotencyKey"];
const SOURCE_KEYS = ["type", "reorderRequestId", "purchaseOrderId"];
const LOCATION_KEYS = ["type", "locationId"];
// A SERIAL line additionally carries serialNumbers. It is OPTIONAL at this layer: a NONE receipt
// must not send the key at all (the server rejects it there), and only the server knows the Part's
// authoritative tracking mode. hasExactKeys is therefore replaced by an explicit optional-key check
// for lines -- keeping the "no unknown key can ride along" guarantee while allowing this one.
const LINE_KEYS = ["lineId", "partId", "expectedQuantity", "receivedQuantity"];
const LINE_OPTIONAL_KEYS = ["serialNumbers"];

// Validate + SANITIZE the caller's receive request into the exact frozen payload, rebuilt from
// validated fields (so no unknown key can ride along). Returns a frozen payload, or null if the
// request is malformed (an unknown key, wrong type, wrong constant, or line-count != 1). The
// idempotencyKey is preserved VERBATIM and is never generated here. Never mutates the input.
export function buildReceiveRequest(request) {
  if (!isPlainObject(request) || !hasExactKeys(request, RECEIVE_TOP_KEYS)) return null;
  const source = request.source;
  if (!isPlainObject(source) || !hasExactKeys(source, SOURCE_KEYS)) return null;
  if (source.type !== "REORDER_PURCHASE_ORDER") return null;
  if (!isNonBlankString(source.reorderRequestId) || !isNonBlankString(source.purchaseOrderId)) return null;
  const loc = request.receivingLocation;
  if (!isPlainObject(loc) || !hasExactKeys(loc, LOCATION_KEYS)) return null;
  if (loc.type !== "WAREHOUSE") return null;
  if (!isNonBlankString(loc.locationId)) return null;
  const lines = request.lines;
  if (!Array.isArray(lines) || lines.length !== 1) return null;
  const line = lines[0];
  if (!isPlainObject(line)) return null;
  // every required key present, and every present key either required or the one allowed optional key
  if (!LINE_KEYS.every((k) => Object.prototype.hasOwnProperty.call(line, k))) return null;
  if (!Object.keys(line).every((k) => LINE_KEYS.includes(k) || LINE_OPTIONAL_KEYS.includes(k))) return null;
  if (!isNonBlankString(line.lineId) || !isNonBlankString(line.partId)) return null;
  if (!isFiniteNumber(line.expectedQuantity) || !isFiniteNumber(line.receivedQuantity)) return null;
  let serialNumbers = null;
  if (line.serialNumbers !== undefined) {
    if (!Array.isArray(line.serialNumbers) || line.serialNumbers.length === 0) return null;
    if (!line.serialNumbers.every((s) => isNonBlankString(s))) return null;
    serialNumbers = line.serialNumbers.map((s) => s.trim());
  }
  if (!isNonBlankString(request.idempotencyKey)) return null;
  return Object.freeze({
    source: Object.freeze({ type: "REORDER_PURCHASE_ORDER", reorderRequestId: source.reorderRequestId, purchaseOrderId: source.purchaseOrderId }),
    receivingLocation: Object.freeze({ type: "WAREHOUSE", locationId: loc.locationId }),
    lines: Object.freeze([Object.freeze({
      lineId: line.lineId, partId: line.partId,
      expectedQuantity: line.expectedQuantity, receivedQuantity: line.receivedQuantity,
      // Rebuilt, not spread: the key is present ONLY when the caller supplied it.
      ...(serialNumbers === null ? {} : { serialNumbers: Object.freeze(serialNumbers) }),
    })]),
    idempotencyKey: request.idempotencyKey,
  });
}

// The options request is the EXACT empty object {} (validateEmptyRequest on the server).
export const OPTIONS_REQUEST = Object.freeze({});

// ---- response validators (reject unknown fields; fail closed to null) ----

// Options response must be exactly { options: [...] } (array). Elements are validated downstream
// by receivingLocationOptionAdapter. Returns the options array, or null if the envelope is malformed.
export function validateOptionsResponse(data) {
  if (!isPlainObject(data) || !hasExactKeys(data, ["options"])) return null;
  if (!Array.isArray(data.options)) return null;
  return data.options;
}

// Receipt response must be exactly { outcome:"applied"|"replayed", receivingId, ledgerEventId }.
// Returns a frozen sanitized outcome, or null if malformed / has unknown fields.
export function validateReceiveResponse(data) {
  if (!isPlainObject(data) || !hasExactKeys(data, ["outcome", "receivingId", "ledgerEventId"])) return null;
  if (data.outcome !== "applied" && data.outcome !== "replayed") return null;
  if (!isNonBlankString(data.receivingId) || !isNonBlankString(data.ledgerEventId)) return null;
  return Object.freeze({ outcome: data.outcome, receivingId: data.receivingId, ledgerEventId: data.ledgerEventId });
}

// ---- error mapping (frozen codes only -> bounded sanitized status) ----

// Map a callable error to a bounded RECEIVING_OUTCOME status. The client FirebaseError code is
// like "functions/permission-denied"; a raw server code is "permission-denied". Only the frozen
// codes are recognized; an unknown code, a missing/non-string code, or any malformed error fails
// closed to UNAVAILABLE. NEVER returns the raw message/details/path.
export function mapCallableErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return Object.prototype.hasOwnProperty.call(FROZEN_ERROR_CODES, code) ? FROZEN_ERROR_CODES[code] : RECEIVING_OUTCOME.UNAVAILABLE;
}

// Exported for focused tests only.
export const __test__ = Object.freeze({ RECEIVE_TOP_KEYS, SOURCE_KEYS, LOCATION_KEYS, LINE_KEYS });

// ═════════════════════════════ CANONICAL MULTI-LINE RECEIPT ═════════════════════════════
//
// The canonical batch shape, added alongside the legacy one. Both build a request for the SAME
// callable and the same server-side receiving core (§9) -- this is a second REQUEST BUILDER, never a
// second domain service, and neither shape implements any receiving rule of its own.
//
// WHAT DIFFERS FROM LEGACY, and why:
//   - the source names a purchase order and carries NO reorderRequestId. A canonical PO has no
//     reorder request, and the server REJECTS a canonical source that claims one rather than
//     trimming it, so sending one would be a request that disagrees with itself.
//   - many lines are permitted.
//   - a line carries NO expectedQuantity. What remains is a server fact derived from committed
//     receipts; letting a client state it would let a caller widen its own limit. The legacy builder
//     still sends it, because deployed callers do and the server checks it against the order.
//   - `expectedVersion` is optional optimistic concurrency against the PO the caller actually saw.

const CANONICAL_TOP_KEYS = ["source", "receivingLocation", "lines", "idempotencyKey"];
const CANONICAL_SOURCE_KEYS = ["type", "purchaseOrderId"];
const CANONICAL_LINE_KEYS = ["lineId", "partId", "receivedQuantity"];
const CANONICAL_LINE_OPTIONAL_KEYS = ["serialNumbers"];

/**
 * Build a canonical multi-line receive request, or null if the caller's input is not usable.
 *
 * Returns null rather than throwing or repairing, exactly like buildReceiveRequest: a malformed
 * request is refused CLIENT-SIDE without ever invoking the callable.
 */
export function buildCanonicalReceiveRequest(request) {
  if (!isPlainObject(request)) return null;
  const allowedTop = [...CANONICAL_TOP_KEYS, "expectedVersion"];
  if (!CANONICAL_TOP_KEYS.every((k) => Object.prototype.hasOwnProperty.call(request, k))) return null;
  if (!Object.keys(request).every((k) => allowedTop.includes(k))) return null;

  const source = request.source;
  if (!isPlainObject(source) || !hasExactKeys(source, CANONICAL_SOURCE_KEYS)) return null;
  if (source.type !== "PURCHASE_ORDER") return null;
  if (!isNonBlankString(source.purchaseOrderId)) return null;

  const loc = request.receivingLocation;
  if (!isPlainObject(loc) || !hasExactKeys(loc, LOCATION_KEYS)) return null;
  if (loc.type !== "WAREHOUSE") return null;
  if (!isNonBlankString(loc.locationId)) return null;

  const lines = request.lines;
  if (!Array.isArray(lines) || lines.length === 0) return null;

  const seen = new Set();
  const built = [];
  for (const line of lines) {
    if (!isPlainObject(line)) return null;
    if (!CANONICAL_LINE_KEYS.every((k) => Object.prototype.hasOwnProperty.call(line, k))) return null;
    if (!Object.keys(line).every((k) => CANONICAL_LINE_KEYS.includes(k) || CANONICAL_LINE_OPTIONAL_KEYS.includes(k))) return null;
    if (!isNonBlankString(line.lineId) || !isNonBlankString(line.partId)) return null;
    // A duplicate line makes the intended quantity ambiguous. Refused here so it never reaches the
    // wire, and refused again server-side, which is the authority.
    if (seen.has(line.lineId)) return null;
    seen.add(line.lineId);
    if (!isFiniteNumber(line.receivedQuantity) || line.receivedQuantity <= 0) return null;

    let serialNumbers = null;
    if (line.serialNumbers !== undefined) {
      if (!Array.isArray(line.serialNumbers) || line.serialNumbers.length === 0) return null;
      if (!line.serialNumbers.every((s) => isNonBlankString(s))) return null;
      serialNumbers = line.serialNumbers.map((s) => s.trim());
    }
    built.push(Object.freeze({
      lineId: line.lineId,
      partId: line.partId,
      receivedQuantity: line.receivedQuantity,
      ...(serialNumbers === null ? {} : { serialNumbers: Object.freeze(serialNumbers) }),
    }));
  }

  if (!isNonBlankString(request.idempotencyKey)) return null;
  if (request.expectedVersion !== undefined) {
    if (!isFiniteNumber(request.expectedVersion) || request.expectedVersion < 0) return null;
  }

  return Object.freeze({
    source: Object.freeze({ type: "PURCHASE_ORDER", purchaseOrderId: source.purchaseOrderId }),
    receivingLocation: Object.freeze({ type: "WAREHOUSE", locationId: loc.locationId }),
    lines: Object.freeze(built),
    idempotencyKey: request.idempotencyKey,
    ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
  });
}

const RESULT_LINE_KEYS = ["lineId", "partId", "orderedQuantity", "previouslyReceived", "receivedNow", "remainingQuantity", "state"];
const DERIVED_STATES = ["NOT_RECEIVED", "PARTIALLY_RECEIVED", "RECEIVED"];

/**
 * Validate the multi-line receipt response.
 *
 * BOUNDED AND ALLOW-LISTED, like every other response validator here: only the named fields survive,
 * so no internal fingerprint, stack, authority-selection detail or unrestricted document data can
 * reach the UI even if a future server version were to send it. A malformed response returns null
 * rather than a partially-trusted object.
 */
export function validateCanonicalReceiveResponse(data) {
  if (!isPlainObject(data)) return null;
  if (data.outcome !== "applied" && data.outcome !== "replayed") return null;
  if (!isNonBlankString(data.receivingId) || !isNonBlankString(data.purchaseOrderId)) return null;
  if (!isNonBlankString(data.ledgerEventId)) return null;
  if (!DERIVED_STATES.includes(data.derivedState)) return null;
  // storedStatus is the PO's procurement lifecycle, a DIFFERENT concept from derivedState. Null is
  // legitimate (a legacy source has no canonical PO status), so it is checked but not required.
  if (data.storedStatus !== null && !isNonBlankString(data.storedStatus)) return null;
  if (!Array.isArray(data.lines) || data.lines.length === 0) return null;

  const lines = [];
  for (const l of data.lines) {
    if (!isPlainObject(l) || !hasExactKeys(l, RESULT_LINE_KEYS)) return null;
    if (!isNonBlankString(l.lineId) || !isNonBlankString(l.partId)) return null;
    for (const n of ["orderedQuantity", "previouslyReceived", "receivedNow", "remainingQuantity"]) {
      if (!isFiniteNumber(l[n]) || l[n] < 0) return null;
    }
    if (!DERIVED_STATES.includes(l.state)) return null;
    lines.push(Object.freeze({ ...l }));
  }

  return Object.freeze({
    outcome: data.outcome,
    receivingId: data.receivingId,
    purchaseOrderId: data.purchaseOrderId,
    ledgerEventId: data.ledgerEventId,
    derivedState: data.derivedState,
    storedStatus: data.storedStatus ?? null,
    lines: Object.freeze(lines),
  });
}

const PROGRESS_LINE_KEYS = ["lineId", "partId", "trackingMode", "orderedQuantity", "receivedQuantity", "remainingQuantity", "state"];
const TRACKING_MODES = ["NONE", "SERIAL", "LOT", "UNKNOWN"];

/**
 * Validate the canonical purchase-order PROGRESS response.
 *
 * Allow-listed like every other response validator here: only the named fields survive, so nothing
 * internal can reach the UI even if a future server version sent it. A malformed response returns
 * null rather than a partially-trusted object — which matters more here than usual, because these
 * numbers are what the scan queue reconciles against.
 *
 * `trackingMode` is validated against a closed set INCLUDING "UNKNOWN". An unresolvable Part is
 * reported honestly rather than defaulted to NONE: defaulting would tell an operator a serialized
 * part needs no serial, and the receipt would then be refused for a reason the screen had actively
 * contradicted.
 */
export function validatePurchaseOrderProgress(data) {
  if (!isPlainObject(data)) return null;
  if (!isNonBlankString(data.purchaseOrderId)) return null;
  if (typeof data.receivable !== "boolean") return null;
  if (!isFiniteNumber(data.version) || data.version < 0) return null;
  if (!isNonBlankString(data.derivedState)) return null;
  if (data.storedStatus !== null && !isNonBlankString(data.storedStatus)) return null;
  if (!Array.isArray(data.lines)) return null;

  const lines = [];
  for (const l of data.lines) {
    if (!isPlainObject(l) || !hasExactKeys(l, PROGRESS_LINE_KEYS)) return null;
    if (!isNonBlankString(l.lineId) || !isNonBlankString(l.partId)) return null;
    if (!TRACKING_MODES.includes(l.trackingMode)) return null;
    for (const n of ["orderedQuantity", "receivedQuantity", "remainingQuantity"]) {
      if (!isFiniteNumber(l[n]) || l[n] < 0) return null;
    }
    if (!isNonBlankString(l.state)) return null;
    lines.push(Object.freeze({ ...l }));
  }

  return Object.freeze({
    purchaseOrderId: data.purchaseOrderId,
    supplierId: data.supplierId ?? null,
    supplierName: data.supplierName ?? null,
    storedStatus: data.storedStatus ?? null,
    derivedState: data.derivedState,
    receivable: data.receivable,
    version: data.version,
    lines: Object.freeze(lines),
  });
}
