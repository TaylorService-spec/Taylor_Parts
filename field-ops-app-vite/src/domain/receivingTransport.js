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
