// LEDGER ROW INTEGRITY, client side (Controller ruling DQ-027, 2026-09-28): never silently omit malformed
// ledger evidence. Unaffected metrics stay truthful; an AFFECTED part or section says INCOMPLETE /
// UNAVAILABLE with a reason -- rows are never skipped, never replaced by zero, parts never dropped.
//
// ════════════════════ WHAT "READABLE" MEANS HERE ════════════════════
//
// The server's strict stored-record reader (functions/src/inventoryLedger/operationalMovementRepository.ts
// classifyLedgerDoc + deserializeOperationalMovement) is THE definition. This module mirrors its verdict
// -- readable or not -- for the rows the client reads directly, and
// functions/test/ledgerRowIntegrityParity.test.mjs pins the two to the SAME answer over a shared matrix,
// so they cannot drift silently. The only representational difference is the stored timestamp: the
// server holds an Admin-SDK Timestamp, the client an SDK Timestamp; both are "a Timestamp", checked here
// by shape (toMillis) rather than by class.
//
//   LEGACY       no schemaVersion, a legacy commitment type (RESERVED / RELEASED / CONSUMED) -- readable,
//                the governed location-less population, excluded from physical sums by type.
//   OPERATIONAL  schemaVersion 2 and every stored field well-formed -- readable.
//   anything else  UNREADABLE. Its part (if it names one) cannot be answered; a row naming no part makes
//                every part unanswerable, because nobody can say which part it would have moved.
//
// PURE. No Firebase, no I/O.

const OPERATIONAL_SCHEMA_VERSION = 2;
const LEGACY_TYPES = Object.freeze(["RESERVED", "RELEASED", "CONSUMED"]);
const DIRECTION = Object.freeze({
  RECEIVED: "IN", RETURNED: "IN", TRANSFER_IN: "IN", TRANSFER_OUT: "OUT", SCRAPPED: "OUT",
  ADJUSTED: "SIGNED", WORK_ORDER_CONSUMPTION: "SIGNED", RELOCATION_OUT: "OUT", RELOCATION_IN: "IN",
});
const SOURCE_TYPE = Object.freeze({
  RECEIVED: "RECEIVING_ORDER", RETURNED: "RMA", TRANSFER_OUT: "TRANSFER_ORDER", TRANSFER_IN: "TRANSFER_ORDER",
  ADJUSTED: "ADJUSTMENT", SCRAPPED: "SCRAP", WORK_ORDER_CONSUMPTION: "WORK_ORDER",
  RELOCATION_OUT: "STOCK_RELOCATION", RELOCATION_IN: "STOCK_RELOCATION",
});
const SOURCE_TYPES = Object.freeze(["WORK_ORDER", "RECEIVING_ORDER", "TRANSFER_ORDER", "ADJUSTMENT", "RMA", "SCRAP", "STOCK_RELOCATION"]);
const COUNTERPARTY_TYPES = new Set(["TRANSFER_OUT", "TRANSFER_IN", "RELOCATION_OUT", "RELOCATION_IN"]);
const LOCATION_TYPES = Object.freeze(["WAREHOUSE", "BIN", "MOBILE", "VENDOR", "CUSTOMER", "VIRTUAL"]);
const TRACKING_MODES = Object.freeze(["NONE", "SERIAL", "LOT"]);
const SYSTEM_ACTOR_IDS = Object.freeze(["WORK_ORDER_TRANSITION"]);
const BASE_KEYS = Object.freeze([
  "schemaVersion", "type", "direction", "partId", "trackingMode", "location", "quantity",
  "sourceObject", "idempotencyKey", "actor", "occurredAt", "recordedAt", "fingerprint",
]);
const MAX_EPOCH_MILLIS = 8_640_000_000_000_000;

