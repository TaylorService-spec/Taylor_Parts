// INVENTORY COMMITMENT / RESERVATION AUTHORITY — what commits stock, and what only asks for it.
// Run: node --test test/inventoryCommitmentAuthority.test.mjs   (after `npm run build`)
//
// NO EMULATOR. Every claim here is proven either against a PURE exported function or against the
// SOURCE of the module that would have to change for the claim to stop being true — the same
// "asserted on the code, not on a promise" shape putAwayCommand.test.mjs already uses for the
// picking invariant. The emulator-backed behaviour (reserve/release/consume round trips,
// WO-vs-WO concurrency) is already covered by inventoryService.test.mjs and
// allocateSalesOrderAllocation.test.mjs; this file deliberately does not duplicate it.
//
// WHAT THIS FILE EXISTS TO PIN. A reconciliation of the commitment model found TWO commitment
// facts, not one:
//
//   1. WORK ORDER reservations — inventory_transactions RESERVED/RELEASED/CONSUMED, written ONLY
//      by inventoryService.ts, only as a Work Order LIFECYCLE effect (DISPATCHED reserves,
//      CANCELLED releases, COMPLETED consumes). Live and deployed.
//   2. SALES ORDER allocations — sales_orders.lines[].allocatedQty, written ONLY by
//      allocateSalesOrder.ts. Governed-inert (capability active:false).
//
// They are ASYMMETRIC, and that asymmetry is the finding: the Sales Order path reads BOTH
// authorities before allocating, while the Work Order path reads only its own. Nothing in the
// repository asserted this in either direction, so the shape could change without anyone noticing.
// These tests fix the current truth in place; they do not endorse it and they change nothing.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Every source file under `dir` matching `re`, as repo-relative POSIX paths. */
function filesUnder(dir, re) {
  const root = fileURLToPath(new URL(dir, import.meta.url));
  const out = [];
  (function walk(d) {
    for (const entry of readdirSync(d)) {
      const p = `${d}/${entry}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (re.test(entry)) out.push(p.replace(/\\/g, "/"));
    }
  })(root.replace(/\\/g, "/"));
  return out;
}
const relativeTo = (paths, marker) => paths.map((p) => p.slice(p.lastIndexOf(marker) + marker.length)).sort();

const {
  openWorkOrderReserved,
  sumLedgerEligibleOnHand,
  computePartAvailability,
} = await import("../lib/fulfillment/fulfillmentAvailability.js");

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
/** Source with line comments stripped — a claim about behaviour must not be satisfied by prose. */
const code = (p) => src(p).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

const INVENTORY_SERVICE = "inventoryService.ts";
const ALLOCATE_SO = "fulfillment/allocateSalesOrder.ts";

// ════════════════════ 1. WHERE COMMITMENT CAN COME FROM ════════════════════

test("inventoryService.ts is the SOLE writer of a RESERVED ledger entry", () => {
  // Proven by exhaustion over the whole source tree rather than by naming the files we expect.
  // If a second writer ever appears, this fails and the reconciliation has to be redone.
  const writers = filesUnder("../src", /\.ts$/).filter((p) => readFileSync(p, "utf8").includes('type: "RESERVED"'));
  assert.deepEqual(
    relativeTo(writers, "/src/"),
    [INVENTORY_SERVICE],
    `RESERVED is written by: ${relativeTo(writers, "/src/").join(", ")}`,
  );
});

test("commitment is a Work Order LIFECYCLE effect — never a creation, plan, pick or scan effect", () => {
  const service = code(INVENTORY_SERVICE);
  // The trigger table is the authority for WHEN stock is committed.
  assert.match(service, /DISPATCHED:\s*reserveParts/, "DISPATCHED must reserve");
  assert.match(service, /CANCELLED:\s*releaseParts/, "CANCELLED must release");
  assert.match(service, /COMPLETED:/, "COMPLETED must consume");
  // States with no ledger-writeable meaning must stay absent rather than appear as no-ops.
  for (const state of ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]) {
    assert.ok(
      !new RegExp(`\\n\\s*${state}:`).test(service.slice(service.indexOf("STATE_TRIGGERS"))),
      `${state} must NOT be a commitment trigger`,
    );
  }
});

test("no other governed writer commits stock as a side effect", () => {
  // Each of these creates or edits DEMAND. None may write a reservation.
  for (const path of [
    "createWorkOrder.ts",
    "workOrderPartsPlan/setWorkOrderPartsPlan.ts",
    "salesOrder/salesOrderCommands.ts",
    "salesAgreement/salesAgreementCommands.ts",
    "inventoryLocation/putAwayCommand.ts",
    "inventoryTransfer/transferOrderCommand.ts",
    "inventoryReceiving/receiveInventoryStockCommand.ts",
    "inventoryReturns/returnIntakeCommand.ts",
  ]) {
    assert.ok(!code(path).includes('"RESERVED"'), `${path} must not write a reservation`);
  }
});

test("PICKING RESERVES NOTHING — a pick carries a Work Order id and still commits no stock", () => {
  // The standing invariant (Decision #116). putAwayCommand.test.mjs proves the no-ledger-write
  // half; this pins the specific trap — the field that makes a placement LOOK like a reservation.
  const putAway = src("inventoryLocation/putAwayCommand.ts");
  assert.match(putAway, /pickedForWorkOrderId/, "the pick field exists");
  assert.match(putAway, /IT STILL RESERVES NOTHING/i, "and the invariant is stated where it is defined");
  assert.ok(!code("inventoryLocation/putAwayCommand.ts").includes('"RESERVED"'));
  assert.ok(!code("inventoryLocation/putAwayCommand.ts").includes("inventory_transactions"));
});

// ════════════════════ 2. THE TWO AUTHORITIES ARE ASYMMETRIC ════════════════════

test("the SALES ORDER path nets BOTH authorities before allocating", () => {
  const alloc = code(ALLOCATE_SO);
  assert.match(alloc, /INVENTORY_TRANSACTIONS_COLLECTION/, "reads the ledger (physical + WO reservations)");
  assert.match(alloc, /SALES_ORDERS_COLLECTION/, "reads other Sales Orders' allocations");
  assert.match(alloc, /readOpenWoReserved/, "and subtracts open WO reservations by name");
});

test("the WORK ORDER path is BLIND to Sales Order allocations — the asymmetry, pinned", () => {
  // THIS IS THE FINDING. reserveParts() gates on getAvailableQuantity(), which reads
  // inventory_transactions and nothing else. A Sales Order can allocate units and a later,
  // unrelated Work Order dispatch can still reserve the same units, because the WO side never
  // looks at sales_orders. The reverse is not true.
  //
  // Recorded, NOT fixed: making the WO path read Sales Order allocations would change inventory
  // calculations and commitment semantics, which is an Owner decision, not a test's to make.
  // When it IS ruled, this test fails and forces the record forward.
  const service = code(INVENTORY_SERVICE);
  assert.ok(!service.includes("sales_orders"), "inventoryService must not (yet) read sales_orders");
  assert.ok(!service.includes("SALES_ORDERS_COLLECTION"), "…by constant either");
  assert.ok(!service.includes("allocatedQty"), "…and knows nothing of allocation quantities");
  // And it genuinely does gate on its own availability, so the blindness is load-bearing rather
  // than incidental — this is the function a dispatch is refused by.
  assert.match(service, /getAvailableQuantity/, "reserveParts gates on its own availability figure");
  assert.match(service, /Insufficient stock/, "and refuses when short");
});

test("the two paths also disagree about WHAT IS ON HAND", () => {
  // A second, quieter divergence. The Sales Order path counts ledger movements at ACTIVE
  // WAREHOUSES only. The Work Order path sums the ledger across ALL locations and adds a STATIC
  // catalogue baseline (partsCatalog.ts warehouseQty) that the catalogue's own header calls
  // "METADATA ONLY -- NO STOCK AUTHORITY". Both are recorded; neither is changed here.
  const service = code(INVENTORY_SERVICE);
  assert.match(service, /warehouseQty/, "the WO path still uses the static baseline");
  assert.match(service, /getCatalogItem/, "sourced from the static catalogue");
  const alloc = code(ALLOCATE_SO);
  assert.ok(!alloc.includes("getCatalogItem"), "the SO path uses the ledger only");
  assert.match(alloc, /eligibleWarehouseIds/, "and restricts to eligible warehouses");
  // The static catalogue says of itself that it is not stock authority.
  assert.match(src("data/partsCatalog.ts"), /NO STOCK AUTHORITY/i);
});

// ════════════════════ 3. THE PURE SEMANTICS, WHERE THEY ARE GOVERNED ════════════════════

test("open WO commitment = RESERVED − RELEASED − CONSUMED, floored at 0", () => {
  const rows = [
    { type: "RESERVED", quantity: 10, workOrderId: "wo1" },
    { type: "RELEASED", quantity: 3, workOrderId: "wo1" },
    { type: "CONSUMED", quantity: 5, workOrderId: "wo1" },
  ];
  assert.equal(openWorkOrderReserved(rows, new Set()), 2);
  // Over-release cannot manufacture negative commitment (which would inflate availability).
  assert.equal(openWorkOrderReserved([{ type: "RELEASED", quantity: 9, workOrderId: "wo1" }], new Set()), 0);
  // Lineage exclusion: a WO counted through its Sales Order is not counted twice.
  assert.equal(openWorkOrderReserved(rows, new Set(["wo1"])), 0);
});

test("UNKNOWN on-hand is never treated as zero — demand cannot be promised against absent evidence", () => {
  assert.equal(sumLedgerEligibleOnHand([], new Set(["wh1"])), null, "no evidence ⇒ UNKNOWN, not 0");
  // UNKNOWN is a KIND, not a quantity: there is deliberately no number to read off it, so a
  // caller cannot accidentally treat "we don't know" as "none".
  for (const absent of [null, undefined]) {
    const unknown = computePartAvailability({ onHandEligible: absent, openWoReserved: 0, otherSoAllocated: 0 });
    assert.equal(unknown.kind, "UNKNOWN");
    assert.equal(unknown.quantity, undefined, "UNKNOWN carries no quantity at all");
  }
  // A known zero is a different fact from unknown — a real empty shelf, not missing evidence.
  const emptyShelf = computePartAvailability({ onHandEligible: 0, openWoReserved: 0, otherSoAllocated: 0 });
  assert.deepEqual(emptyShelf, { kind: "KNOWN", quantity: 0 });
});

test("available-to-promise nets commitment from BOTH authorities and never goes negative", () => {
  // This is the ONE governed ATP derivation in the repository, and it is Sales-Order-side.
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 4, otherSoAllocated: 3 }),
    { kind: "KNOWN", quantity: 3 },
    "10 − 4 (WO commitment) − 3 (other SO commitment)",
  );
  // Self-allocation nets from the same pool, so re-running cannot double-commit.
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 4, otherSoAllocated: 3, selfAllocated: 2 }),
    { kind: "KNOWN", quantity: 1 },
  );
  // Already over-committed stock floors at zero rather than reporting a negative promise.
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 2, openWoReserved: 5, otherSoAllocated: 5 }),
    { kind: "KNOWN", quantity: 0 },
  );
});

// ════════════════════ 4. WHAT A DASHBOARD MAY NOT SAY ════════════════════

test("no client surface renders an inventory Committed / Reserved / ATP figure today", () => {
  // The reconciliation's dashboard conclusion, pinned so a KPI cannot appear without this failing.
  // Scoped to the inventory vocabulary: "committed" is legitimate elsewhere (committed PRICE on a
  // Sales Agreement, a committed scheduling window), so a bare word search would be noise.
  const KPI_PATTERNS = [/availableToPromise/, /"Committed"/, /Reserved to (WOs|SOs)/];
  const offenders = filesUnder("../../field-ops-app-vite/src", /\.(jsx?|tsx?)$/)
    .filter((p) => {
      const text = readFileSync(p, "utf8");
      return KPI_PATTERNS.some((re) => re.test(text));
    });
  assert.deepEqual(
    relativeTo(offenders, "/field-ops-app-vite/src/"),
    [],
    "an inventory commitment KPI appeared in the client — it must stay gated until commitment semantics are ruled",
  );
});

test("the governed part-balance read exposes reserved/available, and marks UNKNOWN as UNKNOWN", () => {
  // This IS the governed read a dashboard would compose — but it is capability-gated
  // (inventory.balance.read) and its client transport flag is off. Its honesty rules are the
  // reason it is the right seam: UNKNOWN is infectious rather than coerced to a confident number.
  const balance = src("inventory/partBalanceReadService.ts");
  assert.match(balance, /UNKNOWN IS A VALUE/i);
  assert.match(balance, /never coerced to 0/i);
  assert.match(balance, /openWorkOrderReserved/, "reserved comes from the ONE ratified derivation");
  assert.match(balance, /sumLedgerEligibleOnHand/, "on-hand likewise");
  assert.match(balance, /INVENTORY_BALANCE_READ_CAPABILITY/, "and it is capability-gated");
});
