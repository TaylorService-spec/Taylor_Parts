// Fulfillment — OFFLINE regression tests for the allocateSalesOrder allocation algorithm (site-work #1
// so-alloc-overallocation-rerun, site-work #9 allocatesalesorder-missing-tests).
//
// allocateSalesOrder.ts itself is a single onCall transaction body wired to live Firestore + the (currently
// registered active:false, fail-closed-DENY) `salesOrder.fulfill` capability, so it cannot be authorized or
// exercised end-to-end without an Owner-side capability grant. Its allocation math, however, is composed
// ENTIRELY from small pure functions that are exported from the compiled lib and independently unit-tested
// elsewhere (fulfillmentAvailability.js, allocationProjection.js). This file drives those SAME real, compiled
// functions through a small harness (`runAllocationRound`) that reproduces — line for line — the exact
// per-ref computation pipeline in allocateSalesOrder.ts (lines ~139-181). It is not a reimplementation of
// the algorithm; it is the production pipeline replayed against in-memory fixtures shaped like the real
// Firestore reads.
//
// ══════════════════════ THIS SUITE WAS RETARGETED, AND WHY IT HAD TO BE ══════════════════════
//
// It used to make that "line for line" claim while calling `sumEligibleOnHand` — the SUPERSEDED
// stock_locations derivation, replaced in production by `sumLedgerEligibleOnHand` on 2026-08-17. By the
// time of this change NOTHING in functions/src called sumEligibleOnHand; this file was its last caller
// anywhere. So the gate for the allocation command proved a function the command does not run, and
// reported green over the derivation it actually uses — one that differs in every respect that matters:
//
//   flat `warehouseId: string`        ->  the TYPED pair `location: { type, locationId }`
//   a raw stored quantity             ->  MOVEMENT_SIGN via signedQuantity() (RECEIVED +, TRANSFER_OUT −,
//                                         ADJUSTED / WORK_ORDER_CONSUMPTION signed)
//   no notion of a Bin                ->  Model-A custody roll-up through `binParentage` (#160 / ADR-014)
//   every row counted                 ->  SERIAL/LOT rows are evidence but NOT quantity (H7)
//   a truck row was just a warehouse  ->  MOBILE resolves to no custody Warehouse and is excluded
//
// sumEligibleOnHand is now DELETED (see the tombstone in fulfillmentAvailability.ts) and every case below
// runs against `sumLedgerEligibleOnHand`, with ledger-shaped rows and the same `${kind}:${ref}` pool key
// allocateSalesOrder.ts builds. No case was dropped; several gained the ledger facts the old fixtures
// could not express.
//
// Run: npm run build && node --test test/allocateSalesOrderAllocation.test.mjs
// Gate: functions/package.json script `test:fulfillment`; workflow `.github/workflows/fulfillment-allocation-tests.yml`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  computePartAvailability,
  openWorkOrderReserved,
  sumOtherSoCommitments,
  sumLedgerEligibleOnHand,
} from "../lib/fulfillment/fulfillmentAvailability.js";
import { buildAllocationPlan } from "../lib/fulfillment/allocationProjection.js";
import { binIdsReferenced } from "../lib/inventoryLedger/locationOnHand.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const src = (rel) => readFileSync(join(SRC, rel), "utf8");

