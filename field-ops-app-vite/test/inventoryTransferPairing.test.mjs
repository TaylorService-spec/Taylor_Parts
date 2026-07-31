// Enterprise Inventory -- EI-P1b-2. Deterministic pure unit tests for the SERIAL transfer
// pairing contract (src/domain/inventoryTransferPairing.js). Proves Model A (OUT + IN,
// derived VIRTUAL in-transit), injected transfer reference + separately injected Part,
// SERIAL-only, endpoint cross-match, status consistency, distinct idempotency keys, and
// fail-closed handling of duplicate/contradictory/out-of-order events. No quantity math.
//
// Run: node test/inventoryTransferPairing.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  TRANSFER_ORDER_STATUSES,
  TRANSFER_PAIRING_STATE,
  validateTransferRef,
  validateTransferPair,
  deriveSerialTransferState,
} from "../src/domain/inventoryTransferPairing.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

const ORIGIN = { type: "WAREHOUSE", locationId: "WH-1" };
const DEST = { type: "MOBILE", locationId: "TRUCK-7" };
const PART = { partId: "PART-1", trackingMode: "SERIAL" };

const ref = (over = {}) => ({ transferOrderId: "TO-1", partId: "PART-1", origin: ORIGIN, destination: DEST, status: "COMPLETED", ...over });
const outEv = (over = {}) => ({
  type: "TRANSFER_OUT", partId: "PART-1", location: ORIGIN, counterpartyLocation: DEST,
  quantity: 1, serialNo: "SN-9", sourceObject: { type: "TRANSFER_ORDER", id: "TO-1" },
  idempotencyKey: "idem-out", actor: { kind: "USER", id: "uid" }, occurredAt: 1730000000000, ...over,
});
const inEv = (over = {}) => ({
  type: "TRANSFER_IN", partId: "PART-1", location: DEST, counterpartyLocation: ORIGIN,
  quantity: 1, serialNo: "SN-9", sourceObject: { type: "TRANSFER_ORDER", id: "TO-1" },
  idempotencyKey: "idem-in", actor: { kind: "USER", id: "uid" }, occurredAt: 1730000001000, ...over,
});

// --- constants ---
ok("status + state enums", () => {
  assert.deepEqual(TRANSFER_ORDER_STATUSES, ["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"]);
  assert.deepEqual(TRANSFER_PAIRING_STATE, ["IN_TRANSIT", "RECEIVED"]);
});

// --- transfer reference validation ---
ok("validateTransferRef: valid, normalized", () => {
  const r = validateTransferRef(ref());
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, { transferOrderId: "TO-1", partId: "PART-1", origin: ORIGIN, destination: DEST, status: "COMPLETED" });
});

ok("validateTransferRef: fail-closed shapes", () => {
  assert.equal(validateTransferRef(null).reason, "transfer_ref_invalid");
  assert.equal(validateTransferRef(ref({ extra: 1 })).reason, "transfer_ref_invalid");
  assert.equal(validateTransferRef(ref({ transferOrderId: "" })).reason, "transfer_ref_invalid");
  assert.equal(validateTransferRef(ref({ partId: "" })).reason, "transfer_ref_invalid");
  assert.equal(validateTransferRef(ref({ status: "NOPE" })).reason, "transfer_ref_status_invalid");
  assert.equal(validateTransferRef(ref({ origin: { type: "TRUCK", locationId: "X" } })).reason, "endpoint_invalid");
});

ok("validateTransferRef: endpoints must be non-VIRTUAL and distinct", () => {
  assert.equal(validateTransferRef(ref({ origin: { type: "VIRTUAL", locationId: "V" } })).reason, "endpoint_virtual");
  assert.equal(validateTransferRef(ref({ destination: { type: "VIRTUAL", locationId: "V" } })).reason, "endpoint_virtual");
  assert.equal(validateTransferRef(ref({ destination: { ...ORIGIN } })).reason, "endpoint_same");
});

// --- validateTransferPair: happy path ---
ok("validateTransferPair: valid COMPLETED pair -> RECEIVED", () => {
  const r = validateTransferPair(outEv(), inEv(), ref(), PART);
  assert.equal(r.valid, true);
  assert.deepEqual(r.value, { transferOrderId: "TO-1", partId: "PART-1", serialNo: "SN-9", origin: ORIGIN, destination: DEST, state: "RECEIVED" });
});