const isPlain = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const nonBlank = (v) => typeof v === "string" && v.trim() !== "";
const companyShape = (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{1,62}$/.test(v);
const exactPair = (o, a, b) => {
  const k = Object.keys(o);
  return k.length === 2 && k.every((x) => x === a || x === b);
};
function locationOk(ref) {
  return isPlain(ref) && exactPair(ref, "type", "locationId")
    && typeof ref.type === "string" && LOCATION_TYPES.includes(ref.type) && nonBlank(ref.locationId);
}
function quantityOk(mode, direction, q) {
  if (typeof q !== "number" || !Number.isFinite(q)) return false;
  if (mode === "SERIAL") return q === 1;
  if (direction === "SIGNED") return q !== 0;
  return q > 0;
}
const isTimestampLike = (v) => isPlain(v) && typeof v.toMillis === "function";

/** "legacy" | "operational" | "unreadable" -- the server's verdict, mirrored. */
export function classifyLedgerRow(data) {
  if (!isPlain(data)) return "unreadable";
  const type = data.type;
  if (data.schemaVersion === undefined) {
    return typeof type === "string" && LEGACY_TYPES.includes(type) ? "legacy" : "unreadable";
  }
  if (data.schemaVersion !== OPERATIONAL_SCHEMA_VERSION || typeof type !== "string" || !(type in DIRECTION)) return "unreadable";
  const direction = DIRECTION[type];
  const transfer = COUNTERPARTY_TYPES.has(type);
  const mode = data.trackingMode;
  if (typeof mode !== "string" || !TRACKING_MODES.includes(mode)) return "unreadable";
  const allowed = new Set(BASE_KEYS);
  if (mode === "SERIAL") allowed.add("serialNo");
  if (mode === "LOT") allowed.add("lotId");
  if (transfer) { allowed.add("counterpartyLocation"); allowed.add("sourceOperatingCompanyId"); allowed.add("destinationOperatingCompanyId"); }
  allowed.add("operatingCompanyId");
  // `id` is the DOCUMENT id the client read merges in (services/operationsQueries.ts listCollection:
  // { id: d.id, ...d.data() }), not a stored field -- so it is the one key the client sees that the stored
  // record does not carry.
  allowed.add("id");
  if (Object.keys(data).some((k) => !allowed.has(k))) return "unreadable";
  // Ownership shape: a scalar owner, or a participating pair, never half a pair, never both.
  const scalar = data.operatingCompanyId, src = data.sourceOperatingCompanyId, dst = data.destinationOperatingCompanyId;
  if (scalar !== undefined && !companyShape(scalar)) return "unreadable";
  if ((src === undefined) !== (dst === undefined)) return "unreadable";
  if (src !== undefined && (!companyShape(src) || !companyShape(dst))) return "unreadable";
  if (scalar !== undefined && src !== undefined) return "unreadable";
  if (data.direction !== direction) return "unreadable";
  if (!nonBlank(data.partId)) return "unreadable";
  if (!locationOk(data.location)) return "unreadable";
  if (mode === "SERIAL" && !nonBlank(data.serialNo)) return "unreadable";
  if (mode === "LOT" && !nonBlank(data.lotId)) return "unreadable";
  if (transfer) {
    if (!locationOk(data.counterpartyLocation)) return "unreadable";
    if (data.counterpartyLocation.type === data.location.type && data.counterpartyLocation.locationId === data.location.locationId) return "unreadable";
  }
  if (!quantityOk(mode, direction, data.quantity)) return "unreadable";
  const so = data.sourceObject;
  if (!isPlain(so) || !exactPair(so, "type", "id") || typeof so.type !== "string" || !SOURCE_TYPES.includes(so.type) || !nonBlank(so.id) || so.type !== SOURCE_TYPE[type]) return "unreadable";
  if (!nonBlank(data.idempotencyKey)) return "unreadable";
  const actor = data.actor;
  if (!isPlain(actor) || !exactPair(actor, "kind", "id") || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !nonBlank(actor.id)) return "unreadable";
  if (actor.kind === "SYSTEM" && !SYSTEM_ACTOR_IDS.includes(actor.id)) return "unreadable";
  if (typeof data.occurredAt !== "number" || !Number.isInteger(data.occurredAt) || data.occurredAt <= 0 || data.occurredAt > MAX_EPOCH_MILLIS) return "unreadable";
  if (!isTimestampLike(data.recordedAt)) return "unreadable";
  if (typeof data.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(data.fingerprint)) return "unreadable";
  return "operational";
}

export const LEDGER_INTEGRITY_STATE = Object.freeze({ COMPLETE: "COMPLETE", INCOMPLETE: "INCOMPLETE", UNAVAILABLE: "UNAVAILABLE" });
export const LEDGER_UNREADABLE_REASON = "LEDGER_ROW_UNREADABLE";

/**
 * Partition raw ledger documents for an analytics read.
 *
 * - `readable`: every legacy and operational row, UNCHANGED (the caller normalizes as before);
 * - `unavailablePartIds`: parts named by an unreadable row -- their figures cannot be derived;
 * - `state`: COMPLETE (nothing unreadable), INCOMPLETE (some parts unavailable, the rest truthful), or
 *   UNAVAILABLE (an unreadable row names no part, so NO part's figure can be trusted).
 * Row CONTENTS are never surfaced; only counts and part ids.
 */
export function partitionLedgerIntegrity(docs) {
  const readable = [];
  const unavailable = new Set();
  let unreadableRows = 0;
  let unattributableRows = 0;
  for (const doc of Array.isArray(docs) ? docs : []) {
    const verdict = classifyLedgerRow(doc);
    if (verdict !== "unreadable") { readable.push(doc); continue; }
    unreadableRows += 1;
    if (isPlain(doc) && nonBlank(doc.partId)) unavailable.add(doc.partId);
    else unattributableRows += 1;
  }
  const state = unattributableRows > 0 ? LEDGER_INTEGRITY_STATE.UNAVAILABLE
    : unavailable.size > 0 ? LEDGER_INTEGRITY_STATE.INCOMPLETE : LEDGER_INTEGRITY_STATE.COMPLETE;
  return Object.freeze({
    state,
    reason: state === LEDGER_INTEGRITY_STATE.COMPLETE ? null : LEDGER_UNREADABLE_REASON,
    readable: Object.freeze(unattributableRows > 0 ? [] : readable.filter((d) => !unavailable.has(d.partId))),
    unavailablePartIds: Object.freeze([...unavailable].sort()),
    unreadableRows,
    unattributableRows,
  });
}

/** Thrown by a reader whose contract cannot express partial completeness (the whole read fails, honestly). */
export class LedgerIntegrityError extends Error {
  constructor(integrity) {
    super(integrity.state === LEDGER_INTEGRITY_STATE.UNAVAILABLE
      ? "Inventory figures are unavailable: a ledger record cannot be read or attributed to a part."
      : `Inventory figures are incomplete: ${integrity.unavailablePartIds.length} part(s) have a ledger record that cannot be read.`);
    this.name = "LedgerIntegrityError";
    this.code = LEDGER_UNREADABLE_REASON;
    this.integrity = integrity;
  }
}

/** The sentence a surface shows for a part whose figures cannot be derived. Never a number. */
export const LEDGER_UNAVAILABLE_TEXT = "Unavailable — a ledger record for this part cannot be read";
