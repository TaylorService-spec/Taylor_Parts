// Manufacturer -- OFFLINE tests for the pure view helpers (house check()/passed convention). The pure WRITE helpers
// (domain/manufacturerWrite.js) were deleted once Firebase exit PR-B made the Manufacturers page read-only; the
// governed write is EOS Core's postgresManufacturerWriter, tested on the server.
import assert from "node:assert/strict";
import { toManufacturerListView, MANUFACTURER_STATUSES } from "../src/domain/manufacturersView.js";

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

console.log(`\n${passed} passed, 0 failed`);