// --- part authority ---
ok("validateTransferPair: SERIAL-only + part identity", () => {
  assert.equal(validateTransferPair(outEv(), inEv(), ref(), { partId: "PART-1", trackingMode: "LOT" }).reason, "unsupported_tracking_mode");
  assert.equal(validateTransferPair(outEv(), inEv(), ref(), { partId: "PART-1", trackingMode: "NONE" }).reason, "unsupported_tracking_mode");
  assert.equal(validateTransferPair(outEv(), inEv(), ref(), null).reason, "part_invalid");
  assert.equal(validateTransferPair(outEv(), inEv(), ref(), { partId: "OTHER", trackingMode: "SERIAL" }).reason, "part_mismatch");
});

// --- status consistency ---
ok("validateTransferPair: status gating (pair implies COMPLETED)", () => {
  assert.equal(validateTransferPair(outEv(), inEv(), ref({ status: "REQUESTED" }), PART).reason, "status_forbids_movement");
  assert.equal(validateTransferPair(outEv(), inEv(), ref({ status: "CANCELLED" }), PART).reason, "status_forbids_movement");
  assert.equal(validateTransferPair(outEv(), inEv(), ref({ status: "IN_TRANSIT" }), PART).reason, "status_inconsistent");
});

// --- leg failures ---
ok("validateTransferPair: a leg failing EI-P1b-1 revalidation propagates", () => {
  assert.equal(validateTransferPair(outEv({ quantity: 2 }), inEv(), ref(), PART).reason, "out:event_quantity_invalid");
  assert.equal(validateTransferPair(outEv(), inEv({ occurredAt: -1 }), ref(), PART).reason, "in:event_occurred_at_invalid");
});

ok("validateTransferPair: wrong leg type / transfer-order / endpoint mismatches", () => {
  // Passing an IN where an OUT is expected.
  assert.equal(validateTransferPair(inEv(), inEv(), ref(), PART).reason, "out:wrong_type");
  assert.equal(validateTransferPair(outEv({ sourceObject: { type: "TRANSFER_ORDER", id: "OTHER" } }), inEv(), ref(), PART).reason, "out:transfer_order_mismatch");
  // OUT location must equal origin; here it is the destination.
  assert.equal(validateTransferPair(outEv({ location: DEST, counterpartyLocation: ORIGIN }), inEv(), ref(), PART).reason, "out:origin_destination_mismatch");
  // IN counterparty must equal origin; break it.
  assert.equal(validateTransferPair(outEv(), inEv({ counterpartyLocation: { type: "WAREHOUSE", locationId: "WH-2" } }), ref(), PART).reason, "in:counterparty_mismatch");
});

ok("validateTransferPair: serial / order / idempotency", () => {
  assert.equal(validateTransferPair(outEv(), inEv({ serialNo: "SN-DIFFERENT" }), ref(), PART).reason, "serial_mismatch");
  assert.equal(validateTransferPair(outEv({ occurredAt: 1730000002000 }), inEv({ occurredAt: 1730000001000 }), ref(), PART).reason, "out_of_order");
  assert.equal(validateTransferPair(outEv({ idempotencyKey: "same" }), inEv({ idempotencyKey: "same" }), ref(), PART).reason, "duplicate_idempotency_key");
});

// --- deriveSerialTransferState ---
ok("derive: COMPLETED with OUT+IN -> RECEIVED", () => {
  const r = deriveSerialTransferState(ref(), [outEv(), inEv()], PART);
  assert.equal(r.valid, true);
  assert.deepEqual(r.states, [{ serialNo: "SN-9", state: "RECEIVED" }]);
});

ok("derive: IN_TRANSIT with OUT-only -> IN_TRANSIT", () => {
  const r = deriveSerialTransferState(ref({ status: "IN_TRANSIT" }), [outEv()], PART);
  assert.equal(r.valid, true);
  assert.deepEqual(r.states, [{ serialNo: "SN-9", state: "IN_TRANSIT" }]);
});