// Mirrors allocateSalesOrder.ts's per-ref availability + plan + write pipeline exactly, using the real
// exported pure functions. `so.lines` is mutated in place with the new allocatedQty, exactly like the
// transaction's `nextLines` write — so calling this twice on the SAME `so` object simulates a real re-run
// (retry, or a second legitimate allocate call) against the SAME ledger/other-SO fixtures.
//
// `ledgerRows` stands in for the single `inventory_transactions where partId == ref` read the callable
// makes; `binParentage` stands in for its readBinParentage() call over binIdsReferenced(rows). Both
// physical movements and legacy commitment rows live in that one collection, which is why one fixture
// array feeds both sumLedgerEligibleOnHand and openWorkOrderReserved here, as it does in production.
function runAllocationRound({ so, otherSoLines, ledgerRows, eligibleWarehouseIds, excludeWorkOrderIds, binParentage }) {
  const parentage = binParentage ?? new Map();
  const availabilityByRef = {};
  const distinctPartRefs = [...new Set(so.lines.filter((l) => l.kind === "PART").map((l) => l.ref))];
  for (const ref of distinctPartRefs) {
    const rows = ledgerRows.filter((r) => r.partId === ref);
    // The callable resolves parentage for exactly the bins its rows name — asserted, not assumed, so a
    // fixture that references an unresolved bin is exercising the real exclusion path.
    binIdsReferenced(rows);
    const onHandEligible = sumLedgerEligibleOnHand(rows, eligibleWarehouseIds, parentage);
    const openWoReserved = onHandEligible === null ? 0 : openWorkOrderReserved(rows, excludeWorkOrderIds);
    const other = sumOtherSoCommitments(otherSoLines, "PART", ref);
    const self = sumOtherSoCommitments(so.lines, "PART", ref);
    // Kind-scoped pool key, exactly as allocateSalesOrder.ts builds it (CX-4 #956).
    availabilityByRef[`PART:${ref}`] = computePartAvailability({
      onHandEligible,
      openWoReserved,
      otherSoAllocated: other.allocatedQty,
      selfAllocated: self.allocatedQty,
    });
  }
  const plan = buildAllocationPlan(so.lines, availabilityByRef);
  // Positional mapping (site-work allocatesalesorder-duplicate-ref-lines-double-allocate): plan.lines is a 1:1,
  // order-preserving map over so.lines, so each line's own result lives at the same index -- mirrors the fixed
  // write step in allocateSalesOrder.ts exactly (a bare find(ref+kind) would mis-write every sibling line that
  // shares a ref+kind with the FIRST matching plan-line).
  so.lines = so.lines.map((l, i) => {
    const alloc = plan.lines[i];
    const already = typeof l.allocatedQty === "number" ? l.allocatedQty : 0;
    return alloc ? { ...l, allocatedQty: already + alloc.allocatableQty } : l;
  });
  return plan;
}

const partLine = (ref, orderedQty, allocatedQty = 0) => ({ kind: "PART", ref, orderedQty, allocatedQty });

/** A physical movement at a typed location. Defaults to a NONE-tracked receipt in a WAREHOUSE. */
const move = (partId, quantity, { type = "RECEIVED", locationType = "WAREHOUSE", locationId = "WH-A", trackingMode = "NONE" } = {}) => ({
  partId,
  type,
  quantity,
  trackingMode,
  location: { type: locationType, locationId },
});
/** A legacy commitment row: no location, no trackingMode — exactly as writeLedgerEntry() stores it. */
const commit = (partId, type, quantity, workOrderId) => ({ partId, type, quantity, workOrderId });

