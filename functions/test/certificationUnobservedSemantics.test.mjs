// CERT-PURCH-UNKNOWN-07 -- ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ZERO.
//
// ============================ WHAT THE FIXTURE WAS CLAIMING ============================
//
// CW-P-0000 and CW-P-0301 have ZERO inventory_transactions rows. The fixture called them CRITICAL,
// which is a claim about a physical balance -- "we measured this shelf and it is empty". The
// product disagreed the whole time: readPartBalance returns UNKNOWN when `sawAnyPhysical` is false
// and a KNOWN 0 only when evidence exists and nets to zero.
//
// The disagreement surfaced only when the Golden Purchasing case was computed purely from governed
// facts for the first time, after the wh-main correction made the governed read trustworthy at all.
//
// ============================ THE TWO STATES, AND WHY THEY MUST NOT COLLAPSE ============================
//
//   UNOBSERVED   no governed physical observation exists   -> readPartBalance UNKNOWN
//   CRITICAL     governed evidence establishes zero        -> readPartBalance KNOWN 0
//
// Owner ruling: accept UNOBSERVED as the truthful starting state. NO product change, NO ledger
// change, NO synthetic evidence. Explicitly prohibited and therefore explicitly tested against
// below: a COUNTED 0 (validates and is ignored by every aggregation), a zero-variance cycle count
// (stages nothing), an ADJUSTED 0 (refused -- SIGNED must be non-zero), and any UNKNOWN->0
// coercion in the product.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(process.cwd(), "..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { INVENTORY_STATE, stateForIndex } =
  await import(L("functions/scripts/certificationWorld/data/inventory.mjs"));
const { buildInventoryPlan, projectBalances, deriveCondition, buildOpeningBalanceRecords } =
  await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));
const { CERT_PARTS, reorderPointFor } =
  await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
const { buildPurchasingPlan, orderSignature } =
  await import(L("functions/scripts/certificationWorld/data/purchasingPlan.mjs"));
const { sumLedgerEligibleOnHand } =
  await import(L("functions/lib/fulfillment/fulfillmentAvailability.js"));
const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));
const { worldFingerprint } = await import(L("functions/scripts/certificationWorld/state.mjs"));

const RULED = ["CW-P-0000", "CW-P-0301"];
const QUANTITY_PARTS = CERT_PARTS.filter((p) => p.ledgerTrackingMode !== "SERIAL");
const movements = buildInventoryPlan();
const balances = projectBalances(movements);

// ============================================================================================
// 1. THE PRODUCT RULE, UNTOUCHED. Absence stays UNKNOWN; an observed zero is KNOWN.
// ============================================================================================
const WH = new Set(["wh-main"]);
const row = (type, quantity) => ({
  type, quantity, location: { type: "WAREHOUSE", locationId: "wh-main" }, trackingMode: "NONE",
});

test("absence of physical evidence remains UNKNOWN, and no coercion was introduced", () => {
  assert.equal(sumLedgerEligibleOnHand([], WH), null, "no rows at all is UNKNOWN, never 0");
  // The prohibited remedies, each proven still ineffective -- so nobody is tempted to reach for
  // one believing it would have worked.
  assert.equal(sumLedgerEligibleOnHand([row("COUNTED", 0)], WH), null,
    "a COUNTED 0 validates (SNAPSHOT >= 0) and is ignored by this aggregation");
  assert.equal(sumLedgerEligibleOnHand([row("COUNTED", 5)], WH), null,
    "COUNTED contributes nothing to on-hand at all, at any quantity");
});

test("a genuinely observed zero is KNOWN 0, and is a different answer from UNKNOWN", () => {
  assert.equal(sumLedgerEligibleOnHand([row("RECEIVED", 3), row("TRANSFER_OUT", 3)], WH), 0,
    "evidence that nets to zero is a real, measured zero");
  assert.equal(sumLedgerEligibleOnHand([row("ADJUSTED", 8)], WH), 8);
  // The two must never be the same value: KNOWN 0 and UNKNOWN are different facts.
  assert.notEqual(sumLedgerEligibleOnHand([row("RECEIVED", 3), row("TRANSFER_OUT", 3)], WH),
    sumLedgerEligibleOnHand([], WH));
});

