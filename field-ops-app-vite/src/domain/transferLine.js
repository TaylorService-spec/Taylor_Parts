// Enterprise Inventory -- EI-P1c-3 pure SERIAL transfer-LINE membership contract.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no writes, no Rules, no
// quantities, no LOT/NONE, no custody, no stock math, no QR. It records which serialized
// units are INTENDED (planned) for a SINGLE-part, single-origin, single-destination
// Transfer Order, and reconciles that plan against the actual TRANSFER_OUT/TRANSFER_IN
// ledger events. Node-importable and unit-tested directly (test/transferLine.test.mjs).
//
// GOVERNANCE (authorized EI-P1c-3 decisions):
//   * The parent TransferOrder stays the single-part / single-origin / single-destination
//     intent authority (the merged EI-P1b-2 transferRef). A line NEVER repeats partId or
//     endpoints; it is only { transferOrderId, serialNo, state } with state in
//     { PLANNED, CANCELLED }. Journey states (IN_TRANSIT/RECEIVED/MISSING/UNEXPECTED) are
//     DERIVED from ledger events, never stored on the line.
//   * Membership is editable only PRE-dispatch (order REQUESTED, no TRANSFER_OUT for the
//     serial); a serial may be on at most one active membership.
//   * Multi-part / multi-destination truck routes are a later route/load grouping entity
//     over multiple Transfer Orders -- NOT a weakening of TransferOrder authority.
//
// BOUNDARIES: no persistence, Rules, indexes, Functions, capabilities, QR, UI, migration,
// deployment, or data mutation. Reuses the merged transferRef + ledger-event validators.
import { validateTransferRef, deriveSerialTransferState, TRANSFER_ORDER_STATUSES } from "./inventoryTransferPairing.js";

// Stored line membership states (only these two are persisted).
export const TRANSFER_LINE_STATES = Object.freeze(["PLANNED", "CANCELLED"]);
// Derived reconciliation states (never stored; produced by reconcileTransferLines).
export const TRANSFER_LINE_RECON_STATES = Object.freeze(["PLANNED", "IN_TRANSIT", "RECEIVED", "MISSING", "UNEXPECTED"]);

const LINE_FIELDS = new Set(["transferOrderId", "serialNo", "state"]);

// Firestore document-id byte ceiling (ECMA/Firestore limit); a longer key fails closed.
const TRANSFER_LINE_DOC_KEY_MAX_BYTES = 1500;

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function fail(reason) {
  return { valid: false, value: null, reason };
}

