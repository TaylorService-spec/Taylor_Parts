// Fulfillment — equipment-availability contract + #12 temp-placement seam. Proves the HONEST fail-closed
// behavior: today equipment availability is UNKNOWN, and the temp-placement source reports UNDETERMINED
// (available:false) — an empty conflict list is NOT "no conflicts".
import test from "node:test";
import assert from "node:assert/strict";
import {
  temporaryPlacementConflict,
  serializedAssetSubstrateConnected,
  readEquipmentAvailability,
} from "../lib/fulfillment/equipmentAvailabilityContract.js";

test("temp-placement source reports UNDETERMINED (available:false), never fakes 'no conflicts'", () => {
  const r = temporaryPlacementConflict();
  assert.equal(r.available, false); // #12 authority does not exist -> undetermined, callers fail closed
  assert.deepEqual(r.conflictSerials, []); // empty list is NOT proof of no conflicts (available:false gates it)
});

test("serialized-asset substrate is not connected today (assessment)", () => {
  assert.equal(serializedAssetSubstrateConnected(), false);
});

test("readEquipmentAvailability is UNKNOWN / fail-closed for every ordered model today", () => {
  assert.deepEqual(readEquipmentAvailability("C713"), { kind: "UNKNOWN" });
  assert.deepEqual(readEquipmentAvailability("WIC-8x10"), { kind: "UNKNOWN" });
});