// (a) THE DEFECT: a second invocation with nothing else changed must NOT double-commit.
test("re-run idempotency: a second allocation call does not double-commit the same on-hand pool (site-work #1)", () => {
  const so = { lines: [partLine("PART-1", 10)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  const ledgerRows = [move("PART-1", 10)];
  const args = { so, otherSoLines: [], ledgerRows, eligibleWarehouseIds, excludeWorkOrderIds: new Set() };

  const first = runAllocationRound(args);
  assert.equal(first.lines[0].allocatableQty, 10);
  assert.equal(so.lines[0].allocatedQty, 10, "first call allocates the full 10 units on-hand");

  // Re-run: an SO allocation writes no ledger movement (non-forking design), so the SAME undiminished
  // on-hand is read again. Before the fix, ATP was recomputed as the full 10 and `already +
  // allocatableQty` bumped allocatedQty to 20 against only 10 physical units -- the double-commit.
  const second = runAllocationRound(args);
  assert.equal(second.lines[0].allocatableQty, 0, "nothing left to allocate: this SO already holds the whole pool");
  assert.equal(so.lines[0].allocatedQty, 10, "allocatedQty stays at 10, never grows past the physical on-hand");

  // A third call is equally inert.
  runAllocationRound(args);
  assert.equal(so.lines[0].allocatedQty, 10);
});

// (a-2) Partial-then-retry: the classic race/retry shape where the first call cannot fully satisfy demand.
test("re-run idempotency under partial fulfillment: repeated calls converge to on-hand, never exceed it", () => {
  const so = { lines: [partLine("PART-1", 10)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  const ledgerRows = [move("PART-1", 6)]; // only 6 physically on-hand for an order of 10
  const args = { so, otherSoLines: [], ledgerRows, eligibleWarehouseIds, excludeWorkOrderIds: new Set() };

  const first = runAllocationRound(args);
  assert.equal(first.lines[0].state, "PARTIAL");
  assert.equal(so.lines[0].allocatedQty, 6);

  // Retry with the SAME undiminished on-hand read (6). Before the fix this granted another 6 (would-be 12
  // against a 6-unit pool -- the same bug, just visible with a shortfall instead of a clean multiple).
  const second = runAllocationRound(args);
  assert.equal(second.lines[0].allocatableQty, 0, "self-netted ATP is now 0 -- no more physical stock to give");
  assert.equal(so.lines[0].allocatedQty, 6, "allocatedQty converges to the true 6-unit pool, never over-commits");
});

// (b) Self-netting in isolation: computePartAvailability must subtract THIS SO's own prior commitment.
test("self-netting: computePartAvailability nets selfAllocated from the same pool as otherSoAllocated", () => {
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 0, otherSoAllocated: 0, selfAllocated: 4 }),
    { kind: "KNOWN", quantity: 6 }
  );
  // self + other stack against the same physical pool.
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 0, otherSoAllocated: 3, selfAllocated: 4 }),
    { kind: "KNOWN", quantity: 3 }
  );
  // floored at 0, never negative.
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 5, openWoReserved: 0, otherSoAllocated: 0, selfAllocated: 9 }),
    { kind: "KNOWN", quantity: 0 }
  );
  // selfAllocated is optional/omittable and defaults to no netting (backward-compatible call shape).
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 0, otherSoAllocated: 0 }),
    { kind: "KNOWN", quantity: 10 }
  );
});

// (c) Eligible-warehouse filtering: only status==ACTIVE warehouses' stock counts; missing evidence stays UNKNOWN.
test("eligible-warehouse filtering: only eligible-warehouse stock counts toward on-hand", () => {
  const eligibleWarehouseIds = new Set(["WH-ACTIVE"]);
  const ledgerRows = [
    move("PART-1", 4, { locationId: "WH-ACTIVE" }),
    move("PART-1", 100, { locationId: "WH-INACTIVE" }),
  ];
  assert.equal(
    sumLedgerEligibleOnHand(ledgerRows, eligibleWarehouseIds, new Map()),
    4,
    "the 100 units at an ineligible warehouse are excluded entirely"
  );

  // movement exists but none at an eligible warehouse -> a KNOWN 0 (backorder), not UNKNOWN.
  assert.equal(sumLedgerEligibleOnHand([move("PART-1", 100, { locationId: "WH-INACTIVE" })], eligibleWarehouseIds, new Map()), 0);

  // no physical movement evidence at all -> null (UNKNOWN), never treated as 0.
  assert.equal(sumLedgerEligibleOnHand([], eligibleWarehouseIds, new Map()), null);

  // end-to-end through a full allocation round: only the eligible-warehouse stock is allocatable.
  const so = { lines: [partLine("PART-1", 4)] };
  const plan = runAllocationRound({ so, otherSoLines: [], ledgerRows, eligibleWarehouseIds, excludeWorkOrderIds: new Set() });
  assert.equal(plan.lines[0].state, "ALLOCATED");
  assert.equal(so.lines[0].allocatedQty, 4);
});