// ============================================================================================
// 2 & 3. THE RULED PARTS, AND THE ABSENCE OF SYNTHETIC EVIDENCE.
// ============================================================================================
test("both ruled parts are UNOBSERVED, and nothing else is", () => {
  const unobserved = QUANTITY_PARTS
    .filter((p) => stateForIndex(p.index) === INVENTORY_STATE.UNOBSERVED)
    .map((p) => p.partId);
  assert.deepEqual(unobserved.sort(), [...RULED].sort(),
    "the ruling names exactly these two, and the index spread must produce exactly these two");
});

test("NO synthetic inventory transaction was introduced for the ruled parts", () => {
  // The load-bearing negative. The whole ruling is that these parts stay unobserved; a movement
  // appearing here -- of any type, at any quantity -- would be the manufactured evidence that was
  // explicitly prohibited.
  for (const partId of RULED) {
    const mine = movements.filter((m) => m.partId === partId);
    assert.equal(mine.length, 0, `${partId} must emit no ledger movement, got ${JSON.stringify(mine)}`);
  }
  assert.ok(!movements.some((m) => m.type === "COUNTED"), "no COUNTED movement anywhere");
  assert.ok(!movements.some((m) => m.quantity === 0), "no zero-quantity movement anywhere");
});

test("the ledger plan is unchanged in size and totals by this correction", () => {
  assert.equal(movements.length, 87, "the accepted live baseline is 87 movements");
  assert.equal(buildOpeningBalanceRecords(movements).length, 87);
  let warehouse = 0;
  for (const [, v] of balances.warehouse) warehouse += v;
  assert.equal(warehouse, 571, "warehouse total is a fact about the world and must not move");
});

// ============================================================================================
// 4. THE DERIVATION. Absence must be checked before any threshold.
// ============================================================================================
test("deriveCondition returns UNOBSERVED for absence, and never falls through to CRITICAL", () => {
  for (const partId of RULED) {
    const part = CERT_PARTS.find((p) => p.partId === partId);
    assert.equal(deriveCondition(part, balances), INVENTORY_STATE.UNOBSERVED,
      `${partId}: no observation exists, so no threshold comparison is meaningful`);
  }
});

test("a part OBSERVED at zero still derives CRITICAL -- the states did not collapse", () => {
  // Constructed, because the certification world contains no such part today (measured live: 0 of
  // 34 have a KNOWN on-hand of 0). If it ever gains one, CRITICAL must still be reachable.
  const part = CERT_PARTS.find((p) => p.partId === "CW-P-0102");
  const observedZero = {
    warehouse: new Map([[part.partId, 0]]),
    truck: new Map(),
    company: new Map([[part.partId, 0]]),
  };
  assert.equal(deriveCondition(part, observedZero), INVENTORY_STATE.CRITICAL,
    "evidence establishing zero is CRITICAL; only ABSENCE is UNOBSERVED");
});

test("the two states are distinct values, not aliases", () => {
  assert.notEqual(INVENTORY_STATE.UNOBSERVED, INVENTORY_STATE.CRITICAL);
  assert.equal(INVENTORY_STATE.UNOBSERVED, "UNOBSERVED");
  assert.equal(INVENTORY_STATE.CRITICAL, "CRITICAL");
});

// ============================================================================================
// 5. THE GOLDEN CASE. Same purpose, truthful starting state.
// ============================================================================================
test("the Golden order is still placed against an UNOBSERVED part, chosen by state not by id", () => {
  const plan = buildPurchasingPlan();
  const golden = plan.find((o) => o.intent === "GOLDEN_INBOUND_RECOVERY");
  assert.ok(golden, "the Golden case must survive the correction");
  const partId = golden.items[0].partId;
  assert.ok(RULED.includes(partId), `Golden part ${partId} must be one of the ruled UNOBSERVED parts`);
  const part = CERT_PARTS.find((p) => p.partId === partId);
  assert.equal(stateForIndex(part.index), INVENTORY_STATE.UNOBSERVED,
    "selected BY STATE -- a hardcoded id would not follow a future fixture change");
  assert.equal(golden.items[0].quantity, 20);
});

