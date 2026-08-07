// setWorkOrderPartsPlan — OFFLINE tests for the PURE core (validation + authoritative merge), imported from
// the compiled lib. Canonical identity (Owner-ratified): partId and sku are DISTINCT; sku is resolved from
// Part Master's internalPartNumber and NEVER fabricated as partId. Proves: new rows require canonical
// resolution (fail closed otherwise), no sku=partId path, legacy sku-only match only via canonical
// internalPartNumber (with partId backfill), mismatch/ambiguity fail closed, qtyUsed preserved, used part
// cannot be un-planned, PLAN != RESERVE != USE. The capability check + transaction are the callable layer.
import assert from "node:assert/strict";
import {
  validatePartsPlan,
  applyPartsPlan,
  PartsPlanError,
} from "../lib/workOrderPartsPlan/setWorkOrderPartsPlan.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("setWorkOrderPartsPlan.test.mjs");

// A Part Master resolver over a fixture map: partId -> { found, sku }. Absent id => not found (fail closed).
const resolver = (map) => (partId) => map[partId] ?? { found: false, sku: null };

check("validatePartsPlan: normalizes intent (partId identity, positive int qty); no client sku accepted", () => {
  const out = validatePartsPlan({ workOrderId: " WO-1 ", plan: [{ partId: " P-1 ", name: " Filter ", qtyPlanned: 2, sku: "IGNORED" }] });
  assert.equal(out.workOrderId, "WO-1");
  assert.deepEqual(out.plan, [{ partId: "P-1", name: "Filter", qtyPlanned: 2 }]); // sku is NOT carried from the client
  assert.deepEqual(validatePartsPlan({ workOrderId: "WO-1", plan: [] }).plan, []); // empty plan = clear
});

check("validatePartsPlan: honest failures throw PartsPlanError(INVALID)", () => {
  for (const bad of [
    {}, { workOrderId: "WO-1" }, { workOrderId: "WO-1", plan: "x" },
    { workOrderId: "WO-1", plan: [{ qtyPlanned: 1 }] },
    { workOrderId: "WO-1", plan: [{ partId: "P", qtyPlanned: 0 }] },
    { workOrderId: "WO-1", plan: [{ partId: "P", qtyPlanned: 1.5 }] },
    { workOrderId: "WO-1", plan: [{ partId: "P", qtyPlanned: 1 }, { partId: "P", qtyPlanned: 2 }] },
  ]) {
    assert.throws(() => validatePartsPlan(bad), (e) => e instanceof PartsPlanError && e.code === "INVALID");
  }
});

// (1)(3) new planned row REQUIRES canonical Part Master resolution; a missing Part fails closed.
check("new row: missing canonical Part record -> FAIL CLOSED (PART_NOT_FOUND)", () => {
  assert.throws(
    () => applyPartsPlan([], [{ partId: "P-1", qtyPlanned: 2 }], resolver({})),
    (e) => e instanceof PartsPlanError && e.code === "PART_NOT_FOUND"
  );
});

// (4) missing/invalid internalPartNumber fails closed.
check("new row: canonical Part with no valid internalPartNumber -> FAIL CLOSED (SKU_UNRESOLVED)", () => {
  assert.throws(
    () => applyPartsPlan([], [{ partId: "P-1", qtyPlanned: 1 }], resolver({ "P-1": { found: true, sku: null } })),
    (e) => e instanceof PartsPlanError && e.code === "SKU_UNRESOLVED"
  );
  assert.throws(
    () => applyPartsPlan([], [{ partId: "P-1", qtyPlanned: 1 }], resolver({ "P-1": { found: true, sku: "  " } })),
    (e) => e instanceof PartsPlanError && e.code === "SKU_UNRESOLVED"
  );
});

// (2)(5) new row writes partId + canonical internalPartNumber as sku; NEVER sku = partId.
check("new row: writes partId + canonical internalPartNumber as sku (never sku = partId)", () => {
  const next = applyPartsPlan([], [{ partId: "P-1", name: "Filter", qtyPlanned: 2 }], resolver({ "P-1": { found: true, sku: "IPN-9" } }));
  assert.equal(next.length, 1);
  assert.equal(next[0].partId, "P-1");
  assert.equal(next[0].sku, "IPN-9");
  assert.notEqual(next[0].sku, next[0].partId); // canonical sku, never the partId
  assert.equal(next[0].qtyPlanned, 2);
  assert.equal(next[0].qtyUsed, undefined); // planning never writes usage
});