// (c-2) THE TYPED PAIR. Location identity is (location_type, location_id) — never a bare id. The old
// stock_locations fixtures could not express this at all, which is precisely why the retarget matters:
// a truck whose id collides with an eligible warehouse id must NOT become sellable warehouse stock.
test("typed location pair: a MOBILE row is never warehouse stock, even when its id is in the eligible set", () => {
  const eligible = new Set(["WH-A"]);
  const truckSharingTheId = [move("PART-1", 7, { locationType: "MOBILE", locationId: "WH-A" })];
  assert.equal(
    sumLedgerEligibleOnHand(truckSharingTheId, eligible, new Map()),
    0,
    "MOBILE resolves to no custody Warehouse — a bare-id comparison would have promised a van's contents"
  );

  // And end-to-end: the order backorders rather than being promised truck stock.
  const so = { lines: [partLine("PART-1", 7)] };
  const plan = runAllocationRound({ so, otherSoLines: [], ledgerRows: truckSharingTheId, eligibleWarehouseIds: eligible, excludeWorkOrderIds: new Set() });
  assert.equal(plan.lines[0].state, "BACKORDERED");
  assert.equal(so.lines[0].allocatedQty, 0);
});

// (c-3) MODEL A (#160 / ADR-014): stock put away into a Bin is still its parent Warehouse's stock — and an
// unresolvable Bin is EXCLUDED, never guessed into a parent. allocateSalesOrder.ts:68 resolves parentage
// inside the same transaction for exactly the bins its rows name; this is that behaviour end-to-end.
test("Model-A bin custody: binned stock rolls up to its governed parent, and an unresolved bin is excluded", () => {
  const eligible = new Set(["WH-A"]);
  const rows = [
    move("PART-1", 3, { locationId: "WH-A" }),
    move("PART-1", 5, { locationType: "BIN", locationId: "bin-a1" }),
  ];
  assert.deepEqual(binIdsReferenced(rows), ["bin-a1"], "only the bins these rows name need resolving");

  assert.equal(sumLedgerEligibleOnHand(rows, eligible, new Map([["bin-a1", "WH-A"]])), 8, "3 loose + 5 binned");
  assert.equal(
    sumLedgerEligibleOnHand(rows, eligible, new Map()),
    3,
    "an unresolved bin contributes nothing — its stock is never attributed to a guessed parent"
  );

  const so = { lines: [partLine("PART-1", 8)] };
  const plan = runAllocationRound({
    so, otherSoLines: [], ledgerRows: rows, eligibleWarehouseIds: eligible,
    excludeWorkOrderIds: new Set(), binParentage: new Map([["bin-a1", "WH-A"]]),
  });
  assert.equal(plan.lines[0].state, "ALLOCATED");
  assert.equal(so.lines[0].allocatedQty, 8, "binned stock is promisable");
});

// (c-4) MOVEMENT SIGN comes from the ONE authority (inventoryLedger/locationOnHand.ts MOVEMENT_SIGN),
// which the old stock_locations fixtures bypassed entirely: they carried a stored quantity with no type.
test("movement sign: outbound and signed movements reduce what allocation may promise", () => {
  const eligible = new Set(["WH-A"]);
  const rows = [
    move("PART-1", 10),
    move("PART-1", 3, { type: "TRANSFER_OUT" }),
    move("PART-1", -2, { type: "WORK_ORDER_CONSUMPTION" }), // SIGNED: carries its own negative
    move("PART-1", -1, { type: "ADJUSTED" }), // SIGNED: a reconciled shortage
    move("PART-1", 2, { type: "RETURNED" }),
    move("PART-1", 1, { type: "SCRAPPED" }),
  ];
  assert.equal(sumLedgerEligibleOnHand(rows, eligible, new Map()), 10 - 3 - 2 - 1 + 2 - 1);

  const so = { lines: [partLine("PART-1", 10)] };
  const plan = runAllocationRound({ so, otherSoLines: [], ledgerRows: rows, eligibleWarehouseIds: eligible, excludeWorkOrderIds: new Set() });
  assert.equal(plan.lines[0].allocatableQty, 5, "only the 5 units the sign rule leaves standing are promisable");
  assert.equal(plan.lines[0].state, "PARTIAL");
});

