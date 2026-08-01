// EI-P1d-2-2b -- unit tests for the pure driver-id collector (no-N+1 input builder).
// Run: node test/truckRegistryDrivers.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { collectDriverEmployeeIds } from "../src/domain/truckRegistryDrivers.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const t = (assignedDriverEmployeeId) => ({ docId: "TRK", data: { truckId: "TRK", assignedDriverEmployeeId } });

ok("collects distinct, first-seen order, de-duplicated (no N+1: one id per driver)", () => {
  const docs = [t("emp-a"), t("emp-b"), t("emp-a"), t("emp-c"), t("emp-b")];
  assert.deepEqual(collectDriverEmployeeIds(docs), ["emp-a", "emp-b", "emp-c"]);
});

ok("skips unassigned / blank / non-string / missing driver ids", () => {
  const docs = [t(null), t(undefined), t(""), t("   "), t(7), t("emp-x"), { docId: "T2", data: {} }, { docId: "T3" }];
  assert.deepEqual(collectDriverEmployeeIds(docs), ["emp-x"]);
});

ok("malformed input never throws -> empty list", () => {
  for (const bad of [null, undefined, "trucks", 42, {}, [null, 1, "x", {}]]) {
    assert.deepEqual(collectDriverEmployeeIds(bad), []);
  }
});

ok("empty input -> empty list", () => {
  assert.deepEqual(collectDriverEmployeeIds([]), []);
});

console.log(`\n${passed} passed`);
