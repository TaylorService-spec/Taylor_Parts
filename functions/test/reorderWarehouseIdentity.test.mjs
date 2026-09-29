// The pre-COPY warehouse identity gate (Controller, 2026-09-28): legacy warehouse ids are compared to EOS warehouse ids
// exactly, per warehouse; nothing is translated and no near-match is offered.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { censusWarehouseIdentity } = require("../lib/eosOps/migration/reorderWarehouseIdentity.js");

const EOS = [
  { id: "wh-main", operatingCompanyKey: "taylor-key", status: "ACTIVE" },
  { id: "wh-north", operatingCompanyKey: "other-key", status: "INACTIVE" },
];
const ref = (reorderId, warehouseId, boundCompanyKey = "taylor-key") => ({ reorderId, warehouseId, boundCompanyKey });

test("exact ids with agreeing company keys are EXACT_MATCH, grouped per warehouse", () => {
  const c = censusWarehouseIdentity([ref("r1", "wh-main"), ref("r2", "wh-main"), ref("r3", "wh-north", "other-key")], EOS);
  assert.equal(c.allExact, true);
  assert.deepEqual(c.entries.map((e) => [e.legacyWarehouseId, e.verdict, e.reorderCount, e.eosWarehouse.status]),
    [["wh-main", "EXACT_MATCH", 2, "ACTIVE"], ["wh-north", "EXACT_MATCH", 1, "INACTIVE"]]);
});

test("an id EOS does not hold is MISSING_IN_EOS -- even a case or whitespace variant is never matched", () => {
  const c = censusWarehouseIdentity([ref("r1", "WH-MAIN"), ref("r2", "wh-main ")], EOS);
  assert.equal(c.allExact, false);
  assert.deepEqual(c.entries.map((e) => [e.legacyWarehouseId, e.verdict, e.eosWarehouse]),
    [["WH-MAIN", "MISSING_IN_EOS", null], ["wh-main ", "MISSING_IN_EOS", null]]);
});

test("a Reorder bound to a different company than its warehouse is COMPANY_MISMATCH, naming the Reorders", () => {
  const c = censusWarehouseIdentity([ref("r1", "wh-main"), ref("r2", "wh-main", "other-key")], EOS);
  assert.equal(c.allExact, false);
  assert.equal(c.entries[0].verdict, "COMPANY_MISMATCH");
  assert.deepEqual(c.entries[0].mismatchedReorderIds, ["r2"]);
});

test("a Reorder with no warehouse id is MISSING_WAREHOUSE_ID, never defaulted", () => {
  const c = censusWarehouseIdentity([ref("r1", undefined), ref("r2", "")], EOS);
  assert.deepEqual(c.entries.map((e) => [e.legacyWarehouseId, e.verdict, e.reorderCount]), [[null, "MISSING_WAREHOUSE_ID", 2]]);
  assert.deepEqual(c.verdictCounts, { EXACT_MATCH: 0, MISSING_IN_EOS: 0, COMPANY_MISMATCH: 0, MISSING_WAREHOUSE_ID: 1 });
});
