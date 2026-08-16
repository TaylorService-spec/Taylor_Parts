// PART 11A -- OFFLINE tests for the PURE parts of locationDisplayReadService.ts (validation +
// per-doc resolution helpers), imported from compiled lib. No emulator/Firebase/network.
// Prerequisite: `npm run build` in functions/ first.
import test from "node:test";
import assert from "node:assert/strict";
import { validateLocationIdsRequest, MAX_LOCATION_IDS } from "../lib/inventoryLocation/locationDisplayReadService.js";

test("validateLocationIdsRequest: a clean array of distinct non-empty strings passes through, deduped-order-preserving", () => {
  assert.deepEqual(validateLocationIdsRequest(["a", "b", "a", "c"]), ["a", "b", "c"]);
});

test("validateLocationIdsRequest: fails closed (null) on non-array, empty array, or over-limit array", () => {
  assert.equal(validateLocationIdsRequest(undefined), null);
  assert.equal(validateLocationIdsRequest(null), null);
  assert.equal(validateLocationIdsRequest("WH-1"), null);
  assert.equal(validateLocationIdsRequest({}), null);
  assert.equal(validateLocationIdsRequest([]), null);
  assert.equal(validateLocationIdsRequest(Array.from({ length: MAX_LOCATION_IDS + 1 }, (_, i) => `id-${i}`)), null);
});

test("validateLocationIdsRequest: fails closed (null) on any non-string / blank entry -- never silently drops a bad entry", () => {
  assert.equal(validateLocationIdsRequest(["WH-1", 42]), null);
  assert.equal(validateLocationIdsRequest(["WH-1", null]), null);
  assert.equal(validateLocationIdsRequest(["WH-1", ""]), null);
  assert.equal(validateLocationIdsRequest(["WH-1", "   "]), null);
  assert.equal(validateLocationIdsRequest([{ locationId: "WH-1" }]), null);
});

test("validateLocationIdsRequest: exactly MAX_LOCATION_IDS distinct entries passes", () => {
  const ids = Array.from({ length: MAX_LOCATION_IDS }, (_, i) => `id-${i}`);
  assert.deepEqual(validateLocationIdsRequest(ids), ids);
});
