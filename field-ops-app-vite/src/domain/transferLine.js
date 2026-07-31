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
import { validateTransferRef, TRANSFER_ORDER_STATUSES } from "./inventoryTransferPairing.js";
import { validateInventoryMovementEvent } from "./inventoryLedgerEvent.js";

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

function sameLocation(a, b) {
  return a.type === b.type && a.locationId === b.locationId;
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
  if (!isPlainObject(line) || !isNonEmptyString(line.transferOrderId) || !isNonEmptyString(line.serialNo)) return fail("line_invalid");
  if (line.transferOrderId !== ref.value.transferOrderId) return fail("transfer_order_mismatch");
  return { valid: true, value: ref.value, reason: null };
}

// Shared line + parent binding used by add/remove.
function bindLine(line, ref) {
  if (!isPlainObject(line) || !isNonEmptyString(line.transferOrderId) || !isNonEmptyString(line.serialNo)) return "line_invalid";
  if (line.transferOrderId !== ref.transferOrderId) return "transfer_order_mismatch";
  return null;
}

// ---------------------------------------------------------------------------
// validateAddLine -- add a serial's membership. Legal only when the order is REQUESTED,
// the serial has no TRANSFER_OUT event, and the serial has no other active membership.
// ---------------------------------------------------------------------------
export function validateAddLine(line, transferRef, { serialHasOutEvent = false, activeMemberships = [] } = {}) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return fail(ref.reason);
  const bindReason = bindLine(line, ref.value);
  if (bindReason) return fail(bindReason);
  if (line.state !== undefined && line.state !== "PLANNED") return fail("state_invalid");
  if (ref.value.status !== "REQUESTED") return fail("status_forbids_add");
  if (serialHasOutEvent === true) return fail("already_dispatched");
  if (!Array.isArray(activeMemberships)) return fail("active_memberships_invalid");
  let sameOrder = false;
  let otherOrder = false;
  for (const m of activeMemberships) {
    const otherId = typeof m === "string" ? m : isPlainObject(m) ? m.transferOrderId : null;
    if (!isNonEmptyString(otherId)) return fail("active_memberships_invalid");
    if (otherId === line.transferOrderId) sameOrder = true;
    else otherOrder = true;
  }
  if (otherOrder) return fail("duplicate_active_membership");
  if (sameOrder) return fail("already_member");
  return { valid: true, value: { transferOrderId: line.transferOrderId, serialNo: line.serialNo, state: "PLANNED" }, reason: null };
}

// ---------------------------------------------------------------------------
// validateRemoveLine -- cancel a serial's membership. Legal only when the order is
// REQUESTED and the serial has no TRANSFER_OUT event.
// ---------------------------------------------------------------------------
export function validateRemoveLine(line, transferRef, { serialHasOutEvent = false } = {}) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return fail(ref.reason);
  const bindReason = bindLine(line, ref.value);
  if (bindReason) return fail(bindReason);
  if (ref.value.status !== "REQUESTED") return fail("status_forbids_remove");
  if (serialHasOutEvent === true) return fail("already_dispatched");
  return { valid: true, value: { transferOrderId: line.transferOrderId, serialNo: line.serialNo, state: "CANCELLED" }, reason: null };
}

// Validate + normalize one TRANSFER leg event against the parent transferRef.
function validateLegForReconcile(event, ref, part) {
  const revalidated = validateInventoryMovementEvent(event, part);
  if (!revalidated.valid) return { ok: false, reason: `event_${revalidated.reason}` };
  const v = revalidated.value;
  if (v.sourceObject.id !== ref.transferOrderId) return { ok: false, reason: "transfer_order_mismatch" };
  if (!isNonEmptyString(v.serialNo)) return { ok: false, reason: "serial_no_invalid" };
  const own = v.type === "TRANSFER_OUT" ? ref.origin : ref.destination;
  const other = v.type === "TRANSFER_OUT" ? ref.destination : ref.origin;
  if (!sameLocation(v.location, own) || !sameLocation(v.counterpartyLocation, other)) return { ok: false, reason: "endpoint_mismatch" };
  return { ok: true, value: v };
}

