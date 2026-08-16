// Manufacturer -- OFFLINE tests for the PURE read-projection core, imported from compiled lib.
// No emulator/Firebase/network. Proves the minimal projection (no unrelated internal/admin fields),
// malformed-document handling stays honest (never fabricated), and status stays within the governed
// enum or honestly null.
import test from "node:test";
import assert from "node:assert/strict";
import { projectManufacturer } from "../lib/partMaster/manufacturerReadService.js";

test("projectManufacturer returns only the minimal Manufacturer-catalog fields", () => {
  const p = projectManufacturer("MFG-1", {
    name: "Acme Valve Co",
    status: "ACTIVE",
    version: 3,
    // fields that must NOT leak into the projection:
    createdByUid: "uid-abc",
    updatedByUid: "uid-def",
    internalNotes: "vendor contract terms confidential",
  });
  assert.deepEqual(Object.keys(p).sort(), ["manufacturerId", "name", "status", "version"]);
  assert.equal(p.manufacturerId, "MFG-1");
  assert.equal(p.name, "Acme Valve Co");
  assert.equal(p.status, "ACTIVE");
  assert.equal(p.version, 3);
  assert.equal("createdByUid" in p, false);
  assert.equal("internalNotes" in p, false);
});

test("projectManufacturer: version defaults to 0 when absent or non-integer (never fabricated, matches the client mirror's default)", () => {
  assert.equal(projectManufacturer("MFG-7", { name: "Foxtrot Filters", status: "ACTIVE" }).version, 0);
  assert.equal(projectManufacturer("MFG-8", { name: "Golf Gaskets", status: "ACTIVE", version: "3" }).version, 0);
  assert.equal(projectManufacturer("MFG-9", { name: "Hotel Hoses", status: "ACTIVE", version: 1.5 }).version, 0);
  assert.equal(projectManufacturer("MFG-10", { name: "India Injectors", status: "ACTIVE", version: 7 }).version, 7);
});

test("projectManufacturer returns null for a missing/blank name (never fabricated)", () => {
  assert.equal(projectManufacturer("MFG-2", { status: "ACTIVE" }), null);
  assert.equal(projectManufacturer("MFG-3", { name: "   ", status: "ACTIVE" }), null);
});

test("projectManufacturer honestly reports status:null for an unrecognized status, never guesses", () => {
  const p = projectManufacturer("MFG-4", { name: "Delta Pumps", status: "BOGUS_STATUS" });
  assert.equal(p.name, "Delta Pumps");
  assert.equal(p.status, null);
});

test("projectManufacturer fails to null on missing id or data", () => {
  assert.equal(projectManufacturer("", { name: "X", status: "ACTIVE" }), null);
  assert.equal(projectManufacturer("MFG-5", undefined), null);
});

test("projectManufacturer accepts a manufacturer with a status field absent entirely", () => {
  const p = projectManufacturer("MFG-6", { name: "Echo Seals" });
  assert.equal(p.name, "Echo Seals");
  assert.equal(p.status, null);
});
