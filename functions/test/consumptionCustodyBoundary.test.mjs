// THE CUSTODY BOUNDARY around the physical-consumption gap.
// Run: node --test test/consumptionCustodyBoundary.test.mjs   (pure — no emulator)
//
// WHY THIS EXISTS, GIVEN THAT THE GAP IS ALREADY PINNED.
//
// `inventoryConsumptionOnHandGap.test.mjs` (#1749) proves the defect: consumed stock never leaves
// physical on-hand. This file proves the things a FIX will be built on top of — the custody facts
// that already work — because the most likely way to get that fix wrong is not to miss the
// subtraction. It is to subtract twice.
//
// The measured situation is narrower than "no location authority exists", and the difference matters:
//
//   · WAREHOUSE ⇄ MOBILE transfer IS governed (transferOrderCommand), location-scoped and audited.
//   · A warehouse→truck transfer ALREADY removes the quantity from warehouse availability, once.
//   · MOBILE on-hand IS derivable from the same single ledger (the transfer command's own
//     per-part sum, and mobileLocationPresenceProbe's per-location sum).
//   · Serialized custody has its own authority (`serialized_assets.currentLocationId`).
//
// So every piece needed to remove stock at consumption exists EXCEPT one: nothing records WHICH
// governed location the consumed quantity left. That is an Owner decision, and this file deliberately
// does not make it. What it does is fence the answer, so whichever option is chosen cannot silently
// break the custody arithmetic that already holds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "src", rel), "utf8");
/** Comments and string literals removed — a guard that fires on prose explaining an absence is a
 *  guard that gets deleted, taking the protection with it. */
const codeOnly = (rel) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');

const { sumLedgerEligibleOnHand } = await import("../lib/fulfillment/fulfillmentAvailability.js");

const WH = "wh-1";
const WH2 = "wh-2";
const TRUCK = "truck-7";
const at = (type, locationId) => ({ type, locationId });
const NONE = "NONE";
const warehouseOnHand = (rows, eligible = new Set([WH])) => sumLedgerEligibleOnHand(rows, eligible);

const received = (qty, locationId = WH) => ({ type: "RECEIVED", quantity: qty, location: at("WAREHOUSE", locationId), trackingMode: NONE });
const transferOut = (qty, locationId = WH) => ({ type: "TRANSFER_OUT", quantity: qty, location: at("WAREHOUSE", locationId), trackingMode: NONE });
const transferIn = (qty, type, locationId) => ({ type: "TRANSFER_IN", quantity: qty, location: at(type, locationId), trackingMode: NONE });
const consumed = (qty) => ({ type: "CONSUMED", quantity: qty, workOrderId: "wo-1" });

// ══════════════════════════ TRANSFERS CONSERVE, AND DECREMENT ONCE ══════════════════════════

test("a warehouse→truck transfer removes the quantity from warehouse availability EXACTLY ONCE", () => {
  // The premise the whole double-subtraction hazard rests on. If this were false, a consumption fix
  // would be correct to decrement the warehouse — so it is measured, not assumed.
  const rows = [received(5)];
  assert.equal(warehouseOnHand(rows), 5);
  rows.push(transferOut(3), transferIn(3, "MOBILE", TRUCK));
  assert.equal(warehouseOnHand(rows), 2, "5 received − 3 transferred out");
});

test("THE DOUBLE-SUBTRACTION HAZARD: warehouse stock is already gone before the truck consumes it", () => {
  // This is the single most important assertion in this file for whoever implements the fix.
  //
  // After the transfer the warehouse holds 2. If a technician then fits 3 units taken FROM THE TRUCK,
  // the warehouse must STILL hold 2 — those units stopped being warehouse stock at transfer time. A
  // fix that decrements "the warehouse" on every consumption would take the warehouse to −1 (floored
  // to 0), destroying stock that is physically still on the shelf.
  const rows = [received(5), transferOut(3), transferIn(3, "MOBILE", TRUCK)];
  const warehouseBeforeConsumption = warehouseOnHand(rows);
  assert.equal(warehouseBeforeConsumption, 2);

  // Today's CONSUMED row is inert, so asserting only that would be vacuous. So the two candidate
  // shapes a fix could take are modelled explicitly and compared.
  //
  // CORRECT — the removal is scoped to the location that actually held the units:
  const correctlyLocated = [...rows, { type: "TRANSFER_OUT", quantity: 3, location: at("MOBILE", TRUCK), trackingMode: NONE }];
  assert.equal(warehouseOnHand(correctlyLocated), warehouseBeforeConsumption, "the warehouse is untouched — right");

  // WRONG — the same removal aimed at "the warehouse", which is what a location-less fix would have
  // to guess. It destroys 3 units that are physically still on the shelf.
  const wronglyLocated = [...rows, { type: "TRANSFER_OUT", quantity: 3, location: at("WAREHOUSE", WH), trackingMode: NONE }];
  assert.equal(warehouseOnHand(wronglyLocated), 0, "floored at 0, having gone to −1: real stock erased");
  assert.notEqual(warehouseOnHand(wronglyLocated), warehouseBeforeConsumption);

  // And today's actual behaviour: neither, because CONSUMED carries no location at all.
  assert.equal(warehouseOnHand([...rows, consumed(3)]), warehouseBeforeConsumption);
});

