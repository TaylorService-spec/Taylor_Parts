// WO Parts Plan (client pure core) -- OFFLINE tests. Proves the business-intent validation + the
// removal invariants (PLAN != RESERVE != USE): planning only sets planned quantities, never reserves, and
// never erases a part that already has recorded usage.
import assert from "node:assert/strict";
import {
  buildPartsPlanInput,
  planRemovals,
  planRemovalBlocked,
} from "../src/domain/workOrderPartsPlan.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("workOrderPartsPlan.test.mjs");

check("buildPartsPlanInput: normalizes valid lines (partId identity, positive int qty)", () => {
  const r = buildPartsPlanInput([
    { partId: " P-1 ", name: " Filter ", qtyPlanned: 2 },
    { partId: "P-2", qtyPlanned: 1 },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, [
    { partId: "P-1", name: "Filter", qtyPlanned: 2 },
    { partId: "P-2", name: null, qtyPlanned: 1 },
  ]);
});

check("buildPartsPlanInput: an empty plan is valid input (clear the plan)", () => {
  assert.deepEqual(buildPartsPlanInput([]), { ok: true, value: [] });
});

check("buildPartsPlanInput: honest failures (no partial output)", () => {
  assert.deepEqual(buildPartsPlanInput("nope"), { ok: false, error: "PLAN_MUST_BE_LIST" });
  assert.equal(buildPartsPlanInput([null]).error, "LINE_INVALID");
  assert.equal(buildPartsPlanInput([{ qtyPlanned: 1 }]).error, "PART_REQUIRED");
  assert.equal(buildPartsPlanInput([{ partId: "P-1", qtyPlanned: 0 }]).error, "QTY_INVALID");
  assert.equal(buildPartsPlanInput([{ partId: "P-1", qtyPlanned: 1.5 }]).error, "QTY_INVALID");
  assert.equal(buildPartsPlanInput([{ partId: "P-1", qtyPlanned: 2 }, { partId: "P-1", qtyPlanned: 1 }]).error, "DUPLICATE_PART");
});

check("planRemovals: lists currently-planned parts dropped from the proposed plan", () => {
  const current = [{ partId: "A", qtyPlanned: 1 }, { partId: "B", qtyPlanned: 2 }, { partId: "C", qtyPlanned: 1 }];
  const proposed = [{ partId: "A", qtyPlanned: 3 }]; // B and C dropped
  assert.deepEqual(planRemovals(current, proposed).sort(), ["B", "C"]);
});

check("planRemovalBlocked: cannot un-plan a part that already has recorded usage (qtyUsed > 0)", () => {
  const current = [
    { partId: "A", qtyPlanned: 1, qtyUsed: 0 },
    { partId: "B", qtyPlanned: 2, qtyUsed: 1 }, // used -> blocked if removed
    { partId: "C", qtyPlanned: 1 },             // no usage -> removable
  ];
  const proposed = [{ partId: "A", qtyPlanned: 1 }]; // drops B and C
  assert.deepEqual(planRemovalBlocked(current, proposed), ["B"]); // only B is blocked
  // Keeping B in the plan clears the block.
  assert.deepEqual(planRemovalBlocked(current, [{ partId: "A", qtyPlanned: 1 }, { partId: "B", qtyPlanned: 2 }]), []);
});

console.log(`\n${passed} passed, 0 failed`);
