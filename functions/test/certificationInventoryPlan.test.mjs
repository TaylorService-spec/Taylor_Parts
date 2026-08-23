// INVENTORY CONDITIONS MUST BE DERIVED FROM FACTS, NOT ASSERTED AS LABELS.
//
// ============================ THE RULE ============================
//
// A fixture that persists "this part is CRITICAL" proves nothing: it agrees with itself by
// construction and can never disagree. So the plan builds MOVEMENTS, the balances are projected the
// way the domain projects them, and the condition is DERIVED from those balances. The test then
// checks that the derived condition equals the intended one.
//
// ============================ WHY THAT MATTERED ============================
//
// Writing this found a bug no amount of self-consistency would have shown. Part indices were
// `familyIndex * 100 + nameIndex`, and the condition spread is `index % 20`. Since 100 % 20 === 0,
// every family restarted at the same offset and only m = 0..6 were ever reachable -- so HEALTHY
// (m > 8) could not occur at all. The world had 37 parts and not one healthy one, while the spread
// claimed 55%.
//
// The intended and derived conditions AGREED throughout, because both read the same broken index.
// The mismatch count was zero and the world was wrong. What caught it was asserting that all six
// conditions actually EXIST -- a property neither side could satisfy by agreeing with the other.
//
// An earlier round of the same check caught a second defect: truck allocations were draining
// warehouses below the position their own condition required, producing three NEGATIVE balances and
// seven WATCH parts silently reclassified as FALSE_COMFORT.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { CERT_PARTS, reorderPointFor } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
const { INVENTORY_STATE, stateForIndex } = await import(L("functions/scripts/certificationWorld/data/inventory.mjs"));
const {
  buildInventoryPlan, projectBalances, deriveCondition, TRUCK_PROFILES,
  intendedWarehouseAfterFor, movementKey, CERT_WAREHOUSE_ID,
} = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));

const plan = buildInventoryPlan();
const balances = projectBalances(plan);
/**
 * Parts whose position is a QUANTITY at all.
 *
 * SERIAL-tracked parts are excluded from every balance assertion below, and not as a
 * convenience: a serial unit is exactly one item tracked individually by the serialized_assets
 * registry, never by summing ledger quantities (fulfillmentAvailability's H7 fix). Asking what a
 * serial part's warehouse QUANTITY is asks the wrong question of the domain.
 */
const quantityParts = CERT_PARTS.filter((p) => p.ledgerTrackingMode !== "SERIAL");

const conditionOf = (part) =>
  deriveCondition(part, balances, { hasInboundPo: stateForIndex(part.index) === INVENTORY_STATE.ON_ORDER });

test("ALL SIX conditions actually exist in the world", () => {
  // The assertion that caught the index collision. A spread claiming 55% HEALTHY while producing
  // none is invisible to any check that only compares intent against itself.
  const present = new Set(quantityParts.map(conditionOf));
  for (const state of Object.values(INVENTORY_STATE)) {
    assert.ok(present.has(state), `no part derives ${state} -- that condition cannot be tested (${[...present].join("/")})`);
  }
});

test("every part's DERIVED condition equals its intended one", () => {
  const mismatches = quantityParts
    .map((p) => ({ partId: p.partId, intended: stateForIndex(p.index), derived: conditionOf(p) }))
    .filter((r) => r.intended !== r.derived);
  assert.deepEqual(mismatches, [],
    "the movements produce a different condition than the fixture intends -- the plan is internally inconsistent");
});

test("no location ever holds a negative balance", () => {
  // A negative balance means stock was shipped that was never received. It is not a display defect;
  // it is a world that could not have happened.
  const negatives = [];
  for (const [key, qty] of balances.warehouse) if (qty < 0) negatives.push(`warehouse ${key} = ${qty}`);
  for (const [key, qty] of balances.truck) if (qty < 0) negatives.push(`truck ${key} = ${qty}`);
  assert.deepEqual(negatives, []);
});

test("company total reconciles to warehouse plus trucks, with nothing unexplained", () => {
  // The invariant that makes the whole ledger trustworthy: no inventory appears from nowhere.
  let warehouse = 0, trucks = 0, company = 0;
  for (const v of balances.warehouse.values()) warehouse += v;
  for (const [k, v] of balances.truck) if (!k.includes("@")) trucks += v;
  for (const v of balances.company.values()) company += v;
  assert.equal(warehouse + trucks, company,
    `warehouse ${warehouse} + trucks ${trucks} != company ${company} -- inventory was created or lost`);
});