test("transfers conserve total inventory across locations — custody moves, quantity does not change", () => {
  const rows = [received(5), transferOut(3), transferIn(3, "WAREHOUSE", WH2)];
  const total = warehouseOnHand(rows, new Set([WH])) + warehouseOnHand(rows, new Set([WH2]));
  assert.equal(total, 5, "3 left wh-1 and arrived at wh-2; nothing was created or destroyed");
  assert.equal(warehouseOnHand(rows, new Set([WH])), 2);
  assert.equal(warehouseOnHand(rows, new Set([WH2])), 3);
});

// ══════════════════════════ MOBILE IS EXCLUDED STRUCTURALLY, NOT BY POLICY ══════════════════════════

test("truck stock is invisible to warehouse availability BY TYPE, not by an eligibility list", () => {
  // A meaningful distinction for the Owner decision. Warehouse availability does not merely omit
  // trucks from a set of eligible ids — it skips every row whose location.type is not WAREHOUSE. So
  // passing a truck id in the eligible set does nothing at all, and "include truck stock in Sales
  // Order availability" is a different and much larger question than adding an id to a list.
  const rows = [received(5), transferOut(3), transferIn(3, "MOBILE", TRUCK)];
  assert.equal(warehouseOnHand(rows, new Set([TRUCK])), 0, "a MOBILE id in the eligible set yields nothing");
  assert.equal(warehouseOnHand(rows, new Set([WH, TRUCK])), 2, "and adding it alongside the warehouse changes nothing");
});

test("the on-hand derivation is warehouse-scoped in code, so widening it is a deliberate act", () => {
  const fn = codeOnly("fulfillment/fulfillmentAvailability.ts");
  assert.match(fn, /loc\.type !== ""/, "the WAREHOUSE type filter must still be the gate");
});

// ══════════════════════════ MOBILE ON-HAND HAS SOMEWHERE TO LAND ══════════════════════════

test("a MOBILE location's on-hand IS derivable from the same single ledger", () => {
  // So a consumption-from-truck has a real figure to decrement, and needs no new inventory store.
  // Proven here by reproducing the direction semantics the transfer command uses per (part, location)
  // — RECEIVED / RETURNED / TRANSFER_IN add, TRANSFER_OUT / SCRAPPED subtract, ADJUSTED is signed.
  const rowsAtTruck = [
    { type: "TRANSFER_IN", quantity: 3, location: at("MOBILE", TRUCK) },
    { type: "TRANSFER_OUT", quantity: 1, location: at("MOBILE", TRUCK) },
  ];
  const truckOnHand = rowsAtTruck.reduce(
    (n, r) => n + (r.type === "TRANSFER_IN" ? r.quantity : r.type === "TRANSFER_OUT" ? -r.quantity : 0),
    0,
  );
  assert.equal(truckOnHand, 2);
  // And the authorities that already compute it are real, not hypothetical.
  assert.match(codeOnly("inventoryTransfer/transferOrderCommand.ts"), /computeNoneOnHandThroughTxn/);
  assert.ok(src("inventoryLedger/mobileLocationPresenceProbe.ts").length > 0, "the per-location probe exists");
});

test("SERIAL custody stays with the serialized-asset authority, never with quantity math", () => {
  // A serialized unit's location is `serialized_assets.currentLocationId`. Summing SERIAL rows as
  // quantity is the H7 defect this derivation already fixed, and a consumption fix must not undo it.
  const rows = [
    received(1),
    { type: "RECEIVED", quantity: 1, location: at("WAREHOUSE", WH), trackingMode: "SERIAL" },
  ];
  assert.equal(warehouseOnHand(rows), 1, "the SERIAL row contributes evidence, never quantity");
});

