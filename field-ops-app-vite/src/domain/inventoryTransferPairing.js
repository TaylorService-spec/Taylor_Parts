// Enterprise Inventory -- EI-P1b-2 pure SERIAL transfer PAIRING contract.
//
// PURE and DETERMINISTIC: no Firebase import, no persistence, no quantities summed, no
// on-hand/available/aggregate math, no LOT/NONE conservation, no partial-transfer logic.
// It ONLY reconciles a SERIALIZED unit's TRANSFER_OUT / TRANSFER_IN ledger events against
// one injected transfer-order reference, deriving the origin -> (VIRTUAL in-transit,
// DERIVED) -> destination lifecycle. Node-importable and unit-tested directly
// (test/inventoryTransferPairing.test.mjs). Mirrors the EI-P1a / EI-P1b-1 precedent.
//
// GOVERNANCE (authorized EI-P1b-2 decisions):
//   * Model A: exactly TRANSFER_OUT + TRANSFER_IN represent a move. The VIRTUAL in-transit
//     leg is DERIVED (an OUT posted without its matching IN); no VIRTUAL-leg event exists,
//     and this contract emits nothing and computes no balance.
//   * Pairs are reconciled against an INJECTED transfer reference
//     { transferOrderId, partId, origin, destination, status }; the authoritative Part is
//     injected separately (tracking mode is Part-owned, never on the transfer reference).
//     Binding/generalizing the real TransferOrder collection is separately gated.
//   * SERIAL only. LOT/NONE fail closed as unsupported in this gate.
//   * Deferred (NOT here): LOT/NONE conservation, partial transfers, rejection, loss,
//     over-receipt, cancellation effects, aggregates, and all stock calculations.
//
// BOUNDARIES: no quantity summation, partial-transfer logic, persistence, Firestore, Rules,
// indexes, Functions, migration, UI, deployment, or stock-authority changes.
import { validateLocationRef } from "./inventoryLocation.js";
import { validateInventoryMovementEvent } from "./inventoryLedgerEvent.js";

// Transfer-order lifecycle statuses (Epic 4 vocabulary). The transfer order is the
// WORKFLOW authority; this contract only reads its status to gate movement consistency.
export const TRANSFER_ORDER_STATUSES = Object.freeze(["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"]);

// Derived per-serial pairing state. IN_TRANSIT = OUT posted, matching IN not yet posted
// (the VIRTUAL in-transit leg). RECEIVED = OUT + IN both posted (terminal).
export const TRANSFER_PAIRING_STATE = Object.freeze(["IN_TRANSIT", "RECEIVED"]);

const TRANSFER_REF_FIELDS = new Set(["transferOrderId", "partId", "origin", "destination", "status"]);

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Two Location references denote the same endpoint only when the WHOLE {type, locationId}
// reference matches (consistent with EI-P1b-1's transfer_same_location rule).
function sameLocation(a, b) {
  return a.type === b.type && a.locationId === b.locationId;
}

function fail(reason) {
  return { valid: false, value: null, reason };
}

// Validate the injected transfer reference. Endpoints must be valid, non-VIRTUAL, and
// distinct (a real origin and a real destination). { valid, value, reason }.
export function validateTransferRef(transferRef) {
  if (!isPlainObject(transferRef)) return fail("transfer_ref_invalid");
  if (Object.keys(transferRef).some((k) => !TRANSFER_REF_FIELDS.has(k))) return fail("transfer_ref_invalid");
  if (!isNonEmptyString(transferRef.transferOrderId)) return fail("transfer_ref_invalid");
  if (!isNonEmptyString(transferRef.partId)) return fail("transfer_ref_invalid");
  if (!TRANSFER_ORDER_STATUSES.includes(transferRef.status)) return fail("transfer_ref_status_invalid");
  const origin = validateLocationRef(transferRef.origin);
  const destination = validateLocationRef(transferRef.destination);
  if (!origin.valid || !destination.valid) return fail("endpoint_invalid");
  if (origin.value.type === "VIRTUAL" || destination.value.type === "VIRTUAL") return fail("endpoint_virtual");
  if (sameLocation(origin.value, destination.value)) return fail("endpoint_same");
  return {
    valid: true,
    value: {
      transferOrderId: transferRef.transferOrderId,
      partId: transferRef.partId,
      origin: origin.value,
      destination: destination.value,
      status: transferRef.status,
    },
    reason: null,
  };
}

// The injected Part must be SERIAL-tracked and identify exactly the transfer's part.
function checkSerialPart(part, ref) {
  if (!isPlainObject(part) || !isNonEmptyString(part.partId)) return "part_invalid";
  if (part.trackingMode !== "SERIAL") return "unsupported_tracking_mode";
  if (part.partId !== ref.partId) return "part_mismatch";
  return null;
}

// Validate one leg (a single TRANSFER_OUT or TRANSFER_IN event) structurally against the
// transfer reference. Revalidates through EI-P1b-1, then binds it to the reference:
// same part, same transfer order, serial present, endpoints cross-match by {type,locationId}.
// TRANSFER_OUT: location=origin, counterparty=destination. TRANSFER_IN: location=destination,
// counterparty=origin. Returns { valid, value, reason } where value is the normalized event.
function validateLeg(event, ref, part, expectedType) {
  const revalidated = validateInventoryMovementEvent(event, part);
  if (!revalidated.valid) return { valid: false, value: null, reason: `event_${revalidated.reason}` };
  const v = revalidated.value;
  if (v.type !== expectedType) return { valid: false, value: null, reason: "wrong_type" };
  if (v.partId !== ref.partId) return { valid: false, value: null, reason: "part_id_mismatch" };
  if (!isNonEmptyString(v.serialNo)) return { valid: false, value: null, reason: "serial_no_invalid" };
  if (v.sourceObject.id !== ref.transferOrderId) return { valid: false, value: null, reason: "transfer_order_mismatch" };
  const own = expectedType === "TRANSFER_OUT" ? ref.origin : ref.destination;
  const other = expectedType === "TRANSFER_OUT" ? ref.destination : ref.origin;
  if (!sameLocation(v.location, own)) return { valid: false, value: null, reason: "origin_destination_mismatch" };
  if (!sameLocation(v.counterpartyLocation, other)) return { valid: false, value: null, reason: "counterparty_mismatch" };
  return { valid: true, value: v, reason: null };
}