// Collision-safe, deterministic document key for (transferOrderId, serialNo). Raw
// `${transferOrderId}__${serialNo}` is ambiguous (a delimiter inside a segment collides);
// instead each segment is strictly percent-encoded down to [A-Za-z0-9]+%XX so the single
// "-" join is unambiguous and the result is a legal Firestore id (no "/", "." or reserved
// "__..__"). Returns null on empty input or an over-long key.
function strictEncode(segment) {
  return encodeURIComponent(segment).replace(/[-_.!~*'()]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}
export function transferLineDocKey(transferOrderId, serialNo) {
  if (!isNonEmptyString(transferOrderId) || !isNonEmptyString(serialNo)) return null;
  const key = `${strictEncode(transferOrderId)}-${strictEncode(serialNo)}`;
  if (new TextEncoder().encode(key).length > TRANSFER_LINE_DOC_KEY_MAX_BYTES) return null;
  return key;
}

// The line's parent must be a SERIAL-tracked part matching the transferRef.
function checkSerialPart(part, ref) {
  if (!isPlainObject(part) || !isNonEmptyString(part.partId)) return "part_invalid";
  if (part.trackingMode !== "SERIAL") return "unsupported_tracking_mode";
  if (part.partId !== ref.partId) return "part_mismatch";
  return null;
}

// Centralized EXACT line-shape parser. `policy` constrains the state field:
//   "add"     -> state absent OR "PLANNED" (a candidate membership);
//   "planned" -> state present and exactly "PLANNED";
//   "stored"  -> state present and in TRANSFER_LINE_STATES (a persisted line).
// Any extra/unauthorized field (including a stored `id`) is rejected. Returns
// { ok, value:{ transferOrderId, serialNo, state }, reason }.
function parseLine(line, policy) {
  if (!isPlainObject(line)) return { ok: false, reason: "line_invalid" };
  if (Object.keys(line).some((k) => !LINE_FIELDS.has(k))) return { ok: false, reason: "unknown_field" };
  if (!isNonEmptyString(line.transferOrderId)) return { ok: false, reason: "transfer_order_id_invalid" };
  if (!isNonEmptyString(line.serialNo)) return { ok: false, reason: "serial_no_invalid" };
  const hasState = "state" in line;
  let state;
  if (policy === "add") {
    if (hasState && line.state !== "PLANNED") return { ok: false, reason: "state_invalid" };
    state = "PLANNED";
  } else if (policy === "planned") {
    if (line.state !== "PLANNED") return { ok: false, reason: "state_invalid" };
    state = "PLANNED";
  } else {
    if (!TRANSFER_LINE_STATES.includes(line.state)) return { ok: false, reason: "state_invalid" };
    state = line.state;
  }
  return { ok: true, value: { transferOrderId: line.transferOrderId, serialNo: line.serialNo, state }, reason: null };
}

// ---------------------------------------------------------------------------
// validateTransferLine(docId, data, transferRef, part) -- one stored line record.
// ---------------------------------------------------------------------------
export function validateTransferLine(docId, data, transferRef, part) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return fail(ref.reason);
  const partReason = checkSerialPart(part, ref.value);
  if (partReason) return fail(partReason);
  if (!isNonEmptyString(docId)) return fail("doc_id_invalid");
  if (!isPlainObject(data)) return fail("not_object");
  // Authoritative doc id: a stored data.id must not override it.
  if (data.id !== undefined && data.id !== docId) return fail("stored_id_conflict");
  if (Object.keys(data).some((k) => k !== "id" && !LINE_FIELDS.has(k))) return fail("unknown_field");
  if (!isNonEmptyString(data.transferOrderId)) return fail("transfer_order_id_invalid");
  if (data.transferOrderId !== ref.value.transferOrderId) return fail("transfer_order_mismatch");
  if (!isNonEmptyString(data.serialNo)) return fail("serial_no_invalid");
  if (!TRANSFER_LINE_STATES.includes(data.state)) return fail("state_invalid");
  // The doc id must be exactly the collision-safe composite key.
  const key = transferLineDocKey(data.transferOrderId, data.serialNo);
  if (key === null || docId !== key) return fail("doc_key_mismatch");
  return { valid: true, value: { transferOrderId: data.transferOrderId, serialNo: data.serialNo, state: data.state }, reason: null };
}

// ---------------------------------------------------------------------------
// composeLineTransferRef(line, transferRef) -- bind a line to its parent order and yield
// the parent transferRef UNCHANGED (same part/endpoints/status) for the pairing validators.
// ---------------------------------------------------------------------------
export function composeLineTransferRef(line, transferRef) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return fail(ref.reason);
  const parsed = parseLine(line, "planned");
  if (!parsed.ok) return fail(parsed.reason);
  if (parsed.value.transferOrderId !== ref.value.transferOrderId) return fail("transfer_order_mismatch");
  return { valid: true, value: ref.value, reason: null };
}

// ---------------------------------------------------------------------------
// validateAddLine -- add a serial's membership. Legal only when the order is REQUESTED,
// the serial has no TRANSFER_OUT event, and the serial has no other active membership.
// The candidate line must be an exact shape with state absent or PLANNED.
// ---------------------------------------------------------------------------
export function validateAddLine(line, transferRef, { serialHasOutEvent = false, activeMemberships = [] } = {}) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return fail(ref.reason);
  const parsed = parseLine(line, "add");
  if (!parsed.ok) return fail(parsed.reason);
  if (parsed.value.transferOrderId !== ref.value.transferOrderId) return fail("transfer_order_mismatch");
  if (ref.value.status !== "REQUESTED") return fail("status_forbids_add");
  if (serialHasOutEvent === true) return fail("already_dispatched");
  if (!Array.isArray(activeMemberships)) return fail("active_memberships_invalid");
  let sameOrder = false;
  let otherOrder = false;
  for (const m of activeMemberships) {
    const otherId = typeof m === "string" ? m : isPlainObject(m) ? m.transferOrderId : null;
    if (!isNonEmptyString(otherId)) return fail("active_memberships_invalid");
    if (otherId === parsed.value.transferOrderId) sameOrder = true;
    else otherOrder = true;
  }
  if (otherOrder) return fail("duplicate_active_membership");
  if (sameOrder) return fail("already_member");
  return { valid: true, value: parsed.value, reason: null };
}

