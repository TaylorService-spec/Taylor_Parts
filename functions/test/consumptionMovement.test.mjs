// Work Order physical consumption — the MOVEMENT and its CORRECTION.
// Run: node --test test/consumptionMovement.test.mjs   (pure — no emulator)
//
// The correction cases matter most. A qtyUsed decrease is a correction of a record, not an inventory
// increase with a Work Order attached to it — so it must restore to the location the stock actually
// left, and must never restore more than was consumed. Both failures would create stock out of
// nothing, in a place it had never been.
import test from "node:test";
import assert from "node:assert/strict";

const {
  buildConsumptionMovement,
  consumptionIdempotencyKey,
  outstandingConsumptionByLocation,
  planConsumptionCorrection,
  ConsumptionMovementError,
  WORK_ORDER_CONSUMPTION_TYPE,
} = await import("../lib/workOrderConsumption/consumptionMovement.js");

const WH_A = "wh-a";
const WH_B = "wh-b";
const TRUCK = "truck-7";
const base = (over = {}) => ({
  workOrderId: "wo-1", partId: "PRT-1", trackingMode: "NONE", quantity: 2,
  locationType: "WAREHOUSE", locationId: WH_A, actorId: "tech-1",
  occurredAt: 1_700_000_000_000, direction: "CONSUME", commandKey: "cmd-1", ...over,
});
const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof ConsumptionMovementError && e.code === code, `expected ${code}`);

// ══════════════════════════ THE MOVEMENT ══════════════════════════

test("a consumption is a NEGATIVE signed movement at the source location", () => {
  const m = buildConsumptionMovement(base());
  assert.equal(m.type, WORK_ORDER_CONSUMPTION_TYPE);
  assert.equal(m.quantity, -2, "negative: stock leaves");
  assert.deepEqual(m.location, { type: "WAREHOUSE", locationId: WH_A });
  assert.deepEqual(m.sourceObject, { type: "WORK_ORDER", id: "wo-1" });
  assert.deepEqual(m.actor, { kind: "USER", id: "tech-1" });
  assert.equal(m.occurredAt, 1_700_000_000_000);
});

test("a correction is the SAME fact positive — one type, not two", () => {
  const m = buildConsumptionMovement(base({ direction: "CORRECT" }));
  assert.equal(m.type, WORK_ORDER_CONSUMPTION_TYPE, "not a separate reversal type that could drift");
  assert.equal(m.quantity, 2, "positive: stock returns");
});

test("the CALLER never supplies the sign — direction does", () => {
  // A caller passing a negative magnitude is a defect, not a shortcut to a correction.
  throwsCode(() => buildConsumptionMovement(base({ quantity: -2 })), "MOVEMENT_QUANTITY_INVALID");
  throwsCode(() => buildConsumptionMovement(base({ quantity: 0 })), "MOVEMENT_QUANTITY_INVALID");
  throwsCode(() => buildConsumptionMovement(base({ direction: "REVERSE" })), "MOVEMENT_DIRECTION_INVALID");
});

test("lineage and governed event time are required", () => {
  for (const field of ["workOrderId", "partId", "locationId", "locationType", "actorId"]) {
    throwsCode(() => buildConsumptionMovement(base({ [field]: "" })), "MOVEMENT_LINEAGE_REQUIRED");
  }
  throwsCode(() => buildConsumptionMovement(base({ occurredAt: null })), "MOVEMENT_TIME_REQUIRED");
  throwsCode(() => buildConsumptionMovement(base({ occurredAt: "2026-01-01" })), "MOVEMENT_TIME_REQUIRED");
});

// ══════════════════════════ IDEMPOTENCY ══════════════════════════

test("a retry of the same submit produces the SAME key — no second decrement", () => {
  assert.equal(buildConsumptionMovement(base()).idempotencyKey, buildConsumptionMovement(base()).idempotencyKey);
});

test("distinct facts get distinct keys — part, location, direction and submit all separate", () => {
  const k = (over) => consumptionIdempotencyKey({
    commandKey: "cmd-1", workOrderId: "wo-1", partId: "PRT-1", locationId: WH_A, direction: "CONSUME", ...over,
  });
  const baseKey = k({});
  for (const [label, over] of [
    ["another part", { partId: "PRT-2" }],
    ["another location", { locationId: WH_B }],
    ["the correction of it", { direction: "CORRECT" }],
    ["a different submit", { commandKey: "cmd-2" }],
    ["another work order", { workOrderId: "wo-2" }],
  ]) {
    assert.notEqual(k(over), baseKey, `${label} must be its own movement`);
  }
});

test("a consumption and its correction cannot collide", () => {
  // If they shared a key the correction would be swallowed as a replay and stock would never return.
  assert.notEqual(
    buildConsumptionMovement(base()).idempotencyKey,
    buildConsumptionMovement(base({ direction: "CORRECT" })).idempotencyKey,
  );
});