// ---------------------------------------------------------------------------
// validateTransferPair -- one COMPLETED serialized unit's OUT + IN pair.
// ---------------------------------------------------------------------------
export function validateTransferPair(outEvent, inEvent, transferRef, part) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return fail(ref.reason);
  const partReason = checkSerialPart(part, ref.value);
  if (partReason) return fail(partReason);
  // A complete OUT+IN pair means the transfer is COMPLETED. REQUESTED/CANCELLED forbid any
  // movement; IN_TRANSIT would be inconsistent with a received pair.
  if (ref.value.status === "REQUESTED" || ref.value.status === "CANCELLED") return fail("status_forbids_movement");
  if (ref.value.status !== "COMPLETED") return fail("status_inconsistent");

  const out = validateLeg(outEvent, ref.value, part, "TRANSFER_OUT");
  if (!out.valid) return fail(`out:${out.reason}`);
  const inLeg = validateLeg(inEvent, ref.value, part, "TRANSFER_IN");
  if (!inLeg.valid) return fail(`in:${inLeg.reason}`);
  if (out.value.serialNo !== inLeg.value.serialNo) return fail("serial_mismatch");
  if (out.value.occurredAt > inLeg.value.occurredAt) return fail("out_of_order");
  if (out.value.idempotencyKey === inLeg.value.idempotencyKey) return fail("duplicate_idempotency_key");

  return {
    valid: true,
    value: {
      transferOrderId: ref.value.transferOrderId,
      partId: ref.value.partId,
      serialNo: out.value.serialNo,
      origin: ref.value.origin,
      destination: ref.value.destination,
      state: "RECEIVED",
    },
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// deriveSerialTransferState -- reconcile all TRANSFER events for a transfer order and
// derive each serialized unit's state, gated by the transfer-order status. No summation.
// ---------------------------------------------------------------------------
// Returns { valid, states, reason }; states = [{ serialNo, state }] sorted by serialNo.
export function deriveSerialTransferState(transferRef, events, part) {
  const ref = validateTransferRef(transferRef);
  if (!ref.valid) return { valid: false, states: null, reason: ref.reason };
  const partReason = checkSerialPart(part, ref.value);
  if (partReason) return { valid: false, states: null, reason: partReason };
  if (!Array.isArray(events)) return { valid: false, states: null, reason: "events_invalid" };

  // REQUESTED / CANCELLED forbid any movement event.
  if (ref.value.status === "REQUESTED" || ref.value.status === "CANCELLED") {
    return events.length === 0
      ? { valid: true, states: [], reason: null }
      : { valid: false, states: null, reason: "status_forbids_movement" };
  }

  // Group validated legs by serialNo; at most one OUT and one IN per serial.
  const bySerial = new Map();
  for (const event of events) {
    if (!isPlainObject(event) || (event.type !== "TRANSFER_OUT" && event.type !== "TRANSFER_IN")) {
      return { valid: false, states: null, reason: "event_type_invalid" };
    }
    const leg = validateLeg(event, ref.value, part, event.type);
    if (!leg.valid) return { valid: false, states: null, reason: leg.reason };
    const serialNo = leg.value.serialNo;
    const entry = bySerial.get(serialNo) || { out: null, in: null };
    if (event.type === "TRANSFER_OUT") {
      if (entry.out) return { valid: false, states: null, reason: "duplicate_out" };
      entry.out = leg.value;
    } else {
      if (entry.in) return { valid: false, states: null, reason: "duplicate_in" };
      entry.in = leg.value;
    }
    bySerial.set(serialNo, entry);
  }

  const states = [];
  for (const [serialNo, { out, in: inLeg }] of bySerial) {
    if (!out) return { valid: false, states: null, reason: "in_without_out" };
    if (!inLeg) {
      states.push({ serialNo, state: "IN_TRANSIT" });
      continue;
    }
    if (out.occurredAt > inLeg.occurredAt) return { valid: false, states: null, reason: "out_of_order" };
    if (out.idempotencyKey === inLeg.idempotencyKey) return { valid: false, states: null, reason: "duplicate_idempotency_key" };
    states.push({ serialNo, state: "RECEIVED" });
  }

  // Status gate: IN_TRANSIT permits OUT-only; COMPLETED requires every unit RECEIVED. Both
  // require at least one movement (an empty in-transit/completed order is inconsistent).
  if (states.length === 0) return { valid: false, states: null, reason: "status_inconsistent" };
  const allInTransit = states.every((s) => s.state === "IN_TRANSIT");
  const allReceived = states.every((s) => s.state === "RECEIVED");
  if (ref.value.status === "IN_TRANSIT" && !allInTransit) return { valid: false, states: null, reason: "status_inconsistent" };
  if (ref.value.status === "COMPLETED" && !allReceived) return { valid: false, states: null, reason: "status_inconsistent" };

  states.sort((a, b) => (a.serialNo < b.serialNo ? -1 : a.serialNo > b.serialNo ? 1 : 0));
  return { valid: true, states, reason: null };
}