// ---------------------------------------------------------------------------
// validateRemoveLine -- cancel a serial's membership. Legal only when the order is
// REQUESTED and the serial has no TRANSFER_OUT event. Requires a PLANNED line.
// ---------------------------------------------------------------------------
export function validateRemoveLine(line, transferRef, { serialHasOutEvent = false } = {}) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return fail(ref.reason);
  const parsed = parseLine(line, "planned");
  if (!parsed.ok) return fail(parsed.reason);
  if (parsed.value.transferOrderId !== ref.value.transferOrderId) return fail("transfer_order_mismatch");
  if (ref.value.status !== "REQUESTED") return fail("status_forbids_remove");
  if (serialHasOutEvent === true) return fail("already_dispatched");
  return { valid: true, value: { transferOrderId: parsed.value.transferOrderId, serialNo: parsed.value.serialNo, state: "CANCELLED" }, reason: null };
}

// ---------------------------------------------------------------------------
// reconcileTransferLines({ transferRef, lines, events, part }) -- planned membership vs
// actual ledger events. The per-serial ACTUAL state is DELEGATED to the merged pairing
// contract (deriveSerialTransferState), which enforces EI-P1b-2 status consistency
// (IN_TRANSIT permits OUT-only; COMPLETED requires OUT+IN). This function only overlays the
// plan on top: MISSING (planned, no events once dispatched) and UNEXPECTED (an evented
// serial with no planned line), plus fail-closed on events for a CANCELLED line. Returns
// { valid, states, reason }; states = [{ serialNo, reconState }] sorted. No quantity math.
//   REQUESTED + planned/no events            -> PLANNED
//   IN_TRANSIT + OUT only                    -> IN_TRANSIT
//   COMPLETED + OUT+IN                        -> RECEIVED
//   IN_TRANSIT/COMPLETED + planned/no OUT     -> MISSING
//   event for a serial with no planned line   -> UNEXPECTED
//   event for a CANCELLED line                -> fail closed
//   (any status/pairing inconsistency from the merged contract propagates as its reason)
// ---------------------------------------------------------------------------
export function reconcileTransferLines({ transferRef, lines, events, part } = {}) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return { valid: false, states: null, reason: ref.reason };
  const partReason = checkSerialPart(part, ref.value);
  if (partReason) return { valid: false, states: null, reason: partReason };
  if (!Array.isArray(lines) || !Array.isArray(events)) return { valid: false, states: null, reason: "input_invalid" };

  const orderId = ref.value.transferOrderId;
  const eventsAllowed = ref.value.status === "IN_TRANSIT" || ref.value.status === "COMPLETED";

  // Planned / cancelled membership sets (exact line shape; a serial may not appear twice).
  const planned = new Set();
  const cancelled = new Set();
  for (const line of lines) {
    const parsed = parseLine(line, "stored");
    if (!parsed.ok) return { valid: false, states: null, reason: parsed.reason };
    if (parsed.value.transferOrderId !== orderId) return { valid: false, states: null, reason: "transfer_order_mismatch" };
    if (planned.has(parsed.value.serialNo) || cancelled.has(parsed.value.serialNo)) return { valid: false, states: null, reason: "duplicate_line" };
    (parsed.value.state === "PLANNED" ? planned : cancelled).add(parsed.value.serialNo);
  }

  const states = [];
  if (events.length === 0) {
    // Nothing dispatched: every planned serial is PLANNED (pre-dispatch) or MISSING (dispatched).
    for (const serialNo of planned) states.push({ serialNo, reconState: eventsAllowed ? "MISSING" : "PLANNED" });
  } else {
    // DELEGATE actual-state validation to the merged pairing contract (status-consistent).
    const derived = deriveSerialTransferState(transferRef, events, part);
    if (!derived.valid) return { valid: false, states: null, reason: derived.reason };
    const evented = new Set();
    for (const { serialNo, state } of derived.states) {
      evented.add(serialNo);
      if (cancelled.has(serialNo)) return { valid: false, states: null, reason: "events_for_cancelled_line" };
      states.push({ serialNo, reconState: planned.has(serialNo) ? state : "UNEXPECTED" });
    }
    // events non-empty => status is IN_TRANSIT/COMPLETED => planned-but-not-evented is MISSING.
    for (const serialNo of planned) {
      if (!evented.has(serialNo)) states.push({ serialNo, reconState: "MISSING" });
    }
  }

  states.sort((a, b) => (a.serialNo < b.serialNo ? -1 : a.serialNo > b.serialNo ? 1 : 0));
  return { valid: true, states, reason: null };
}

// Re-exported for callers that want the parent status vocabulary alongside line contracts.
export { TRANSFER_ORDER_STATUSES };
