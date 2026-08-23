// INDEPENDENT WORLD INVARIANTS — deliberately NOT written in terms of the code they check.
//
// ============================ WHY THIS FILE EXISTS SEPARATELY ============================
//
// The generator and its validator can share a defect and agree perfectly.
//
// That is not hypothetical. Part indices were `familyIndex * 100 + nameIndex` and the condition
// spread is `index % 20`; because 100 % 20 === 0, only m = 0..6 were reachable and HEALTHY (m > 8)
// could not occur at all. The world had 37 parts and not one healthy one, while the spread claimed
// 55%. The intended condition and the derived condition MATCHED on every part -- both were reading
// the same broken index -- so a mismatch count of zero was reported for a world that was wrong.
//
// The lesson is specific: a check phrased as "does the deriver agree with the intender" is
// worthless when both share an input. So this file:
//
//   * does NOT import deriveCondition -- it classifies balances itself, from the written definition
//     of each condition, so a bug in the shared helper cannot hide behind itself;
//   * does NOT import stateForIndex -- it never asks what the fixture INTENDED;
//   * asserts DISTRIBUTION and EXISTENCE, which are properties no amount of internal agreement can
//     satisfy. Two components can agree that a set is empty. They cannot agree it is non-empty when
//     it is empty.
//
// The only thing imported from the plan is the plan itself. Everything else is recomputed here.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { CERT_PARTS, reorderPointFor } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
const { buildInventoryPlan } = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));

const plan = buildInventoryPlan();

/**
 * Balances recomputed from raw movements, by this file, from first principles.
 *
 * Not projectBalances(). If that function mis-signed a direction, importing it would make this test
 * agree with the bug -- which is the exact trap being guarded against.
 */
function independentBalances(movements) {
  const warehouse = new Map(), mobile = new Map(), perTruck = new Map(), company = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const mv of movements) {
    // THREE DIRECTIONS, NOT TWO. SIGNED movements (ADJUSTED) carry their own sign; an opening
    // balance is positive, a reconciled shortage is negative. Reading only IN/OUT scored every
    // SIGNED row as zero, which reported a 735-unit world as 34 CRITICAL parts -- this file
    // rebuilds the arithmetic on purpose, and rebuilding it means getting the domain right.
    const signed = mv.direction === "SIGNED" ? mv.quantity
      : mv.direction === "IN" ? mv.quantity
        : mv.direction === "OUT" ? -mv.quantity : 0;
    add(company, mv.partId, signed);
    if (mv.location.type === "WAREHOUSE") add(warehouse, mv.partId, signed);
    else if (mv.location.type === "MOBILE") {
      add(mobile, mv.partId, signed);
      add(perTruck, mv.location.locationId, signed);
    }
  }
  return { warehouse, mobile, perTruck, company };
}

/**
 * Classify a part from its balances, written from the DEFINITION of each condition rather than
 * imported from the code under test.
 */
function independentCondition(part, bal) {
  const rp = reorderPointFor(part);
  const wh = bal.warehouse.get(part.partId) ?? 0;
  const total = bal.company.get(part.partId) ?? 0;
  // Company looks fine; the warehouse cannot fulfil. That relationship IS false comfort.
  if (total > rp && wh < rp) return "FALSE_COMFORT";
  if (wh === 0) return "CRITICAL";
  // Below the reorder point. Whether supply is inbound distinguishes ON_ORDER from REORDER, and
  // this file cannot know that from movements alone -- so it reports the shortage shape and lets
  // the distribution assertions below cover both.
  if (wh < rp) return "BELOW_REORDER";
  if (wh <= rp + 2) return "WATCH";
  return "HEALTHY";
}

const balances = independentBalances(plan);
const quantityParts = CERT_PARTS.filter((p) => p.ledgerTrackingMode !== "SERIAL");
const classified = quantityParts.map((p) => ({ part: p, condition: independentCondition(p, balances) }));
const countOf = (c) => classified.filter((x) => x.condition === c).length;

test("the world contains parts in EVERY materially different inventory position", () => {
  // Existence, not agreement. This is the assertion that caught the index collision, restated
  // without reference to the classifier that missed it.
  assert.ok(countOf("HEALTHY") > 0, "no HEALTHY part -- a world of nothing but problems tests no normal case");
  assert.ok(countOf("WATCH") > 0, "no WATCH part");
  assert.ok(countOf("BELOW_REORDER") > 0, "no part below its reorder point -- REORDER and ON_ORDER are both untestable");
  assert.ok(countOf("CRITICAL") > 0, "no CRITICAL part");
  assert.ok(countOf("FALSE_COMFORT") > 0, "no FALSE_COMFORT part -- the load-bearing scenario is absent");
});

test("the distribution is not degenerate: no single condition swallows the catalog", () => {
  // A world that is 95% one condition satisfies every existence check above and still tests almost
  // nothing. The index-collision world would have passed existence for five of six.
  for (const condition of new Set(classified.map((c) => c.condition))) {
    const share = countOf(condition) / quantityParts.length;
    assert.ok(share < 0.85, `${condition} covers ${Math.round(share * 100)}% of the catalog`);
  }
  assert.ok(new Set(classified.map((c) => c.condition)).size >= 5,
    "fewer than five distinct inventory positions exist across the whole catalog");
});

