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

test("sumOtherSoCommitments: nets qty + serials for the SAME kind+ref across other SOs", () => {
  const other = [
    { kind: "PART", ref: "C713", allocatedQty: 2, selectedSerialIds: ["S1", "S2"] },
    { kind: "PART", ref: "C713", allocatedQty: 1, selectedSerialIds: ["S3"] },
    { kind: "PART", ref: "OTHER", allocatedQty: 9, selectedSerialIds: ["X"] },
  ];
  const r = sumOtherSoCommitments(other, "PART", "C713");
  assert.equal(r.allocatedQty, 3);
  assert.deepEqual(r.selectedSerials.sort(), ["S1", "S2", "S3"]);
});

test("sumOtherSoCommitments: kind-scoped — a SERVICE/EQUIPMENT_MODEL commitment sharing a ref string does NOT net against a PART line of the same ref (and vice versa)", () => {
  const otherSoLines = [
    // SO #1: SERVICE line that happens to share ref "C713" with an unrelated PART.
    { kind: "SERVICE", ref: "C713", allocatedQty: 4, selectedSerialIds: [] },
    // SO #2: EQUIPMENT_MODEL line, same ref again.
    { kind: "EQUIPMENT_MODEL", ref: "C713", allocatedQty: 2, selectedSerialIds: ["EQ1"] },
    // SO #3: the actual same-kind PART commitment that SHOULD net.
    { kind: "PART", ref: "C713", allocatedQty: 3, selectedSerialIds: [] },
  ];

  const partNet = sumOtherSoCommitments(otherSoLines, "PART", "C713");
  assert.equal(partNet.allocatedQty, 3, "PART availability must net ONLY other PART commitments, not the SERVICE/EQUIPMENT_MODEL lines sharing the ref");
  assert.deepEqual(partNet.selectedSerials, []);

  const serviceNet = sumOtherSoCommitments(otherSoLines, "SERVICE", "C713");
  assert.equal(serviceNet.allocatedQty, 4, "SERVICE netting must not pick up the PART/EQUIPMENT_MODEL commitments for the same ref");

  const equipNet = sumOtherSoCommitments(otherSoLines, "EQUIPMENT_MODEL", "C713");
  assert.equal(equipNet.allocatedQty, 2);
  assert.deepEqual(equipNet.selectedSerials, ["EQ1"]);
});

test("computeEquipmentAvailability: free serials exclude other-SO + temp-placement; null ⇒ UNKNOWN", () => {
  const r = computeEquipmentAvailability({ availableSerials: ["A", "B", "C", "D"], otherSoSelectedSerials: ["B"], tempPlacementConflictSerials: ["C"] });
  assert.deepEqual(r.availability, { kind: "KNOWN", quantity: 2 });
  assert.deepEqual(r.freeSerials.sort(), ["A", "D"]);
  assert.deepEqual(computeEquipmentAvailability({ availableSerials: null, otherSoSelectedSerials: [], tempPlacementConflictSerials: [] }).availability, { kind: "UNKNOWN" });
});