// (c-5) H7: a SERIAL-tracked row is movement EVIDENCE but never aggregable quantity — serial custody lives
// in serialized_assets, not in quantity math. Evidence without quantity must read as a known 0, not UNKNOWN.
test("SERIAL rows are evidence, not quantity: an eligible warehouse with only serial evidence is a known 0", () => {
  const eligible = new Set(["WH-A"]);
  const serialOnly = [move("PART-1", 1, { type: "ADJUSTED", trackingMode: "SERIAL" })];
  assert.equal(sumLedgerEligibleOnHand(serialOnly, eligible, new Map()), 0, "a real, if empty, answer — never a fabricated UNKNOWN");
  assert.equal(
    sumLedgerEligibleOnHand([move("PART-1", 4), ...serialOnly], eligible, new Map()),
    4,
    "the serial row does not inflate the NONE-mode total"
  );
});

// (d) Work-order-lineage exclusion: WO reservations linked to an active SO are excluded from openWoReserved
// (that demand is already counted via the SO's own allocation) — a standalone WO's reservation still counts.
test("work-order-lineage exclusion: SO-linked WO reservations are excluded; standalone WO reservations still net", () => {
  const commitments = [commit("PART-1", "RESERVED", 3, "WO-LINKED"), commit("PART-1", "RESERVED", 2, "WO-STANDALONE")];
  assert.equal(openWorkOrderReserved(commitments, new Set(["WO-LINKED"])), 2, "only the standalone WO's 2 units count");
  assert.equal(openWorkOrderReserved(commitments, new Set()), 5, "with no lineage exclusion, both WOs net");

  // end-to-end: physical movements and commitment rows share ONE collection, exactly as production reads them.
  const so = { lines: [partLine("PART-1", 10)] };
  const plan = runAllocationRound({
    so,
    otherSoLines: [],
    ledgerRows: [move("PART-1", 10), ...commitments],
    eligibleWarehouseIds: new Set(["WH-A"]),
    excludeWorkOrderIds: new Set(["WO-LINKED"]),
  });
  assert.equal(plan.lines[0].allocatableQty, 8, "10 on-hand minus the 2-unit standalone WO reservation");
  assert.equal(so.lines[0].allocatedQty, 8);
});

// (d-2) COMMITMENT FACTS ARE NOT PHYSICAL MOVEMENTS. RESERVED/RELEASED/CONSUMED must never reach the
// on-hand side of the arithmetic; they are subtracted once, on the commitment side. A ledger carrying only
// commitment rows therefore has NO physical evidence and the part stays UNKNOWN — never a confident 0.
test("commitment facts never enter on-hand: a commitment-only ledger is UNKNOWN, and allocation refuses", () => {
  const eligible = new Set(["WH-A"]);
  const commitmentsOnly = [commit("PART-1", "RESERVED", 4, "WO-1"), commit("PART-1", "RELEASED", 1, "WO-1")];
  assert.equal(sumLedgerEligibleOnHand(commitmentsOnly, eligible, new Map()), null, "no physical movement ⇒ UNKNOWN");

  const so = { lines: [partLine("PART-1", 4)] };
  const plan = runAllocationRound({ so, otherSoLines: [], ledgerRows: commitmentsOnly, eligibleWarehouseIds: eligible, excludeWorkOrderIds: new Set() });
  assert.equal(plan.lines[0].state, "UNKNOWN", "missing evidence is never silently converted to 0 or to stock");
  assert.equal(plan.readiness, "UNKNOWN");
  assert.equal(so.lines[0].allocatedQty, 0);
});

