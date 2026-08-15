// Serialized Asset -- OFFLINE tests for the PURE read-projection core, imported from compiled lib. No
// emulator/Firebase/network. Proves the minimal projection (exact field allowlist -- stray/internal fields
// stripped), malformed-document handling stays honest (never fabricated), and the invariant-honoring
// exclusion the callable relies on.
//
// Prerequisite: `npm run build` in functions/ first (this test imports the compiled lib/ output).
import test from "node:test";
import assert from "node:assert/strict";
import { projectSerializedAsset } from "../lib/serializedAsset/serializedAssetReadService.js";
import { isAvailableForEquipmentRead } from "../lib/serializedAsset/types.js";

function baseDoc(overrides = {}) {
  return {
    serialNo: "SN-2001",
    partId: "PART-9",
    currentLocationId: "WH-MAIN",
    inventoryState: "AVAILABLE",
    currentEquipmentId: null,
    ownership: "COMPANY",
    ...overrides,
  };
}

test("projectSerializedAsset returns only the minimal Available-Equipment fields -- exact allowlist", () => {
  const p = projectSerializedAsset("doc-1", baseDoc());
  assert.deepEqual(Object.keys(p).sort(), [
    "currentEquipmentId", "currentLocationId", "inventoryState", "ownership", "partId", "serialNo",
  ]);
});

test("projectSerializedAsset strips provenance/internal fields present on the raw doc, never leaks them", () => {
  const p = projectSerializedAsset("doc-2", baseDoc({
    // A real stored document also carries provenance (see DeserializedSerializedAsset) -- these must be
    // IGNORED by the projection (not smuggled through, but also not cause rejection of an otherwise-valid
    // document, since every real document will legitimately carry them).
    createdByUid: "uid-abc",
    updatedByUid: "uid-def",
    createdAtMillis: 1000,
    updatedAtMillis: 2000,
    schemaVersion: 1,
    internalNotes: "should never appear",
  }));
  assert.notEqual(p, null);
  assert.deepEqual(Object.keys(p).sort(), [
    "currentEquipmentId", "currentLocationId", "inventoryState", "ownership", "partId", "serialNo",
  ]);
  assert.equal("createdByUid" in p, false);
  assert.equal("schemaVersion" in p, false);
  assert.equal("internalNotes" in p, false);
});

test("projectSerializedAsset projects the exact field values from a clean doc", () => {
  const p = projectSerializedAsset("doc-3", baseDoc());
  assert.equal(p.serialNo, "SN-2001");
  assert.equal(p.partId, "PART-9");
  assert.equal(p.currentLocationId, "WH-MAIN");
  assert.equal(p.inventoryState, "AVAILABLE");
  assert.equal(p.currentEquipmentId, null);
  assert.equal(p.ownership, "COMPANY");
});

test("projectSerializedAsset returns null for an invalid/unrecognized inventoryState rather than trusting it", () => {
  assert.equal(projectSerializedAsset("doc-4", baseDoc({ inventoryState: "BOGUS" })), null);
  assert.equal(projectSerializedAsset("doc-5", baseDoc({ inventoryState: undefined })), null);
});

test("projectSerializedAsset returns null for a contradictory INSTALLED-without-link or linked-without-INSTALLED doc", () => {
  assert.equal(projectSerializedAsset("doc-6", baseDoc({ inventoryState: "INSTALLED", currentEquipmentId: null })), null);
  assert.equal(projectSerializedAsset("doc-7", baseDoc({ currentEquipmentId: "EQ-1" })), null); // AVAILABLE + link
});

test("projectSerializedAsset fails to null on missing id or data", () => {
  assert.equal(projectSerializedAsset("", baseDoc()), null);
  assert.equal(projectSerializedAsset("doc-8", undefined), null);
});

test("projectSerializedAsset projects a non-AVAILABLE, unlinked asset too (general projection, not availability-scoped)", () => {
  const p = projectSerializedAsset("doc-9", baseDoc({ inventoryState: "RECEIVED" }));
  assert.notEqual(p, null);
  assert.equal(p.inventoryState, "RECEIVED");
  // But it does not qualify for the Available Equipment read -- the callable's defensive re-check excludes it.
  assert.equal(isAvailableForEquipmentRead(p), false);
});

test("projectSerializedAsset + isAvailableForEquipmentRead together select exactly the AVAILABLE/unlinked set", () => {
  const docs = [
    ["a", baseDoc({ serialNo: "SN-A", inventoryState: "AVAILABLE" })],
    ["b", baseDoc({ serialNo: "SN-B", inventoryState: "RESERVED" })],
    ["c", baseDoc({ serialNo: "SN-C", inventoryState: "INSTALLED", currentEquipmentId: "EQ-9" })],
    ["d", baseDoc({ serialNo: "SN-D", inventoryState: "IN_TRANSIT" })],
  ];
  const available = docs
    .map(([id, data]) => projectSerializedAsset(id, data))
    .filter((p) => p && isAvailableForEquipmentRead(p));
  assert.deepEqual(available.map((p) => p.serialNo), ["SN-A"]);
});
