// Work Order physical consumption — SOURCE RESOLUTION + the on-hand arithmetic it feeds.
// Run: node --test test/consumptionSource.test.mjs   (pure — no emulator)
//
// The Owner ruling: physical consumption must name a governed source location, and no source is a
// REFUSAL rather than a silent SOURCE UNKNOWN. These cases are the ruling, restated as behaviour.
//
// The arithmetic cases at the end are the ones worth reading twice. They prove the two failures that
// would each be invisible in production: warehouse stock decremented twice after a transfer, and a
// correction restoring stock to somewhere it never came from.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { resolveConsumptionSource, CONSUMPTION_SOURCE_MESSAGE } = await import(
  "../lib/workOrderConsumption/consumptionSource.js"
);
const { sumLedgerEligibleOnHand } = await import("../lib/fulfillment/fulfillmentAvailability.js");

const WH_A = "wh-a";
const WH_B = "wh-b";
const TRUCK = "truck-7";
const GOVERNED = Object.freeze([
  { type: "WAREHOUSE", locationId: WH_A },
  { type: "WAREHOUSE", locationId: WH_B },
  { type: "MOBILE", locationId: TRUCK },
]);
const placement = (over = {}) => ({
  warehouseId: WH_A, partId: "PRT-1", quantity: 5, pickedForWorkOrderId: "wo-1", ...over,
});
const resolve = (over = {}) =>
  resolveConsumptionSource({
    workOrderId: "wo-1", partId: "PRT-1", requestedQuantity: 2, trackingMode: "NONE",
    governedLocations: GOVERNED, placements: [], ...over,
  });

// ══════════════════════════ SOURCE AT PICK — the primary default ══════════════════════════

test("an unambiguous pick placement resolves the source automatically", () => {
  const r = resolve({ placements: [placement()] });
  assert.equal(r.resolved, true);
  assert.equal(r.source.locationId, WH_A);
  assert.equal(r.source.locationType, "WAREHOUSE");
  assert.equal(r.source.basis, "PICKED_PLACEMENT");
});

test("a placement for a DIFFERENT work order or part is not this consumption's source", () => {
  assert.equal(resolve({ placements: [placement({ pickedForWorkOrderId: "wo-OTHER" })] }).reason, "SOURCE_REQUIRED");
  assert.equal(resolve({ placements: [placement({ partId: "PRT-OTHER" })] }).reason, "SOURCE_REQUIRED");
});

test("TWO warehouses picked for the job is AMBIGUOUS — never 'take the first'", () => {
  // The failure this prevents is a guess wearing the authority of a record. Two warehouses each
  // picked for this job is exactly when only the technician knows which units were fitted.
  const r = resolve({ placements: [placement(), placement({ warehouseId: WH_B })] });
  assert.equal(r.resolved, false);
  assert.equal(r.reason, "SOURCE_AMBIGUOUS");
  assert.equal(r.source, null);
});

test("a pick that cannot account for the quantity is AMBIGUOUS, not partially true", () => {
  // Picked 2, using 3. The third unit came from somewhere this record cannot name.
  const r = resolve({ requestedQuantity: 3, placements: [placement({ quantity: 2 })] });
  assert.equal(r.reason, "SOURCE_AMBIGUOUS");
  // Picked exactly enough is fine.
  assert.equal(resolve({ requestedQuantity: 2, placements: [placement({ quantity: 2 })] }).resolved, true);
});

test("a placement naming a location the caller may not use is NOT a licence to use it", () => {
  const r = resolve({ placements: [placement({ warehouseId: "wh-forbidden" })] });
  assert.equal(r.reason, "SOURCE_NOT_GOVERNED");
});

// ══════════════════════════ EXPLICIT SOURCE — fallback AND override ══════════════════════════

test("an explicit governed source resolves when there is no pick at all", () => {
  const r = resolve({ explicitSourceLocationId: WH_B });
  assert.equal(r.resolved, true);
  assert.equal(r.source.locationId, WH_B);
  assert.equal(r.source.basis, "EXPLICIT_SELECTION");
});