// ---------------------------------------------------------------------------
// reconcileTransferLines({ transferRef, lines, events, part }) -- planned membership vs
// actual ledger events. Returns { valid, states, reason }; states = [{ serialNo,
// reconState }] sorted by serialNo. No quantity math (each unit is one).
//   REQUESTED + planned/no events            -> PLANNED
//   IN_TRANSIT + OUT only                    -> IN_TRANSIT
//   COMPLETED + OUT+IN                        -> RECEIVED
//   IN_TRANSIT/COMPLETED + planned/no OUT     -> MISSING
//   event for a serial with no planned line   -> UNEXPECTED
//   event for a CANCELLED line                -> fail closed
// ---------------------------------------------------------------------------
export function reconcileTransferLines({ transferRef, lines, events, part } = {}) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return { valid: false, states: null, reason: ref.reason };
  const partReason = checkSerialPart(part, ref.value);
  if (partReason) return { valid: false, states: null, reason: partReason };
  if (!Array.isArray(lines) || !Array.isArray(events)) return { valid: false, states: null, reason: "input_invalid" };

  const orderId = ref.value.transferOrderId;
  const status = ref.value.status;
  const eventsAllowed = status === "IN_TRANSIT" || status === "COMPLETED";

  // Planned / cancelled membership sets (a serial may not appear twice).
  const planned = new Set();
  const cancelled = new Set();
  for (const line of lines) {
    if (!isPlainObject(line) || line.transferOrderId !== orderId || !isNonEmptyString(line.serialNo) || !TRANSFER_LINE_STATES.includes(line.state)) {
      return { valid: false, states: null, reason: "line_invalid" };
    }
    if (planned.has(line.serialNo) || cancelled.has(line.serialNo)) return { valid: false, states: null, reason: "duplicate_line" };
    (line.state === "PLANNED" ? planned : cancelled).add(line.serialNo);
  }

  // Validate + group the transfer events by serial.
  const bySerial = new Map();
  for (const event of events) {
    if (!isPlainObject(event) || (event.type !== "TRANSFER_OUT" && event.type !== "TRANSFER_IN")) {
      return { valid: false, states: null, reason: "event_type_invalid" };
    }
    // Movement can only exist once the order has actually dispatched.
    if (!eventsAllowed) return { valid: false, states: null, reason: "status_forbids_movement" };
    const leg = validateLegForReconcile(event, ref.value, part);
    if (!leg.ok) return { valid: false, states: null, reason: leg.reason };
    const v = leg.value;
    const entry = bySerial.get(v.serialNo) || { out: null, in: null };
    if (v.type === "TRANSFER_OUT") {
      if (entry.out) return { valid: false, states: null, reason: "duplicate_out" };
      entry.out = v;
    } else {
      if (entry.in) return { valid: false, states: null, reason: "duplicate_in" };
      entry.in = v;
    }
    bySerial.set(v.serialNo, entry);
  }

  const states = [];
  // Serials that have events.
  for (const [serialNo, { out, in: inLeg }] of bySerial) {
    if (cancelled.has(serialNo)) return { valid: false, states: null, reason: "events_for_cancelled_line" };
    if (!planned.has(serialNo)) {
      states.push({ serialNo, reconState: "UNEXPECTED" });
      continue;
    }
    if (!out && inLeg) return { valid: false, states: null, reason: "in_without_out" };
    if (out && inLeg) {
      if (out.occurredAt > inLeg.occurredAt) return { valid: false, states: null, reason: "out_of_order" };
      if (out.idempotencyKey === inLeg.idempotencyKey) return { valid: false, states: null, reason: "duplicate_idempotency_key" };
      states.push({ serialNo, reconState: "RECEIVED" });
    } else {
      states.push({ serialNo, reconState: "IN_TRANSIT" });
    }
  }
  // Planned serials with no events: PLANNED before dispatch, MISSING once dispatched.
  for (const serialNo of planned) {
    if (bySerial.has(serialNo)) continue;
    states.push({ serialNo, reconState: eventsAllowed ? "MISSING" : "PLANNED" });
  }

  states.sort((a, b) => (a.serialNo < b.serialNo ? -1 : a.serialNo > b.serialNo ? 1 : 0));
  return { valid: true, states, reason: null };
}

// Re-exported for callers that want the parent status vocabulary alongside line contracts.
export { TRANSFER_ORDER_STATUSES };