ok("derive: status/state consistency gates", () => {
  // COMPLETED but only OUT posted -> inconsistent.
  assert.equal(deriveSerialTransferState(ref({ status: "COMPLETED" }), [outEv()], PART).reason, "status_inconsistent");
  // IN_TRANSIT but a unit already received -> inconsistent.
  assert.equal(deriveSerialTransferState(ref({ status: "IN_TRANSIT" }), [outEv(), inEv()], PART).reason, "status_inconsistent");
  // IN_TRANSIT / COMPLETED with no movement at all -> inconsistent.
  assert.equal(deriveSerialTransferState(ref({ status: "IN_TRANSIT" }), [], PART).reason, "status_inconsistent");
  assert.equal(deriveSerialTransferState(ref({ status: "COMPLETED" }), [], PART).reason, "status_inconsistent");
});

ok("derive: REQUESTED/CANCELLED forbid movement; empty is valid", () => {
  assert.deepEqual(deriveSerialTransferState(ref({ status: "REQUESTED" }), [], PART), { valid: true, states: [], reason: null });
  assert.deepEqual(deriveSerialTransferState(ref({ status: "CANCELLED" }), [], PART), { valid: true, states: [], reason: null });
  assert.equal(deriveSerialTransferState(ref({ status: "REQUESTED" }), [outEv()], PART).reason, "status_forbids_movement");
  assert.equal(deriveSerialTransferState(ref({ status: "CANCELLED" }), [outEv()], PART).reason, "status_forbids_movement");
});

ok("derive: fail-closed on missing/duplicate/contradictory/out-of-order", () => {
  // IN with no matching OUT.
  assert.equal(deriveSerialTransferState(ref({ status: "COMPLETED" }), [inEv()], PART).reason, "in_without_out");
  // duplicate OUT / IN for one serial.
  assert.equal(deriveSerialTransferState(ref({ status: "IN_TRANSIT" }), [outEv(), outEv({ idempotencyKey: "o2" })], PART).reason, "duplicate_out");
  assert.equal(deriveSerialTransferState(ref({ status: "COMPLETED" }), [outEv(), inEv(), inEv({ idempotencyKey: "i2" })], PART).reason, "duplicate_in");
  // out-of-order within the pair.
  assert.equal(deriveSerialTransferState(ref({ status: "COMPLETED" }), [outEv({ occurredAt: 1730000002000 }), inEv({ occurredAt: 1730000001000 })], PART).reason, "out_of_order");
  // a non-transfer event in the set.
  assert.equal(deriveSerialTransferState(ref(), [{ type: "RECEIVED" }], PART).reason, "event_type_invalid");
  // a leg that doesn't bind to the transfer order.
  assert.equal(deriveSerialTransferState(ref({ status: "IN_TRANSIT" }), [outEv({ sourceObject: { type: "TRANSFER_ORDER", id: "OTHER" } })], PART).reason, "transfer_order_mismatch");
});

ok("derive: multiple serials reconcile independently, sorted", () => {
  const r = deriveSerialTransferState(
    ref({ status: "COMPLETED" }),
    [
      outEv({ serialNo: "SN-2", idempotencyKey: "o2" }), inEv({ serialNo: "SN-2", idempotencyKey: "i2" }),
      outEv({ serialNo: "SN-1", idempotencyKey: "o1" }), inEv({ serialNo: "SN-1", idempotencyKey: "i1" }),
    ],
    PART,
  );
  assert.equal(r.valid, true);
  assert.deepEqual(r.states, [{ serialNo: "SN-1", state: "RECEIVED" }, { serialNo: "SN-2", state: "RECEIVED" }]);
});

ok("derive: non-array events fail closed; ref/part validated first", () => {
  assert.equal(deriveSerialTransferState(ref(), "nope", PART).reason, "events_invalid");
  assert.equal(deriveSerialTransferState(ref({ status: "NOPE" }), [], PART).reason, "transfer_ref_status_invalid");
  assert.equal(deriveSerialTransferState(ref(), [], { partId: "PART-1", trackingMode: "NONE" }).reason, "unsupported_tracking_mode");
});

// --- purity ---
ok("no input mutation", () => {
  const o = outEv(), i = inEv(), r = ref(), p = { ...PART };
  const so = structuredClone(o), si = structuredClone(i), sr = structuredClone(r), sp = structuredClone(p);
  validateTransferPair(o, i, r, p);
  deriveSerialTransferState(r, [o, i], p);
  assert.deepEqual(o, so);
  assert.deepEqual(i, si);
  assert.deepEqual(r, sr);
  assert.deepEqual(p, sp);
});

console.log(`\n${passed} passed`);