test("FALSE_COMFORT is a RELATIONSHIP between two figures, not a small number", () => {
  // The condition the whole exercise exists for: the company owns plenty and the warehouse still
  // cannot fulfil, because the units are mobile. If this were merely "low stock" it would be
  // indistinguishable from REORDER and would teach the wrong lesson.
  const falseComfort = quantityParts.filter((p) => conditionOf(p) === INVENTORY_STATE.FALSE_COMFORT);
  assert.ok(falseComfort.length > 0, "no FALSE_COMFORT part exists");
  for (const p of falseComfort) {
    const rp = reorderPointFor(p);
    const wh = balances.warehouse.get(p.partId) ?? 0;
    const total = balances.company.get(p.partId) ?? 0;
    assert.ok(total > rp, `${p.partId}: company total ${total} must EXCEED the reorder point ${rp} -- that is the comfort`);
    assert.ok(wh < rp, `${p.partId}: warehouse ${wh} must fall SHORT of ${rp} -- that is the falseness`);
    assert.ok(total > wh, `${p.partId}: the missing quantity must be somewhere else`);
  }
});

test("a real shortage is never deepened to stock a truck", () => {
  // CRITICAL and REORDER must not ship stock they do not have. Allowing it would make a genuine
  // shortage indistinguishable from FALSE_COMFORT and destroy the difference between them.
  for (const p of quantityParts) {
    const state = stateForIndex(p.index);
    if (state !== INVENTORY_STATE.CRITICAL && state !== INVENTORY_STATE.REORDER) continue;
    const onTrucks = balances.truck.get(p.partId) ?? 0;
    assert.equal(onTrucks, 0, `${p.partId} is ${state} yet ${onTrucks} units were sent to trucks`);
  }
});

test("the five trucks are genuinely different, not five samples of one", () => {
  // A fleet of five statistically identical trucks cannot show a technician arriving without the
  // part, and cannot make cross-truck availability a real question.
  const loads = TRUCK_PROFILES.map((profile) => {
    let units = 0, skus = 0;
    for (const [key, qty] of balances.truck) {
      if (!key.endsWith(`@${profile.truckId}`)) continue;
      units += qty;
      if (qty > 0) skus += 1;
    }
    return { intent: profile.intent, units, skus };
  });
  assert.equal(loads.length, 5);
  const constrained = loads.find((l) => l.intent === "CONSTRAINED");
  const busiest = loads.reduce((a, b) => (b.units > a.units ? b : a));
  assert.ok(constrained.units < busiest.units / 3,
    `the CONSTRAINED truck carries ${constrained.units} against a busiest of ${busiest.units} -- not constrained enough to expose a shortage`);
  assert.equal(new Set(loads.map((l) => l.units)).size, loads.length, "two trucks carry identical totals");
});

test("SERIAL-tracked parts are never allocated as aggregable quantity", () => {
  // fulfillmentAvailability excludes SERIAL rows from quantity math entirely: a serial unit is one
  // item tracked individually, never summed. Allocating them by quantity would build a world whose
  // numbers the domain refuses to compute.
  for (const p of CERT_PARTS.filter((x) => x.ledgerTrackingMode === "SERIAL")) {
    assert.equal(balances.truck.get(p.partId) ?? 0, 0, `${p.partId} is SERIAL-tracked and was allocated by quantity`);
  }
});

test("idempotency keys are derived from intent, never from a clock", () => {
  const keys = plan.map((m) => m.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length, "duplicate idempotency keys -- a replay would be mistaken for a new movement");
  for (const k of keys) {
    assert.match(k, /^cw_[A-Za-z0-9_-]+$/, `${k} is not a well-formed key`);
    // A 13-digit run of digits is an epoch stamp. A key carrying one is different on every run, so
    // a retry would stage a SECOND movement instead of replaying the first.
    assert.equal(/\d{13}/.test(k), false, `${k} embeds a timestamp -- retries would not be recognised as replays`);
  }
});