test("the Golden transition is UNKNOWN -> first governed receipt -> KNOWN and fulfillable", () => {
  const part = CERT_PARTS.find((p) => p.partId === "CW-P-0000");
  const rp = reorderPointFor(part);
  const qty = buildPurchasingPlan().find((o) => o.intent === "GOLDEN_INBOUND_RECOVERY").items[0].quantity;

  // BEFORE: no observation. Not fulfillable from known stock -- because no known stock exists.
  assert.equal(sumLedgerEligibleOnHand([], WH), null);

  // AFTER a first governed receipt of the ordered quantity: KNOWN, and above the reorder point.
  const afterReceipt = sumLedgerEligibleOnHand([row("RECEIVED", qty)], WH);
  assert.equal(afterReceipt, qty, "the first receipt is what makes the balance knowable at all");
  assert.ok(afterReceipt > rp, `${qty} must clear reorder point ${rp} to be fulfillable`);

  // And a PARTIAL first receipt is still KNOWN -- knowability arrives with the first movement,
  // not with sufficiency.
  const partial = sumLedgerEligibleOnHand([row("RECEIVED", qty / 2)], WH);
  assert.equal(partial, qty / 2);
  assert.notEqual(partial, null, "partial receipt already converts UNKNOWN into KNOWN");
});

// ============================================================================================
// 6. THE PURCHASING PLAN IS OTHERWISE UNTOUCHED.
// ============================================================================================
test("the plan still produces the same five distinct orders", () => {
  const plan = buildPurchasingPlan();
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map((o) => o.intent), [
    "ON_ORDER_RECOVERY", "ON_ORDER_RECOVERY", "GOLDEN_INBOUND_RECOVERY",
    "ROUTINE_REPLENISHMENT", "APPROVED_TRAP_NOT_INBOUND",
  ]);
  const qty = plan.reduce((n, o) => n + o.items[0].quantity, 0);
  const value = plan.reduce((n, o) => n + o.items[0].quantity * o.items[0].unitPrice, 0);
  assert.equal(qty, 83);
  assert.equal(value, 2307.5);
  const sigs = plan.map(orderSignature);
  assert.equal(new Set(sigs).size, 5, "five distinct signatures -- CERT-PURCH-SIG-01 stays non-blocking");
});

test("the APPROVED trap is intact", () => {
  const trap = buildPurchasingPlan().find((o) => o.intent === "APPROVED_TRAP_NOT_INBOUND");
  assert.equal(trap.stopAtStatus, "APPROVED");
  assert.equal(trap.items[0].partId, "CW-P-0001");
  assert.equal(trap.items[0].quantity, 15);
});

// ============================================================================================
// 7. NO FUTURE SCENARIO IS CONSUMED, AND THE WORLD IDENTITY DOES NOT MOVE.
// ============================================================================================
test("no cycle count is implied or consumed by this correction", () => {
  // A zero-variance count stages no ledger movement, so it could not have established known-zero
  // anyway -- and the future Cycle Count ceremony stays unspent.
  assert.ok(!movements.some((m) => m.sourceObject?.type === "COUNT_SHEET"),
    "no COUNT_SHEET source object is referenced by any movement");
  assert.ok(!movements.some((m) => m.purpose && String(m.purpose).includes("cycle")),
    "no cycle-count movement is planned");
});

test("world identity is unchanged -- the condition is not fingerprinted world content", () => {
  const { world, records } = expectedRecords();
  assert.equal(world.version, "1.8.0");
  assert.equal(records.length, 1093);
  assert.equal(worldFingerprint(records).hash, "1782e853",
    "the seeded parts record carries reorder point and catalog facts, never the derived condition");
});
