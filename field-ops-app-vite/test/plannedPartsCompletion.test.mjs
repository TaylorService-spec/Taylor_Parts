import assert from "node:assert/strict";
import test from "node:test";
import { unusedPlannedParts, unusedPlannedPartsMessage } from "../src/domain/plannedPartsCompletion.js";

test("reports the exact shortfall the technician mission hit: 0 of 1 planned", () => {
  const short = unusedPlannedParts({
    inventorySnapshot: [{ name: "Water Inlet Valve", qtyPlanned: 1, qtyUsed: 0 }],
  });
  assert.equal(short.length, 1);
  assert.deepEqual(short[0], { name: "Water Inlet Valve", qtyPlanned: 1, qtyUsed: 0, shortfall: 1 });
});

test("a fully consumed plan raises nothing", () => {
  assert.deepEqual(
    unusedPlannedParts({ inventorySnapshot: [{ name: "Valve", qtyPlanned: 1, qtyUsed: 1 }] }),
    [],
  );
  assert.equal(unusedPlannedPartsMessage({ inventorySnapshot: [{ name: "Valve", qtyPlanned: 2, qtyUsed: 2 }] }), null);
});

test("over-consumption is not a shortfall", () => {
  assert.deepEqual(unusedPlannedParts({ inventorySnapshot: [{ name: "Valve", qtyPlanned: 1, qtyUsed: 3 }] }), []);
});

test("partial consumption is reported with its real numbers", () => {
  const short = unusedPlannedParts({ inventorySnapshot: [{ name: "Valve", qtyPlanned: 4, qtyUsed: 1 }] });
  assert.equal(short[0].shortfall, 3);
});

test("an unknown usage figure is never rendered as a confident shortfall", () => {
  for (const qtyUsed of [undefined, null, "1", NaN, -2, {}]) {
    assert.deepEqual(
      unusedPlannedParts({ inventorySnapshot: [{ name: "Valve", qtyPlanned: 1, qtyUsed }] }),
      [],
      `qtyUsed ${String(qtyUsed)} must not produce a shortfall claim`,
    );
  }
});

test("a part with no plan is not a shortfall", () => {
  assert.deepEqual(unusedPlannedParts({ inventorySnapshot: [{ name: "Valve", qtyPlanned: 0, qtyUsed: 0 }] }), []);
  assert.deepEqual(unusedPlannedParts({ inventorySnapshot: [{ name: "Valve", qtyUsed: 0 }] }), []);
});

test("a missing or malformed snapshot is empty, never a throw", () => {
  for (const wo of [undefined, null, {}, { inventorySnapshot: null }, { inventorySnapshot: "x" }, { inventorySnapshot: [null, 3, "a"] }]) {
    assert.deepEqual(unusedPlannedParts(wo), []);
  }
});

test("falls back through sku and partId for a nameless line", () => {
  assert.equal(unusedPlannedParts({ inventorySnapshot: [{ sku: "PRT-1002", qtyPlanned: 1, qtyUsed: 0 }] })[0].name, "PRT-1002");
  assert.equal(unusedPlannedParts({ inventorySnapshot: [{ partId: "PRT-9", qtyPlanned: 1, qtyUsed: 0 }] })[0].name, "PRT-9");
  assert.equal(unusedPlannedParts({ inventorySnapshot: [{ qtyPlanned: 1, qtyUsed: 0 }] })[0].name, "Unnamed part");
});

test("the message names every short part and stays a question, not a refusal", () => {
  const msg = unusedPlannedPartsMessage({
    inventorySnapshot: [
      { name: "Valve", qtyPlanned: 1, qtyUsed: 0 },
      { name: "Gasket", qtyPlanned: 2, qtyUsed: 1 },
    ],
  });
  assert.match(msg, /2 planned parts/);
  assert.match(msg, /Valve \(0 of 1 used\)/);
  assert.match(msg, /Gasket \(1 of 2 used\)/);
  assert.match(msg, /Complete anyway\?$/);
});
