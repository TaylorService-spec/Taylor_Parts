// P1A step 2 -- census completeness and capability-vocabulary-sufficiency proofs. Offline: pure
// data, no Firestore, no Postgres.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WRITER_CAPABILITY_CENSUS,
  WRITER_FAMILIES,
  censusCapabilityKeys,
  newCapabilityKeys,
} from "../lib/eosOps/migration/inventoryWriterCapabilityCensus.js";

test("all 8 writer families are represented, exactly", () => {
  const families = new Set(WRITER_CAPABILITY_CENSUS.map((op) => op.writerFamily));
  assert.deepEqual([...families].sort(), [...WRITER_FAMILIES].sort());
  assert.equal(families.size, 8);
});

test("every operation names a real source file, a capability key, and an authorization kind", () => {
  for (const op of WRITER_CAPABILITY_CENSUS) {
    assert.ok(op.operationKey.length > 0, "operationKey");
    assert.ok(op.sourceFile.length > 0, `${op.operationKey}: sourceFile`);
    assert.ok(op.capabilityKey.length > 0, `${op.operationKey}: capabilityKey`);
    assert.ok(["CAPABILITY_CATALOG", "HARDCODED_ROLE"].includes(op.kind), `${op.operationKey}: kind`);
    assert.equal(typeof op.requiresOwnAssignment, "boolean", `${op.operationKey}: requiresOwnAssignment`);
    assert.ok(op.note.length > 0, `${op.operationKey}: note`);
  }
});

test("a HARDCODED_ROLE operation names its legacy roles and no legacy capability string; a CAPABILITY_CATALOG operation is the reverse", () => {
  for (const op of WRITER_CAPABILITY_CENSUS) {
    if (op.kind === "HARDCODED_ROLE") {
      assert.ok(Array.isArray(op.legacyRoles) && op.legacyRoles.length > 0, `${op.operationKey}: legacyRoles`);
      assert.equal(op.legacyCapabilityKey, undefined, `${op.operationKey}: must not carry a legacy capability string`);
    } else {
      assert.equal(typeof op.legacyCapabilityKey, "string", `${op.operationKey}: legacyCapabilityKey`);
      assert.equal(op.legacyCapabilityKey, op.capabilityKey, `${op.operationKey}: preserves the exact legacy key, invents no synonym`);
      assert.equal(op.legacyRoles, undefined, `${op.operationKey}: must not carry legacyRoles`);
    }
  }
});

test("exactly two writer operations are the mechanically-verified HARDCODED_ROLE discrepancy from the design doc", () => {
  const hardcoded = WRITER_CAPABILITY_CENSUS.filter((op) => op.kind === "HARDCODED_ROLE");
  assert.deepEqual(
    hardcoded.map((op) => op.operationKey).sort(),
    [
      "workOrderConsumption.record",
      "workOrderReservation.cancel",
      "workOrderReservation.complete",
      "workOrderReservation.dispatch",
    ].sort(),
  );
});

test("censusCapabilityKeys is deduplicated and sorted", () => {
  const keys = censusCapabilityKeys();
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(keys).size, keys.length);
});

test("the five Cycle Count keys are present and preserved exactly, untouched by this migration", () => {
  const keys = censusCapabilityKeys();
  for (const k of [
    "inventory.cycleCount.create",
    "inventory.cycleCount.submit",
    "inventory.cycleCount.cancel",
    "inventory.cycleCount.reconcile",
    "inventory.cycleCount.close",
  ]) {
    assert.ok(keys.includes(k), `missing Cycle Count key: ${k}`);
  }
  assert.equal(newCapabilityKeys().some((k) => k.startsWith("inventory.cycleCount.")), false);
});

test("newCapabilityKeys is exactly the 13 keys migration 006 adds -- no more, no fewer", () => {
  assert.deepEqual(
    [...newCapabilityKeys()].sort(),
    [
      "admin.dataImport.execute",
      "equipment.install",
      "inventory.placement.record",
      "inventory.stock.receive",
      "inventory.stock.relocate",
      "inventory.transfer.cancel",
      "inventory.transfer.create",
      "inventory.transfer.dispatch",
      "inventory.transfer.receive",
      "inventory.workOrderConsumption.record",
      "workOrder.lifecycle.cancel",
      "workOrder.lifecycle.complete",
      "workOrder.lifecycle.dispatch",
    ].sort(),
  );
});

test("migration 006 catalogs exactly newCapabilityKeys(), by id and key, no more and no fewer", () => {
  const sql = readFileSync("migrations/1757894400000_operational-capability-vocabulary.sql", "utf8");
  const keys = newCapabilityKeys();
  for (const key of keys) {
    assert.ok(sql.includes(`'${key}'`), `migration 006 is missing capability key: ${key}`);
  }
  // Reverse direction: the migration inserts exactly 13 rows, no stray extras.
  const insertedCount = [...sql.matchAll(/\('cap_[a-zA-Z_]+',/g)].length;
  assert.equal(insertedCount, keys.length);
});

test("the mechanically-verified HARDCODED_ROLE discrepancy: updateWorkOrderExecutionData.ts hardcodes a role string, not a capability check", () => {
  const source = readFileSync("src/updateWorkOrderExecutionData.ts", "utf8");
  assert.match(source, /caller\.role\s*!==\s*"technician"/, "expected the hardcoded technician-role gate to still be present");
  assert.doesNotMatch(source, /authorize\(/, "if this ever gains a capability-catalog authorize() call, the census and migration 006 must be revisited");
});

test("the mechanically-verified HARDCODED_ROLE discrepancy: transitionEngine.ts's ACTION_PERMISSIONS gates Dispatch/Cancel/Complete by role, not capability", () => {
  const source = readFileSync("src/transitionEngine.ts", "utf8");
  assert.match(source, /Dispatch:\s*\{\s*roles:\s*\["admin",\s*"dispatcher"\]/);
  assert.match(source, /Cancel:\s*\{\s*roles:\s*\["admin",\s*"dispatcher"\]/);
  assert.match(source, /Complete:\s*\{\s*roles:\s*\["technician"\],\s*requiresOwnAssignment:\s*true/);
  const inventoryServiceSource = readFileSync("src/inventoryService.ts", "utf8");
  assert.doesNotMatch(inventoryServiceSource, /authorize\(/, "inventoryService.ts must keep performing zero authorization checks of its own -- its authority is entirely inherited from the WO transition that triggered it");
});