test("the plan is deterministic: built twice, identical", () => {
  assert.deepEqual(buildInventoryPlan(), plan);
});

test("warehouse stock is initialized at an ELIGIBLE warehouse, truck stock on a real truck", () => {
  // Availability counts only eligible WAREHOUSE locations. Stock initialized anywhere else is real
  // inventory the Parts Room cannot issue -- correct for a truck, wrong for the warehouse.
  const warehouseRows = plan.filter((m) => m.location.type === "WAREHOUSE");
  assert.ok(warehouseRows.length > 0, "the warehouse must hold opening stock");
  for (const m of warehouseRows) assert.equal(m.location.locationId, CERT_WAREHOUSE_ID);

  const truckIds = new Set(TRUCK_PROFILES.map((t) => t.truckId));
  const mobileRows = plan.filter((m) => m.location.type === "MOBILE");
  assert.ok(mobileRows.length > 0, "the fleet must carry opening stock");
  for (const m of mobileRows) {
    assert.ok(truckIds.has(m.location.locationId), `${m.location.locationId} is not a truck in the fleet`);
  }

  // There are no transfer legs to pair, because nothing is transferred. This used to assert that
  // every TRANSFER_OUT had a matching TRANSFER_IN -- a real invariant for real transfers, and a
  // check that quietly certified 55 journeys that never happened. Opening stock is initialized
  // where it sits.
  const legs = plan.filter((m) => m.type === "TRANSFER_OUT" || m.type === "TRANSFER_IN");
  assert.deepEqual(legs, [], "the baseline moves nothing; it declares a starting position");
});

test("the warehouse opens at exactly the balance its condition requires", () => {
  // What the old 'never ship stock it did not receive' check was really protecting: the warehouse
  // must end at the position the part's intended inventory condition needs. It got there by
  // subtracting shipments from an inflated receipt; it gets there now by being initialized at it.
  // Same property, one fewer fiction.
  for (const p of quantityParts) {
    const warehouseOpening = plan
      .filter((m) => m.partId === p.partId && m.location.type === "WAREHOUSE")
      .reduce((sum, m) => sum + m.quantity, 0);
    assert.equal(warehouseOpening, intendedWarehouseAfterFor(p),
      `${p.partId}: warehouse opens at ${warehouseOpening}, but its condition requires ${intendedWarehouseAfterFor(p)}`);
  }
});

test("MUTATION: a plan whose warehouse opening does not match its condition is caught", () => {
  // Proves the check above can fail. Flatten every warehouse opening to 1 and the intended
  // condition is no longer reachable for any part that needed more than one unit.
  const broken = plan.map((m) => (m.location.type === "WAREHOUSE" ? { ...m, quantity: 1 } : m));
  const wrong = quantityParts.filter((p) => {
    const opening = broken
      .filter((m) => m.partId === p.partId && m.location.type === "WAREHOUSE")
      .reduce((sum, m) => sum + m.quantity, 0);
    return opening !== intendedWarehouseAfterFor(p);
  });
  assert.ok(wrong.length > 0, "flattening every warehouse opening to 1 should break the condition");
});

test("the catalog is large enough to be worth having", () => {
  // Seven parts -- what the sandbox had -- cannot support 278 installed units: every Work Order
  // demands the same part and every shortage is the same shortage.
  assert.ok(CERT_PARTS.length >= 30, `only ${CERT_PARTS.length} parts`);
  assert.equal(new Set(CERT_PARTS.map((p) => p.partId)).size, CERT_PARTS.length, "duplicate part ids");
  assert.ok(new Set(CERT_PARTS.map((p) => p.family)).size >= 5, "too few part families to vary demand");
  assert.ok(CERT_PARTS.some((p) => p.ledgerTrackingMode === "SERIAL"), "no SERIAL-tracked part -- that path is unexercised");
});

test("movementKey is a pure function of its inputs", () => {
  const a = movementKey({ purpose: "seed", partId: "CW-P-0001", locationId: "wh-main" });
  const b = movementKey({ purpose: "seed", partId: "CW-P-0001", locationId: "wh-main" });
  assert.equal(a, b);
  assert.notEqual(a, movementKey({ purpose: "seed", partId: "CW-P-0002", locationId: "wh-main" }));
});