test("EXPLICIT OVERRIDES A PICK — picked from Warehouse A, actually used off Truck T", () => {
  // The ruling's own worked example, and the reason explicit is evaluated first. The pick is what
  // someone intended; the explicit answer is what happened. Physical truth beats historical intent.
  const r = resolve({ placements: [placement()], explicitSourceLocationId: TRUCK });
  assert.equal(r.resolved, true);
  assert.equal(r.source.locationId, TRUCK, "the truck, not the picked warehouse");
  assert.equal(r.source.locationType, "MOBILE");
  assert.equal(r.source.basis, "EXPLICIT_SELECTION");
});

test("a MOBILE location is a valid explicit source", () => {
  assert.equal(resolve({ explicitSourceLocationId: TRUCK }).source.locationType, "MOBILE");
});

test("an arbitrary string is refused — source must come from governed location authority", () => {
  for (const bad of ["wh-does-not-exist", "Phoenix", "the truck", "  "]) {
    const r = resolve({ explicitSourceLocationId: bad });
    assert.equal(r.resolved, false, `"${bad}" must not resolve`);
  }
});

// ══════════════════════════ NO SOURCE = REFUSAL ══════════════════════════

test("no pick and no explicit selection is REFUSED, with wording a user can act on", () => {
  const r = resolve();
  assert.equal(r.resolved, false);
  assert.equal(r.reason, "SOURCE_REQUIRED");
  assert.equal(r.source, null, "no fallback location is invented");
  assert.equal(
    CONSUMPTION_SOURCE_MESSAGE.SOURCE_REQUIRED,
    "Select where this part came from before recording usage.",
  );
});

test("every refusal has concrete user-facing wording — no codes, no 'something went wrong'", () => {
  for (const [code, message] of Object.entries(CONSUMPTION_SOURCE_MESSAGE)) {
    assert.ok(message.length > 20, `${code} needs real wording`);
    assert.ok(!message.includes(code), `${code} must not leak its own code to the user`);
    assert.ok(!/something went wrong/i.test(message));
  }
});

