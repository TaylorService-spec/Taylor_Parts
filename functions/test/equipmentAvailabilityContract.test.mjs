// Fulfillment — equipment-availability contract + #12 temp-placement seam. Proves the HONEST fail-closed
// behavior: today equipment availability is UNKNOWN, and the temp-placement source reports UNDETERMINED
// (available:false) — an empty conflict list is NOT "no conflicts".
import test from "node:test";
import assert from "node:assert/strict";
import {
  temporaryPlacementConflict,
  serializedAssetSubstrateConnected,
  availabilitySignalConnected,
  resolveEquipmentModelCandidates,
  readEquipmentAvailability,
} from "../lib/fulfillment/equipmentAvailabilityContract.js";
import { buildEquipmentModelId } from "../lib/equipmentCompatibility/domain/equipmentModel.js";

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

// Option A: the MAPPING gate is now resolvable (no longer the blocker); the AVAILABILITY SIGNAL gate remains.
const MODEL = buildEquipmentModelId("taylor", "C713");
const DEPS = {
  parts: [{ partId: "SKU-A", status: "ACTIVE", wholeUnit: true, equipmentModelId: MODEL }],
  serialsByPartId: { "SKU-A": ["SN-1", "SN-2"] },
};

test("Gate 1 (mapping) resolves candidate serials when a resolver + catalog are injected", () => {
  assert.deepEqual(resolveEquipmentModelCandidates(MODEL, DEPS), ["SN-1", "SN-2"]);
});

test("Gate 1 returns null without an injected catalog (mapping unresolvable from here)", () => {
  assert.equal(resolveEquipmentModelCandidates(MODEL), null);
});

test("Gate 2 (availability signal) is still not connected", () => {
  assert.equal(availabilitySignalConnected(), false);
});

test("even with the mapping resolved, availability stays UNKNOWN (Gate 2 not connected)", () => {
  // The mapping produced candidates (SN-1, SN-2) but availability cannot be asserted — honest fail-closed.
  assert.deepEqual(readEquipmentAvailability(MODEL, DEPS), { kind: "UNKNOWN" });
});