test("no warehouse or truck balance is ever negative", () => {
  const negatives = [];
  for (const [partId, qty] of balances.warehouse) if (qty < 0) negatives.push(`warehouse ${partId}=${qty}`);
  for (const [partId, qty] of balances.mobile) if (qty < 0) negatives.push(`mobile ${partId}=${qty}`);
  for (const [truckId, qty] of balances.perTruck) if (qty < 0) negatives.push(`truck ${truckId}=${qty}`);
  assert.deepEqual(negatives, [], "stock was shipped that was never received");
});

test("company total equals warehouse plus mobile, exactly", () => {
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum(balances.warehouse) + sum(balances.mobile), sum(balances.company),
    "inventory was created or destroyed between locations");
});

test("the fleet is meaningfully uneven -- one constrained, one broad", () => {
  // Recomputed per truck from raw movements rather than read from TRUCK_PROFILES, so a profile that
  // did not actually take effect cannot pass by declaring itself.
  const loads = [...balances.perTruck.entries()].map(([truckId, units]) => ({ truckId, units }));
  assert.equal(loads.length, 5, `expected 5 trucks carrying stock, found ${loads.length}`);
  const sorted = [...loads].sort((a, b) => a.units - b.units);
  const leanest = sorted[0], broadest = sorted[sorted.length - 1];
  assert.ok(leanest.units * 3 < broadest.units,
    `leanest truck ${leanest.units} vs broadest ${broadest.units} -- not constrained enough to strand a technician`);
  // SKU breadth, not just unit count: a truck with 40 units of one part is not broadly stocked.
  const skusPerTruck = new Map();
  for (const mv of plan) {
    if (mv.location.type !== "MOBILE") continue;
    if (!skusPerTruck.has(mv.location.locationId)) skusPerTruck.set(mv.location.locationId, new Set());
    skusPerTruck.get(mv.location.locationId).add(mv.partId);
  }
  const breadth = [...skusPerTruck.values()].map((s) => s.size);
  assert.ok(Math.max(...breadth) >= 10, `broadest truck carries only ${Math.max(...breadth)} distinct parts`);
  assert.ok(Math.min(...breadth) <= 5, `leanest truck carries ${Math.min(...breadth)} distinct parts -- none is constrained`);
});

test("every planned movement has a unique, clock-free identity", () => {
  const keys = plan.map((m) => m.idempotencyKey);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual([...new Set(dupes)], [], "duplicate idempotency keys -- a replay would be staged as a new movement");
  for (const k of keys) {
    assert.equal(/\d{13}/.test(k), false, `${k} embeds an epoch timestamp -- retries would not replay`);
  }
});

// --- mutation proofs ---------------------------------------------------------
//
// Each reconstructs a defect this file must catch. A guard that has never been seen to fail is a
// guard nobody has reason to trust.

test("MUTATION: a collapsed condition distribution is caught", () => {
  // Every part identically stocked -- the shape the index collision produced.
  // Flatten every WAREHOUSE opening to a single unit. Keyed on location rather than on a movement
  // type: the previous version filtered on RECEIVED, and once opening balances stopped being
  // receipts it selected nothing at all -- a mutation test that mutated nothing and passed by
  // asserting an empty world had a collapsed distribution.
  const flattened = plan.map((m) => (m.location.type === "WAREHOUSE" ? { ...m, quantity: 1 } : m));
  const bal = independentBalances(flattened);
  const conditions = new Set(quantityParts.map((p) => independentCondition(p, bal)));
  assert.ok(conditions.size < 5, "flattening every receipt should collapse the distribution");
  assert.equal(conditions.has("HEALTHY"), false, "no part should read HEALTHY with one unit each");
});

test("MUTATION: a negative warehouse balance is caught", () => {
  const drained = [...plan, {
    type: "TRANSFER_OUT", direction: "OUT", partId: CERT_PARTS[0].partId, quantity: 99999,
    location: { type: "WAREHOUSE", locationId: "wh-main" }, idempotencyKey: "cw_mutation_drain",
  }];
  const bal = independentBalances(drained);
  assert.ok((bal.warehouse.get(CERT_PARTS[0].partId) ?? 0) < 0, "the drain should produce a negative balance");
});

test("MUTATION: a duplicate movement identity is caught", () => {
  const duped = [...plan, { ...plan[0] }];
  const keys = duped.map((m) => m.idempotencyKey);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.ok(dupes.length > 0, "a repeated movement should be detectable by key alone");
});

test("this file does not import the code it is meant to challenge", () => {
  // The guard on the guard. If someone "simplifies" this suite by importing the shared classifier,
  // it silently becomes the agreement check it was written to replace -- and the next shared defect
  // passes exactly the way the last one did.
  //
  // ONLY IMPORT STATEMENTS ARE INSPECTED. A first version scanned the whole file and failed on its
  // own forbidden-word list: the array of names it searches for contains those names. Scanning
  // prose for a symbol finds the prose, which is the same false-positive shape that made an earlier
  // guard match the comment explaining it.
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const importLines = src.split(/\r?\n/).filter((line) => /^\s*(import\b|const\s*\{[^}]*\}\s*=\s*await import)/.test(line));
  assert.ok(importLines.length >= 4, "the import scan found almost nothing -- it is not reading this file");

  const forbidden = ["derive" + "Condition", "state" + "ForIndex", "project" + "Balances", "INVENTORY_" + "STATE"];
  for (const name of forbidden) {
    const offender = importLines.find((line) => line.includes(name));
    assert.equal(offender, undefined,
      `this suite imports ${name} -- it can no longer independently challenge the classifier:\n  ${offender}`);
  }
});
