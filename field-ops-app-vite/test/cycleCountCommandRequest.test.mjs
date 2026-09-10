// Cycle Count A1 -- pure request builders for the sheet/line callables.
// Run: node --test test/cycleCountCommandRequest.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateSheetRequest, buildSubmitLineRequest, buildReconcileLineRequest, buildLineRequest, buildSheetRequest, makeIdempotencyKey,
} from "../src/domain/cycleCountCommandRequest.js";

test("a sheet names a location only -- WAREHOUSE, MOBILE or BIN -- and no Part", () => {
  for (const type of ["WAREHOUSE", "MOBILE", "BIN"]) {
    const r = buildCreateSheetRequest({ locationType: type, locationId: " L-1 " }, { idempotencyKey: "k1" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { location: { type, locationId: "L-1" }, idempotencyKey: "k1" });
    assert.equal(r.value.partId, undefined);
  }
  assert.equal(buildCreateSheetRequest({ locationType: "VENDOR", locationId: "x" }).ok, false);
  assert.equal(buildCreateSheetRequest({ locationType: "BIN", locationId: "" }).ok, false);
  assert.match(makeIdempotencyKey(), /^ccs_/);
});

test("submit: a quantity (zero included) or a unique serial list -- never an expected value", () => {
  assert.deepEqual(buildSubmitLineRequest("s1", "P1", "NONE", { countedQuantity: 0 }).value, { sheetId: "s1", partId: "P1", countedQuantity: 0 });
  assert.deepEqual(buildSubmitLineRequest("s1", "P1", "NONE", { countedQuantity: "4" }).value.countedQuantity, 4);
  assert.equal(buildSubmitLineRequest("s1", "P1", "NONE", { countedQuantity: -1 }).ok, false);
  assert.equal(buildSubmitLineRequest("s1", "P1", "NONE", { countedQuantity: 1.5 }).ok, false);
  assert.deepEqual(buildSubmitLineRequest("s1", "P1", "SERIAL", { countedSerialNumbers: [" A ", "B"] }).value.countedSerialNumbers, ["A", "B"]);
  assert.equal(buildSubmitLineRequest("s1", "P1", "SERIAL", { countedSerialNumbers: ["A", "A"] }).ok, false);
  assert.equal(buildSubmitLineRequest("", "P1", "NONE", { countedQuantity: 1 }).ok, false);
  const v = buildSubmitLineRequest("s1", "P1", "NONE", { countedQuantity: 1, expectedQuantity: 9, variance: 3 }).value;
  assert.equal(v.expectedQuantity, undefined); assert.equal(v.variance, undefined);
});

test("reconcile: decision APPROVE/REJECT, reason trimmed and optional", () => {
  assert.deepEqual(buildReconcileLineRequest("s1", "P1", "  short  ").value, { sheetId: "s1", partId: "P1", decision: "APPROVE", reason: "short" });
  assert.deepEqual(buildReconcileLineRequest("s1", "P1", "", "REJECT").value, { sheetId: "s1", partId: "P1", decision: "REJECT" });
  assert.equal(buildReconcileLineRequest("s1", "P1", "x", "MAYBE").ok, false);
});

test("line and sheet id requests", () => {
  assert.deepEqual(buildLineRequest("s1", "P1").value, { sheetId: "s1", partId: "P1" });
  assert.equal(buildLineRequest("s1", "").ok, false);
  assert.deepEqual(buildSheetRequest("s1").value, { sheetId: "s1" });
});