// (f) site-work allocatesalesorder-duplicate-ref-lines-double-allocate: two SO lines sharing the same ref
// (e.g. the same part ordered on two lines) must draw down the SAME available-to-promise pool -- not each see
// the full undiminished 5-unit ATP -- AND the write step must give each line its OWN result (not silently copy
// the first matching line's outcome onto every line that shares its ref+kind).
test("duplicate-ref lines: two lines sharing a ref never jointly exceed the pool, and each gets its own result", () => {
  const so = { lines: [partLine("PART-1", 5), partLine("PART-1", 5)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  const ledgerRows = [move("PART-1", 5)]; // ATP = 5, two lines each ordering 5
  const plan = runAllocationRound({ so, otherSoLines: [], ledgerRows, eligibleWarehouseIds, excludeWorkOrderIds: new Set() });

  const totalAllocated = so.lines.reduce((sum, l) => sum + l.allocatedQty, 0);
  assert.equal(totalAllocated, 5, "total allocatedQty across both lines must not exceed the 5-unit pool (not 10)");

  // Each line carries ITS OWN result -- not a copy of the first line's outcome.
  assert.deepEqual({ alloc: so.lines[0].allocatedQty, state: plan.lines[0].state }, { alloc: 5, state: "ALLOCATED" });
  assert.deepEqual({ alloc: so.lines[1].allocatedQty, state: plan.lines[1].state }, { alloc: 0, state: "BACKORDERED" });
  assert.equal(plan.lines[1].shortfallQty, 5);

  // A follow-up call (rerun / #880 self-netting) stays converged: no further growth past the true 5-unit pool.
  const rerun = runAllocationRound({ so, otherSoLines: [], ledgerRows, eligibleWarehouseIds, excludeWorkOrderIds: new Set() });
  assert.equal(so.lines.reduce((sum, l) => sum + l.allocatedQty, 0), 5, "rerun does not grow allocation past the physical pool");
  assert.equal(rerun.lines[0].allocatableQty, 0);
  assert.equal(rerun.lines[1].allocatableQty, 0);
});

// (e) Insufficient-stock rejection: a line can never be granted more than the true remaining physical pool,
// and the transaction-level precondition (only CONFIRMED/IN_FULFILLMENT may allocate) rejects the whole call
// outright for any other state — the shortfall is always honest (BACKORDERED/PARTIAL), never silently zeroed
// or over-granted.
test("insufficient-stock rejection: allocation never exceeds the true remaining pool; shortfall is honest", () => {
  const so = { lines: [partLine("PART-1", 5)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  // Evidence that nets to zero (received then transferred out) — an empty shelf, which is a different
  // fact from no evidence at all, and must read as a known 0 / BACKORDERED rather than UNKNOWN.
  const ledgerRows = [move("PART-1", 2), move("PART-1", 2, { type: "TRANSFER_OUT" })];
  const plan = runAllocationRound({ so, otherSoLines: [], ledgerRows, eligibleWarehouseIds, excludeWorkOrderIds: new Set() });
  assert.equal(plan.lines[0].state, "BACKORDERED");
  assert.equal(plan.lines[0].allocatableQty, 0);
  assert.equal(plan.lines[0].shortfallQty, 5);
  assert.equal(so.lines[0].allocatedQty, 0, "no phantom allocation when nothing is on-hand");
  assert.equal(plan.readiness, "BLOCKED");

  // another active SO already holds the entire pool -> this SO gets nothing, honestly reported.
  const so2 = { lines: [partLine("PART-2", 5)] };
  const otherSoLines = [{ kind: "PART", ref: "PART-2", allocatedQty: 10 }];
  const plan2 = runAllocationRound({
    so: so2, otherSoLines, ledgerRows: [move("PART-2", 10)], eligibleWarehouseIds, excludeWorkOrderIds: new Set(),
  });
  assert.equal(plan2.lines[0].allocatableQty, 0);
  assert.equal(plan2.lines[0].state, "BACKORDERED");
});

// ══════════════════════════════ THE SUPERSEDED DERIVATION IS GONE ══════════════════════════════

test("sumEligibleOnHand is deleted — one on-hand answer, not two", () => {
  const availability = src("fulfillment/fulfillmentAvailability.ts");
  assert.doesNotMatch(
    availability,
    /export function sumEligibleOnHand/,
    "the stock_locations derivation must not come back; sumLedgerEligibleOnHand is the answer"
  );
  // And the command reads the surviving one, resolving bin parentage as Model A requires.
  const command = src("fulfillment/allocateSalesOrder.ts");
  assert.match(command, /sumLedgerEligibleOnHand\(rows, eligibleWarehouseIds, binParentage\)/);
  assert.match(command, /readBinParentage\(db, binIdsReferenced\(rows\), tx\)/);
});

// ══════════════════════════ PINNED: WHAT ALLOCATION STILL CANNOT DO ══════════════════════════
//
// Two gaps below are REAL and are deliberately NOT fixed here. Both sit on Owner rulings that are
// recorded as open, so choosing a behaviour would be minting authority rather than implementing it.
// They are pinned so the next change to this command cannot be built on top of them unknowingly —
// the same treatment inventoryConsumptionOnHandGap.test.mjs gives the consumption gap.

test("PINNED GAP — allocation is operating-company blind (DECISIONS #165 ruling 4, NOT closed)", () => {
  const command = src("fulfillment/allocateSalesOrder.ts");

  // A Sales Order is REQUIRED to carry a governed operating company: salesOrderCommands.ts refuses to
  // create one without it ("requires a governed operatingCompanyId").
  assert.match(src("salesOrder/salesOrderCommands.ts"), /requires a governed operatingCompanyId/);

  // The allocation command never reads it. Its eligible-stock pool is every status==ACTIVE warehouse
  // and its netting pool is every active Sales Order — both companies at once. A Ventana order is
  // therefore promised against Taylor stock, and nets against Taylor commitments, with no refusal.
  assert.doesNotMatch(command, /operatingCompanyId/, "if this ever passes, the pin below is stale — update it, do not delete it");
  assert.match(command, /WAREHOUSES_COLLECTION\)\.where\("status", "==", "ACTIVE"\)/);
  assert.match(command, /SALES_ORDERS_COLLECTION\)\.where\("state", "in", \[\.\.\.ACTIVE_SO_STATES\]\)/);

  // WHY IT IS NOT FIXED HERE. Scoping the pool by company needs the WAREHOUSE side to declare one, and
  // operatingCompanyId is ALLOWED-but-never-required on a governed warehouse, so a company-scoped pool
  // would silently drop every company-less warehouse from availability — inventing the refusal-vs-guess
  // answer that #165 ruling 4 records as open ("Company must not be inferred from location").
  assert.match(
    src("warehouseGovernance/governedWarehouseValidation.ts"),
    /ALLOWED, never\s*\n?\s*\/\/\s*required/,
    "the warehouse side cannot supply what a company-scoped pool would require"
  );
});

test("PINNED DIVERGENCE — two commitment sums over one ledger (DECISIONS #165, ruling unmade)", () => {
  // openWorkOrderReserved (this command)          RESERVED − RELEASED − CONSUMED
  // openCommitment (inventoryService, Work Orders) RESERVED − RELEASED
  //
  // One physical pool, two answers to "what is committed". Which is right depends on an inventory-
  // semantics decision #165 explicitly declined to take, so this pins the disagreement rather than
  // resolving it: whichever way it goes, it must be decided once, for both families.
  const rows = [
    { type: "RESERVED", quantity: 5, workOrderId: "wo-1" },
    { type: "CONSUMED", quantity: 2, workOrderId: "wo-1" },
  ];
  assert.equal(openWorkOrderReserved(rows), 3, "the Sales Order path releases the consumed 2 from commitment");
  assert.match(src("inventoryService.ts"), /function openCommitment/);
  assert.match(
    src("inventoryService.ts"),
    /WHY THIS IS NOT `openWorkOrderReserved`, WHICH ALSO SUBTRACTS CONSUMED/,
    "the Work Order path deliberately does not — and says so in the code"
  );
});