// ══════════════════════════ THE ONE MISSING FACT ══════════════════════════

test("the consumption path NOW carries a source — at the layer where it is actually known", () => {
  // INVERTED by Decision #171. This previously proved the gap: no source at the plan, the capture or
  // the ledger write. Two of those three closed, and the third stayed shut ON PURPOSE — which is why
  // the assertion is rewritten rather than deleted.
  //
  // 1. THE PLAN — still carries NO location, and that is correct, not an omission. A plan says what a
  //    job needs, not where it will be taken from; deciding the source at planning time would be a
  //    guess made days before anyone touched the shelf.
  const snapshot = src("types/workOrder.ts").slice(src("types/workOrder.ts").indexOf("export interface InventorySnapshotItem"));
  const snapshotBody = snapshot.slice(0, snapshot.indexOf("\n}"));
  for (const field of ["warehouseId", "locationId", "inventoryLocationId", "sourceLocation"]) {
    assert.ok(!new RegExp(`\\b${field}\\??:`).test(snapshotBody), `the PLAN must not carry ${field} — source is decided at use`);
  }
  // 2. THE CAPTURE — the source arrives here, with the usage it explains.
  const capture = codeOnly("updateWorkOrderExecutionData.ts");
  assert.match(capture, /consumptionSources/, "the qtyUsed writer now accepts a governed source per sku");
  assert.match(capture, /planPhysicalConsumption/, "and resolves it through the governed resolver");
  assert.match(capture, /stageOperationalMovement/, "staging the movement in the SAME transaction");
  // 3. THE MOVEMENT — the physical write is location-scoped by construction.
  const movement = codeOnly("workOrderConsumption/consumptionMovement.ts");
  assert.match(movement, /location: \{ type: locationType, locationId \}/);
  // The location-less COMMITMENT path is deliberately untouched: it still writes no location,
  // because it still moves no stock.
  const consume = codeOnly("inventoryService.ts");
  const consumeBlock = consume.slice(consume.indexOf("export async function consumeParts"));
  assert.ok(
    !/location/i.test(consumeBlock.slice(0, consumeBlock.indexOf("\n}\n"))),
    "consumeParts stays location-less — it reconciles a reservation, it does not move stock",
  );
});

test("a WORK_ORDER now produces EXACTLY ONE physical movement, and no more", () => {
  // THE BOUNDARY THE RULING MOVED. This assertion previously proved the opposite — that WORK_ORDER
  // was a declared source type deliberately producing no movement — which was true and load-bearing
  // right up until the Owner decided physical consumption is a governed movement.
  //
  // Inverted rather than deleted, and tightened while inverting: EXACTLY ONE. If a second
  // WORK_ORDER-sourced movement type ever appears, this fails and whoever added it has to say which
  // physical fact it represents that consumption does not already cover.
  const model = src("inventoryLedger/operationalMovementTypes.ts");
  const map = model.slice(model.indexOf("export const MOVEMENT_SOURCE_TYPE"), model.indexOf("ACTOR_KINDS"));
  const workOrderSourced = [...map.matchAll(/^\s*(\w+):\s*"WORK_ORDER"/gm)].map((m) => m[1]);
  assert.deepEqual(workOrderSourced, ["WORK_ORDER_CONSUMPTION"]);
  // And the location-less commitment vocabulary stays disjoint — CONSUMED is still not a movement.
  assert.match(model, /LEGACY_TRANSACTION_TYPES = \["RESERVED", "RELEASED", "CONSUMED"\]/);
  const operational = model.slice(model.indexOf("OPERATIONAL_MOVEMENT_TYPES"), model.indexOf("export type OperationalMovementType"));
  assert.ok(!/"CONSUMED"/.test(operational), "CONSUMED must never become an operational movement type");
});

test("the defect itself, restated at the boundary: consumption moves no physical stock anywhere", () => {
  // Non-vacuous and deliberately blunt. receive 5, consume 2 → warehouse still reads 5, and there is
  // no other location holding −2 either, because the CONSUMED row carries no location at all.
  const rows = [received(5), consumed(2)];
  assert.equal(warehouseOnHand(rows), 5, "the units are still counted as on the shelf");
  assert.equal(warehouseOnHand(rows, new Set([WH, WH2, TRUCK])), 5, "and no other location absorbed them");
});
