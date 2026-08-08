// Fulfillment Cycle 5 (live) — OFFLINE tests for the PURE authoritative-availability computation, from
// compiled lib. Proves the Owner-ratified semantics: ATP = eligible on-hand − open WO reservations − other
// active SO allocations (floored 0); missing on-hand ⇒ UNKNOWN (never 0); serial netting across SOs +
// temp-placement conflicts; no double-allocation.
import test from "node:test";
import assert from "node:assert/strict";
import {
  openWorkOrderReserved,
  computePartAvailability,
  computeEquipmentAvailability,
  sumOtherSoCommitments,
} from "../lib/fulfillment/fulfillmentAvailability.js";

test("openWorkOrderReserved: RESERVED − RELEASED − CONSUMED, floored at 0", () => {
  assert.equal(openWorkOrderReserved([{ type: "RESERVED", quantity: 5 }, { type: "RELEASED", quantity: 2 }]), 3);
  assert.equal(openWorkOrderReserved([{ type: "RESERVED", quantity: 5 }, { type: "CONSUMED", quantity: 5 }]), 0);
  assert.equal(openWorkOrderReserved([{ type: "RELEASED", quantity: 3 }]), 0);
});

test("computePartAvailability: ATP = onHand − reserved − otherSO, floored; missing onHand ⇒ UNKNOWN", () => {
  assert.deepEqual(computePartAvailability({ onHandEligible: 10, openWoReserved: 2, otherSoAllocated: 3 }), { kind: "KNOWN", quantity: 5 });
  assert.deepEqual(computePartAvailability({ onHandEligible: 4, openWoReserved: 2, otherSoAllocated: 5 }), { kind: "KNOWN", quantity: 0 });
  // known-zero on-hand is BACKORDER territory (KNOWN 0), NOT unknown
  assert.deepEqual(computePartAvailability({ onHandEligible: 0, openWoReserved: 0, otherSoAllocated: 0 }), { kind: "KNOWN", quantity: 0 });
  // missing/untrusted on-hand ⇒ UNKNOWN, never 0
  assert.deepEqual(computePartAvailability({ onHandEligible: null, openWoReserved: 0, otherSoAllocated: 0 }), { kind: "UNKNOWN" });
});

test("sumOtherSoCommitments: nets qty + serials for a ref across other SOs", () => {
  const other = [
    { ref: "C713", allocatedQty: 2, selectedSerialIds: ["S1", "S2"] },
    { ref: "C713", allocatedQty: 1, selectedSerialIds: ["S3"] },
    { ref: "OTHER", allocatedQty: 9, selectedSerialIds: ["X"] },
  ];
  const r = sumOtherSoCommitments(other, "C713");
  assert.equal(r.allocatedQty, 3);
  assert.deepEqual(r.selectedSerials.sort(), ["S1", "S2", "S3"]);
});

test("computeEquipmentAvailability: free serials exclude other-SO + temp-placement; null ⇒ UNKNOWN", () => {
  const r = computeEquipmentAvailability({ availableSerials: ["A", "B", "C", "D"], otherSoSelectedSerials: ["B"], tempPlacementConflictSerials: ["C"] });
  assert.deepEqual(r.availability, { kind: "KNOWN", quantity: 2 });
  assert.deepEqual(r.freeSerials.sort(), ["A", "D"]);
  assert.deepEqual(computeEquipmentAvailability({ availableSerials: null, otherSoSelectedSerials: [], tempPlacementConflictSerials: [] }).availability, { kind: "UNKNOWN" });
});
