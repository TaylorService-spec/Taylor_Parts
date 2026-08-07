// Manufacturer -- OFFLINE tests for the pure write + view helpers (house check()/passed convention).
import assert from "node:assert/strict";
import { toManufacturerListView, MANUFACTURER_STATUSES } from "../src/domain/manufacturersView.js";
import {
  allowedStatusTransitions, buildCreateManufacturerInput, buildUpdateName,
  outcomeFromResult, outcomeFromError, WRITE_DISABLED_OUTCOME, NO_CHANGES_OUTCOME,
} from "../src/domain/manufacturerWrite.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("manufacturerWrite.test.mjs");

check("MANUFACTURER_STATUSES mirrors the backend enum", () => {
  assert.deepEqual([...MANUFACTURER_STATUSES], ["ACTIVE", "INACTIVE"]);
});

check("toManufacturerListView: skips malformed (bad id-binding/status/name), sorts by name, defaults version", () => {
  const { manufacturers, invalid } = toManufacturerListView([
    { id: "m2", data: { manufacturerId: "m2", name: "Beta", status: "ACTIVE", version: 3 } },
    { id: "m1", data: { manufacturerId: "m1", name: "Alpha", status: "INACTIVE" } }, // no version -> 0
    { id: "m3", data: { manufacturerId: "WRONG", name: "X", status: "ACTIVE" } }, // id mismatch -> invalid
    { id: "m4", data: { manufacturerId: "m4", name: "Y", status: "GONE" } }, // bad status -> invalid
    { id: "m5", data: { manufacturerId: "m5", status: "ACTIVE" } }, // no name -> invalid
  ]);
  assert.deepEqual(manufacturers.map((m) => m.manufacturerId), ["m1", "m2"]); // sorted by name Alpha,Beta
  assert.equal(manufacturers.find((m) => m.manufacturerId === "m1").version, 0);
  assert.deepEqual(invalid.sort(), ["m3", "m4", "m5"]);
});

check("allowedStatusTransitions: 2-state toggle (ACTIVE<->INACTIVE); unknown -> none", () => {
  assert.deepEqual(allowedStatusTransitions("ACTIVE"), ["INACTIVE"]);
  assert.deepEqual(allowedStatusTransitions("INACTIVE"), ["ACTIVE"]);
  assert.deepEqual(allowedStatusTransitions("bogus"), []);
});

check("buildCreateManufacturerInput trims; buildUpdateName returns null on unchanged/blank", () => {
  assert.deepEqual(buildCreateManufacturerInput({ manufacturerId: " M-1 ", name: " Acme " }), { manufacturerId: "M-1", name: "Acme" });
  assert.equal(buildUpdateName({ name: "New" }, { name: "Old" }), "New");
  assert.equal(buildUpdateName({ name: "Old" }, { name: "Old" }), null); // unchanged
  assert.equal(buildUpdateName({ name: "  " }, { name: "Old" }), null); // blank
});

check("outcome mapping never fabricates success; sanitized code -> stable outcome", () => {
  assert.equal(outcomeFromResult({ outcome: "applied", version: 1 }).kind, "applied");
  assert.equal(outcomeFromResult({ outcome: "replayed" }).kind, "replayed");
  assert.equal(outcomeFromResult({}).kind, "error");
  assert.equal(outcomeFromError({ code: "permission-denied" }).kind, "denied");
  assert.equal(outcomeFromError({ code: "already-exists" }).kind, "conflict");
  assert.equal(outcomeFromError({ code: "aborted" }).kind, "conflict");
  assert.equal(outcomeFromError({ code: "not-found" }).kind, "notFound");
  assert.equal(outcomeFromError({ code: "weird" }).kind, "error");
  assert.equal(WRITE_DISABLED_OUTCOME.kind, "unavailable");
  assert.equal(NO_CHANGES_OUTCOME.kind, "noop");
});

console.log(`\n${passed} passed, 0 failed`);