// ══════════════════════════ OUTSTANDING, PER LOCATION ══════════════════════════

const row = (qty, locationId, locationType = "WAREHOUSE", over = {}) => ({
  type: WORK_ORDER_CONSUMPTION_TYPE, partId: "PRT-1", quantity: qty,
  location: { type: locationType, locationId }, sourceObject: { type: "WORK_ORDER", id: "wo-1" }, ...over,
});

test("outstanding consumption is derived per location from the movements themselves", () => {
  const rows = [row(-2, WH_A), row(-3, TRUCK, "MOBILE")];
  assert.deepEqual(outstandingConsumptionByLocation(rows, "wo-1", "PRT-1"), [
    { locationType: "WAREHOUSE", locationId: WH_A, outstanding: 2 },
    { locationType: "MOBILE", locationId: TRUCK, outstanding: 3 },
  ]);
});

test("a prior correction reduces what remains outstanding, and a fully-corrected location drops out", () => {
  const rows = [row(-2, WH_A), row(2, WH_A)];
  assert.deepEqual(outstandingConsumptionByLocation(rows, "wo-1", "PRT-1"), []);
});

test("another work order's or part's consumption is not this one's to correct", () => {
  const rows = [
    row(-2, WH_A, "WAREHOUSE", { sourceObject: { type: "WORK_ORDER", id: "wo-OTHER" } }),
    row(-2, WH_A, "WAREHOUSE", { partId: "PRT-OTHER" }),
    { type: "CONSUMED", partId: "PRT-1", quantity: 2 },
  ];
  assert.deepEqual(outstandingConsumptionByLocation(rows, "wo-1", "PRT-1"), [], "including the location-less commitment row");
});

// ══════════════════════════ THE CORRECTION PLAN ══════════════════════════

test("a correction restores to the ORIGINAL source — the user is never asked to choose", () => {
  const outstanding = outstandingConsumptionByLocation([row(-2, WH_A)], "wo-1", "PRT-1");
  const r = planConsumptionCorrection(outstanding, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, [{ locationType: "WAREHOUSE", locationId: WH_A, quantity: 1 }]);
});

test("a correction CANNOT restore more than was consumed", () => {
  // The guard against a decrement becoming an inventory increase.
  const outstanding = outstandingConsumptionByLocation([row(-2, WH_A)], "wo-1", "PRT-1");
  assert.deepEqual(planConsumptionCorrection(outstanding, 3), { ok: false, reason: "CORRECTION_EXCEEDS_CONSUMPTION" });
  // And nothing consumed at all means nothing to give back.
  assert.deepEqual(planConsumptionCorrection([], 1), { ok: false, reason: "CORRECTION_EXCEEDS_CONSUMPTION" });
});

test("repeated corrections cannot inflate stock", () => {
  let rows = [row(-2, WH_A)];
  const first = planConsumptionCorrection(outstandingConsumptionByLocation(rows, "wo-1", "PRT-1"), 2);
  assert.equal(first.ok, true);
  rows = [...rows, row(2, WH_A)];
  // Everything has been given back; a second attempt has nothing left to reverse.
  assert.deepEqual(
    planConsumptionCorrection(outstandingConsumptionByLocation(rows, "wo-1", "PRT-1"), 1),
    { ok: false, reason: "CORRECTION_EXCEEDS_CONSUMPTION" },
  );
});

test("a correction spanning two sources restores to both, most recent first", () => {
  // Consumed 2 from the warehouse then 3 from the truck; correcting 4 gives back the truck's 3 and
  // one from the warehouse. This is bookkeeping about which execution entry is being corrected —
  // explicitly NOT a costing rule, and it decides nothing about value.
  const outstanding = outstandingConsumptionByLocation([row(-2, WH_A), row(-3, TRUCK, "MOBILE")], "wo-1", "PRT-1");
  const r = planConsumptionCorrection(outstanding, 4);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, [
    { locationType: "MOBILE", locationId: TRUCK, quantity: 3 },
    { locationType: "WAREHOUSE", locationId: WH_A, quantity: 1 },
  ]);
  assert.equal(r.plan.reduce((n, p) => n + p.quantity, 0), 4);
});

test("a correction is never a return — no disposition, condition or credit is decided", () => {
  const plan = planConsumptionCorrection(outstandingConsumptionByLocation([row(-2, WH_A)], "wo-1", "PRT-1"), 1);
  assert.equal(plan.ok, true);
  for (const key of ["disposition", "condition", "restock", "credit", "rma"]) {
    assert.equal(plan.plan[0][key], undefined, `a correction must not decide ${key}`);
  }
});