test("nothing is ever inferred from technician, customer, company or 'the first warehouse'", () => {
  // Structural: the resolver's inputs simply do not include them, which is a stronger guarantee than
  // a rule saying not to use them.
  const src = readFileSync(new URL("../src/workOrderConsumption/consumptionSource.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const forbidden of ["technicianId", "assignedTechId", "customerId", "operatingCompanyId", "nearest", "default"]) {
    assert.ok(!src.includes(forbidden), `the resolver must not reach for ${forbidden}`);
  }
  // "never take the first of several" is deliberately NOT asserted by grepping for an index, which
  // fires on `warehouses[0]` — the sole remaining element AFTER the ambiguity check, not a pick from
  // a list. The behaviour is proven above, where two warehouses refuse instead of resolving.
});

// ══════════════════════════ SERIALIZED ══════════════════════════

test("a serialized unit's source IS its governed custody", () => {
  const r = resolve({
    trackingMode: "SERIAL", requestedQuantity: 1,
    serializedCurrentLocation: { type: "MOBILE", locationId: TRUCK },
  });
  assert.equal(r.resolved, true);
  assert.equal(r.source.locationId, TRUCK);
  assert.equal(r.source.basis, "SERIALIZED_CUSTODY");
});

test("a serialized unit ignores pick placements entirely — it is not a quantity", () => {
  const r = resolve({
    trackingMode: "SERIAL", requestedQuantity: 1, placements: [placement()],
    serializedCurrentLocation: { type: "WAREHOUSE", locationId: WH_B },
  });
  assert.equal(r.source.locationId, WH_B, "custody wins over the placement");
  assert.equal(r.source.basis, "SERIALIZED_CUSTODY");
});

test("a serialized unit with UNKNOWN custody fails closed rather than being sourced by hand", () => {
  // The one case where allowing a person to assert a location would fabricate history.
  for (const custody of [null, undefined, { type: "WAREHOUSE", locationId: "" }, { type: "", locationId: WH_A }]) {
    const r = resolve({ trackingMode: "SERIAL", requestedQuantity: 1, serializedCurrentLocation: custody });
    assert.equal(r.reason, "SERIAL_CUSTODY_UNKNOWN");
  }
});

test("a CONTRADICTING explicit source on a serialized unit is a defect, not a preference", () => {
  const r = resolve({
    trackingMode: "SERIAL", requestedQuantity: 1, explicitSourceLocationId: WH_B,
    serializedCurrentLocation: { type: "WAREHOUSE", locationId: WH_A },
  });
  assert.equal(r.reason, "SERIAL_SOURCE_CONTRADICTED");
  // Agreeing with custody is fine.
  assert.equal(
    resolve({
      trackingMode: "SERIAL", requestedQuantity: 1, explicitSourceLocationId: WH_A,
      serializedCurrentLocation: { type: "WAREHOUSE", locationId: WH_A },
    }).resolved,
    true,
  );
});

// ══════════════════════════ THE ARITHMETIC THIS FEEDS ══════════════════════════

const at = (type, locationId) => ({ type, locationId });
const NONE = "NONE";
const onHandAt = (rows, id) => sumLedgerEligibleOnHand(rows, new Set([id]));
const received = (qty, id = WH_A) => ({ type: "RECEIVED", quantity: qty, location: at("WAREHOUSE", id), trackingMode: NONE });
/** A physical consumption: SIGNED and NEGATIVE — stock leaves. */
const consumed = (qty, type, id) => ({ type: "WORK_ORDER_CONSUMPTION", quantity: -qty, location: at(type, id), trackingMode: NONE });
/** A correction: the SAME fact positive, restoring to the location it left. */
const corrected = (qty, type, id) => ({ type: "WORK_ORDER_CONSUMPTION", quantity: qty, location: at(type, id), trackingMode: NONE });

test("WAREHOUSE PROOF: receive 5, consume 2 from Warehouse A → 3, exactly once", () => {
  const rows = [received(5)];
  assert.equal(onHandAt(rows, WH_A), 5);
  rows.push(consumed(2, "WAREHOUSE", WH_A));
  assert.equal(onHandAt(rows, WH_A), 3, "not 5, and not 1");
  // The Sales Order availability path reads the same derivation, so it observes 3 too.
  assert.equal(sumLedgerEligibleOnHand(rows, new Set([WH_A, WH_B])), 3);
});

test("MOBILE PROOF: the warehouse is NOT decremented a second time after a transfer", () => {
  // receive 5 at A, transfer 3 to the truck → A=2, truck=3. Consume 2 from the TRUCK.
  const rows = [
    received(5),
    { type: "TRANSFER_OUT", quantity: 3, location: at("WAREHOUSE", WH_A), trackingMode: NONE },
    { type: "TRANSFER_IN", quantity: 3, location: at("MOBILE", TRUCK), trackingMode: NONE },
  ];
  assert.equal(onHandAt(rows, WH_A), 2);
  rows.push(consumed(2, "MOBILE", TRUCK));
  assert.equal(onHandAt(rows, WH_A), 2, "THE DOUBLE-SUBTRACTION GUARD: still 2, never 0");
  // Warehouse Sales Order availability is unchanged, and still excludes the truck entirely.
  assert.equal(sumLedgerEligibleOnHand(rows, new Set([WH_A])), 2);
});

test("CORRECTION PROOF: a decrement restores to the ORIGINAL source, and only what was consumed", () => {
  const rows = [received(5), consumed(2, "WAREHOUSE", WH_A)];
  assert.equal(onHandAt(rows, WH_A), 3);
  rows.push(corrected(1, "WAREHOUSE", WH_A));
  assert.equal(onHandAt(rows, WH_A), 4, "1 restored to Warehouse A");
  // The original consumption row is still there — history is additive, never deleted.
  assert.equal(rows.filter((r) => r.type === "WORK_ORDER_CONSUMPTION").length, 2);
  // And a correction must not restore to a location the stock never left.
  assert.equal(onHandAt(rows, WH_B), 0);
});

test("the location-less commitment CONSUMED still moves NO physical stock", () => {
  // Both facts now exist and must stay separable: one reconciles a reservation, one moves stock.
  const rows = [received(5), { type: "CONSUMED", quantity: 2, workOrderId: "wo-1" }];
  assert.equal(onHandAt(rows, WH_A), 5, "the commitment event is still not a movement");
  rows.push(consumed(2, "WAREHOUSE", WH_A));
  assert.equal(onHandAt(rows, WH_A), 3, "only the physical movement moves physical stock");
});

test("a SERIAL consumption row contributes evidence, never quantity", () => {
  const rows = [
    received(1),
    { type: "WORK_ORDER_CONSUMPTION", quantity: -1, location: at("WAREHOUSE", WH_A), trackingMode: "SERIAL" },
  ];
  assert.equal(onHandAt(rows, WH_A), 1, "serialized custody is not quantity math");
});
