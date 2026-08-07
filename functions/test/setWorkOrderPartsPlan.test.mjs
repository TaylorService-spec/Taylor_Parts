// setWorkOrderPartsPlan — OFFLINE tests for the PURE core (validation + authoritative merge), imported from
// the compiled lib. Proves the governed invariants without the emulator: PLAN != RESERVE != USE (the merge
// writes only qtyPlanned/identity and never a reservation or usage), qtyUsed is preserved across a re-plan,
// a used part cannot be un-planned, and each item carries BOTH partId (projection identity) and sku
// (execution-capture key). The capability enforcement + transaction are the callable's concern (integration
// / emulator), not this offline unit.
import assert from "node:assert/strict";
import {
  validatePartsPlan,
  applyPartsPlan,
  PartsPlanError,
} from "../lib/workOrderPartsPlan/setWorkOrderPartsPlan.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("setWorkOrderPartsPlan.test.mjs");

check("validatePartsPlan: normalizes valid intent (partId identity, positive int qty)", () => {
  const out = validatePartsPlan({ workOrderId: " WO-1 ", plan: [{ partId: " P-1 ", name: " Filter ", qtyPlanned: 2 }] });
  assert.equal(out.workOrderId, "WO-1");
  assert.deepEqual(out.plan, [{ partId: "P-1", sku: undefined, name: "Filter", qtyPlanned: 2 }]);
  // Empty plan is valid input (clear the plan).
  assert.deepEqual(validatePartsPlan({ workOrderId: "WO-1", plan: [] }).plan, []);
});

check("validatePartsPlan: honest failures throw PartsPlanError(INVALID)", () => {
  const bad = [
    {},
    { workOrderId: "WO-1" },
    { workOrderId: "WO-1", plan: "x" },
    { workOrderId: "WO-1", plan: [{ qtyPlanned: 1 }] },
    { workOrderId: "WO-1", plan: [{ partId: "P", qtyPlanned: 0 }] },
    { workOrderId: "WO-1", plan: [{ partId: "P", qtyPlanned: 1.5 }] },
    { workOrderId: "WO-1", plan: [{ partId: "P", qtyPlanned: 1 }, { partId: "P", qtyPlanned: 2 }] },
  ];
  for (const b of bad) {
    assert.throws(() => validatePartsPlan(b), (e) => e instanceof PartsPlanError && e.code === "INVALID");
  }
});

check("applyPartsPlan: writes qtyPlanned + BOTH partId and sku (identity); new part sku falls back to partId", () => {
  const next = applyPartsPlan([], [{ partId: "P-1", qtyPlanned: 2 }]);
  assert.equal(next.length, 1);
  assert.equal(next[0].partId, "P-1");
  assert.equal(next[0].sku, "P-1"); // fallback when no sku + no resolver
  assert.equal(next[0].qtyPlanned, 2);
  // resolveSku (Part Master) supplies the canonical sku when available.
  const resolved = applyPartsPlan([], [{ partId: "P-2", qtyPlanned: 1 }], (id) => (id === "P-2" ? "SKU-2" : undefined));
  assert.equal(resolved[0].sku, "SKU-2");
});

check("applyPartsPlan: PLAN != USE -> qtyUsed on a kept part is PRESERVED across a re-plan", () => {
  const current = [{ partId: "P-1", sku: "SKU-1", qtyPlanned: 2, qtyUsed: 1, name: "Filter" }];
  const next = applyPartsPlan(current, [{ partId: "P-1", qtyPlanned: 5 }]);
  assert.equal(next[0].qtyPlanned, 5);   // planned changed
  assert.equal(next[0].qtyUsed, 1);      // usage untouched (never written by planning)
  assert.equal(next[0].sku, "SKU-1");    // prior sku preserved
});

check("applyPartsPlan: a part with recorded usage CANNOT be un-planned (failed-precondition invariant)", () => {
  const current = [
    { partId: "P-1", sku: "SKU-1", qtyPlanned: 1, qtyUsed: 0 },
    { partId: "P-2", sku: "SKU-2", qtyPlanned: 2, qtyUsed: 3 }, // used
  ];
  // Dropping P-2 (used) must throw.
  assert.throws(
    () => applyPartsPlan(current, [{ partId: "P-1", qtyPlanned: 1 }]),
    (e) => e instanceof PartsPlanError && e.code === "USED_PART_REMOVAL"
  );
  // Dropping only P-1 (no usage) is fine.
  const next = applyPartsPlan(current, [{ partId: "P-2", qtyPlanned: 2 }]);
  assert.deepEqual(next.map((i) => i.partId), ["P-2"]);
});

check("applyPartsPlan: matches a legacy sku-only item by partId==sku (no fabricated duplicate)", () => {
  const legacy = [{ sku: "P-1", qtyPlanned: 1, qtyUsed: 2 }]; // no partId (legacy)
  // Re-planning partId "P-1" must UPDATE the legacy item, not add a second row, and must not trip the
  // used-removal guard.
  const next = applyPartsPlan(legacy, [{ partId: "P-1", qtyPlanned: 4 }]);
  assert.equal(next.length, 1);
  assert.equal(next[0].partId, "P-1");
  assert.equal(next[0].qtyPlanned, 4);
  assert.equal(next[0].qtyUsed, 2); // preserved
});

console.log(`\n${passed} passed, 0 failed`);