// (6)(7)(10) legacy sku-only row matches ONLY through canonical internalPartNumber; backfills partId; keeps qtyUsed.
check("legacy sku-only row: matches via canonical internalPartNumber, backfills partId, preserves qtyUsed", () => {
  const legacy = [{ sku: "IPN-1", qtyPlanned: 1, qtyUsed: 2, name: "Filter" }]; // no partId (legacy)
  const next = applyPartsPlan(legacy, [{ partId: "P-1", qtyPlanned: 4 }], resolver({ "P-1": { found: true, sku: "IPN-1" } }));
  assert.equal(next.length, 1);
  assert.equal(next[0].partId, "P-1"); // backfilled
  assert.equal(next[0].sku, "IPN-1");
  assert.equal(next[0].qtyPlanned, 4); // updated
  assert.equal(next[0].qtyUsed, 2); // preserved -- PLAN != USE
});

check("legacy sku-only row whose sku != canonical internalPartNumber is NOT matched (a new row is created)", () => {
  const legacy = [{ sku: "OTHER", qtyPlanned: 1, qtyUsed: 0 }]; // different canonical part; no usage -> droppable
  const next = applyPartsPlan(legacy, [{ partId: "P-1", qtyPlanned: 3 }], resolver({ "P-1": { found: true, sku: "IPN-1" } }));
  assert.deepEqual(next.map((i) => i.partId), ["P-1"]);
  assert.equal(next[0].sku, "IPN-1");
  assert.equal(next[0].qtyUsed, undefined); // did NOT merge the unrelated OTHER row
});

// (8) a stored sku that conflicts with the canonical internalPartNumber fails closed.
check("existing partId row with a stored sku != canonical internalPartNumber -> FAIL CLOSED (SKU_CONFLICT)", () => {
  const existing = [{ partId: "P-1", sku: "WRONG", qtyPlanned: 1 }];
  assert.throws(
    () => applyPartsPlan(existing, [{ partId: "P-1", qtyPlanned: 2 }], resolver({ "P-1": { found: true, sku: "IPN-1" } })),
    (e) => e instanceof PartsPlanError && e.code === "SKU_CONFLICT"
  );
});

// (9) ambiguous duplicate identity fails closed.
check("ambiguous identity (a partId row AND a legacy row with the same canonical sku) -> FAIL CLOSED (IDENTITY_AMBIGUOUS)", () => {
  const existing = [{ partId: "P-1", sku: "IPN-1", qtyPlanned: 1 }, { sku: "IPN-1", qtyPlanned: 1 }];
  assert.throws(
    () => applyPartsPlan(existing, [{ partId: "P-1", qtyPlanned: 2 }], resolver({ "P-1": { found: true, sku: "IPN-1" } })),
    (e) => e instanceof PartsPlanError && e.code === "IDENTITY_AMBIGUOUS"
  );
  // Two rows sharing the same partId are also ambiguous.
  assert.throws(
    () => applyPartsPlan([{ partId: "P-1", sku: "IPN-1" }, { partId: "P-1", sku: "IPN-1" }], [{ partId: "P-1", qtyPlanned: 1 }], resolver({ "P-1": { found: true, sku: "IPN-1" } })),
    (e) => e instanceof PartsPlanError && e.code === "IDENTITY_AMBIGUOUS"
  );
});

// (11) a part with recorded usage cannot be un-planned.
check("used part cannot be un-planned (USED_PART_REMOVAL); an unused part can be dropped", () => {
  const existing = [
    { partId: "P-1", sku: "IPN-1", qtyPlanned: 1, qtyUsed: 0 },
    { partId: "P-2", sku: "IPN-2", qtyPlanned: 2, qtyUsed: 3 }, // used
  ];
  const res = resolver({ "P-1": { found: true, sku: "IPN-1" }, "P-2": { found: true, sku: "IPN-2" } });
  assert.throws(
    () => applyPartsPlan(existing, [{ partId: "P-1", qtyPlanned: 1 }], res), // drops used P-2
    (e) => e instanceof PartsPlanError && e.code === "USED_PART_REMOVAL"
  );
  const next = applyPartsPlan(existing, [{ partId: "P-2", qtyPlanned: 2 }], res); // drops unused P-1
  assert.deepEqual(next.map((i) => i.partId), ["P-2"]);
});

// (12) PLAN != RESERVE != USE: the merge writes only planned/identity; never usage or a reservation field.
check("PLAN != RESERVE != USE: only qtyPlanned/identity written; qtyUsed untouched; no reservation fabricated", () => {
  const existing = [{ partId: "P-1", sku: "IPN-1", qtyPlanned: 2, qtyUsed: 1, notes: "keep" }];
  const next = applyPartsPlan(existing, [{ partId: "P-1", qtyPlanned: 9 }], resolver({ "P-1": { found: true, sku: "IPN-1" } }));
  assert.equal(next[0].qtyPlanned, 9);
  assert.equal(next[0].qtyUsed, 1); // untouched
  assert.equal(next[0].notes, "keep"); // unrelated fields preserved
  assert.equal("reserved" in next[0], false); // nothing reservation-like fabricated
});

console.log(`\n${passed} passed, 0 failed`);
