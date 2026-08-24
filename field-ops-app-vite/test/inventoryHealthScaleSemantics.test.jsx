// INVENTORY HEALTH — what paging would cost, asserted rather than argued.
//
// GOVERNANCE: docs/architecture/partslist-inventory-health.md.
//
// This package set out to page `/inventory` and found three independent reasons it cannot be done
// today without changing what the screen MEANS. The reasons are structural, so they can be pinned as
// tests — and pinning them is the point: a blocker recorded only in prose is one somebody
// well-intentioned removes in six months by adding `limit()`.
//
// Each test below fails if the corresponding guarantee is quietly weakened.

import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { composeGovernedPartsWorkspace } from "../src/domain/partsCatalogView.js";
import {
  computeAvailableStockByPart,
  generateInventoryHealthDashboard,
  normalizeLedgerTransaction,
} from "../src/domain/inventoryAnalyticsEngine";
import { inventoryUrgencyLabel, INVENTORY_URGENCY_LABEL } from "../src/domain/inventoryUrgencyTone.js";


// Thin adapters so the assertions below read the same as every other node:test suite in this repo.
const expectEqual = (a, b, msg) => expect(a, msg).toBe(b);
const expectNotEqual = (a, b, msg) => expect(a, msg).not.toBe(b);
const expectDeep = (a, b, msg) => expect(a, msg).toEqual(b);
const expectMatch = (a, b, msg) => expect(a, msg).toMatch(b);
const expectOk = (a, msg) => expect(a, msg).toBeTruthy();

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

// ─────────────────────────────────────────────── 1. the reconciliation is whole-set

test("the catalogue is a RECONCILIATION whose invariant compares whole-set counts", () => {
  // composeGovernedPartsWorkspace asserts that every CANONICAL Part resolves to exactly one row,
  // by comparing counts across the entire canonical read against the entire static catalog. A page
  // of 50 makes canonicalCount 50, and the comparison then passes while proving nothing at all.
  const src = read("src/domain/partsCatalogView.js");
  expectMatch(src, /canonicalAccounted === ws\.totals\.canonicalCount/);
  expectMatch(src, /every CANONICAL Part\s*\n?\s*\/\/ is represented by exactly one row/);
});

test("an incomplete canonical read BLOCKS the catalogue rather than rendering a partial one", () => {
  // This is the behaviour paging would collide with: the composer's answer to "I only have some of
  // the Parts" is to show NOTHING, deliberately, rather than a subset that looks whole.
  for (const status of ["PERMISSION_DENIED", "UNAVAILABLE", "SOMETHING_ELSE"]) {
    const out = composeGovernedPartsWorkspace({
      canonicalRead: { status, rows: [] },
      staticCatalog: [{ sku: "TST-1", name: "T", category: "C", warehouseQty: 1 }],
    });
    expectEqual(out.ws, null, `${status} must block`);
    expectMatch(out.status, /^BLOCKED_/);
  }
});

test("a single invalid canonical document blocks the whole catalogue, and leaks nothing", () => {
  const out = composeGovernedPartsWorkspace({
    canonicalRead: { status: "OK", rows: [], invalid: [{ partId: "p1", secret: "raw-value" }] },
    staticCatalog: [{ sku: "TST-1", name: "T", category: "C", warehouseQty: 1 }],
  });
  expectEqual(out.status, "BLOCKED_INCOMPLETE_INPUT");
  expectEqual(out.meta.invalidCount, 1);
  // A count, never the documents themselves.
  expect(JSON.stringify(out.meta).includes("raw-value")).toBe(false);
});

// ─────────────────────────────────────────────── 2. health is the LEDGER's population

test("Inventory Health is computed over the LEDGER, not over the rendered page", () => {
  // The population is every partId the ledger has seen — derived from transactions, never from the
  // catalogue rows on screen. This is why "health of the first page" is not what the queue means,
  // and it is already structurally true rather than something this package had to build.
  const transactions = [
    { partId: "PRT-1", type: "RECEIVED", quantity: 10 },
    { partId: "PRT-2", type: "RECEIVED", quantity: 4 },
    { partId: "PRT-3", type: "RECEIVED", quantity: 1 },
  ].map(normalizeLedgerTransaction);

  const byPart = computeAvailableStockByPart(transactions);
  const snapshots = [...byPart.entries()].map(([partId, availableStock]) => ({ partId, availableStock }));
  const health = generateInventoryHealthDashboard(transactions, snapshots);

  // Three parts in the ledger produce three health entries, with no catalogue involved at all.
  expectEqual(health.length, 3);
  expectDeep(health.map((h) => h.partId).sort(), ["PRT-1", "PRT-2", "PRT-3"]);
});

test("netting a TRUNCATED ledger produces a number that is wrong, not partial", () => {
  // The reason the ledger read stays unbounded, demonstrated rather than asserted in prose.
  const full = [
    { partId: "PRT-1", type: "RECEIVED", quantity: 10 },
    { partId: "PRT-1", type: "RESERVED", quantity: 6 },
  ].map(normalizeLedgerTransaction);
  // The "page" that happened to contain only the receipt, not the reservation against it.
  const truncated = [full[0]];

  const nettedFull = computeAvailableStockByPart(full).get("PRT-1");
  const nettedTruncated = computeAvailableStockByPart(truncated).get("PRT-1");

  expectNotEqual(nettedFull, nettedTruncated);
  // And critically: the truncated figure is HIGHER. A capped ledger overstates availability, which
  // sends somebody to a shelf that is emptier than the screen claims.
  expectOk(nettedTruncated > nettedFull, "a truncated ledger overstates what is on hand");
});

test("the shared unbounded fetcher stays unbounded, and says why", () => {
  const src = read("src/services/operationsQueries.ts");
  // The rule this codebase already wrote down, kept as a test so it survives the next refactor.
  expectMatch(src, /is not "partial" -- it is WRONG, presented as complete/);
  // fetchInventoryTransactions must NOT quietly acquire a cap.
  expectMatch(src, /fetchInventoryTransactions = \(\) => listCollection</);
});

test("the ledger has NO total-order field spanning every document, so it cannot be cursor-paged", () => {
  // LEGACY documents carry `timestamp`, OPERATIONAL documents carry `recordedAt`, and no document
  // carries both. Firestore's orderBy silently EXCLUDES documents missing the ordered field, so any
  // cursor order over this collection deletes an entire era of live entries from the result with no
  // error — the same silent-exclusion failure the Customers list was already bitten by.
  const src = read("src/metadata/definitions/inventoryTransaction.js");
  expectMatch(src, /LEGACY documents carry `timestamp`, OPERATIONAL documents carry/);
  expectMatch(src, /orderBy silently excludes any\s*\n?\/\/ document missing the ordered field/i);
  // And no INDEX list view is declared for it, which is the decision that follows from that.
  const mod = read("src/metadata/definitions/inventoryTransaction.js");
  expect(/makeListViewDefinition\s*\(/.test(mod)).toBe(false);
});

// ─────────────────────────────────────────────── 3. existence is independent of any page

test("the catalogue read is WHOLE, so 'not on this page' can never mean 'does not exist'", () => {
  const src = read("src/services/partMasterQueries.js");
  // fetchPartMasterList takes no plan, no cursor and no page size. Paging is opted into by name via
  // partMasterPageQuery, and the consumers that must prove existence do not opt in.
  expectMatch(src, /export async function fetchPartMasterList\(\)/);
  expectMatch(src, /A scanner that cannot\s*\n?\s*\*? ?find part 51 reports the part does not exist/);
});

test("every existence-proving consumer still uses the WHOLE catalogue read", () => {
  // Scanner, receiving, the Work Order parts plan and the name resolver each have to be able to
  // find ANY part, not the ones a list happens to have fetched.
  for (const rel of [
    "src/modules/scan/LookupScan.jsx",
    "src/modules/receiving/ReceiveAgainstPurchaseOrder.jsx",
    "src/modules/workOrders/WorkOrderPartsPlanEditor.jsx",
    "src/hooks/useCanonicalPartNames.js",
    "src/modules/inventory/PartsList.jsx",
  ]) {
    const src = read(rel);
    expectMatch(src, /fetchPartMasterList/, `${rel} must read the whole catalogue`);
    expectEqual(
      /fetchPartMasterPage/.test(src), false,
      `${rel} must NOT page — a first page would make a real part look missing`,
    );
  }
});

// ─────────────────────────────────────────────── the deliverable half

test("urgency has ONE label authority, beside its tone map", () => {
  expectDeep(Object.keys(INVENTORY_URGENCY_LABEL), ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
  expectEqual(inventoryUrgencyLabel("CRITICAL"), "Critical");
  expectEqual(inventoryUrgencyLabel("critical"), "Critical");
  // An unrecognised level looks unfamiliar rather than invisible.
  expectEqual(inventoryUrgencyLabel("APOCALYPTIC"), "APOCALYPTIC");
  expectEqual(inventoryUrgencyLabel(null), null);
});

test("the Parts catalogue table recomposes into cards, with every cell labelled", () => {
  const src = read("src/modules/inventory/PartsList.jsx");
  expectMatch(src, /className="fo-table fo-table--stack"/);
  for (const label of ["Part", "Part Number", "Category", "Warehouse Available", "Inventory Health"]) {
    expectMatch(src, new RegExp(`data-label="${label}"`), `${label} cell must carry its heading`);
  }
});

test("an UNLEDGERED part has UNKNOWN availability — never a catalogue baseline, never zero", () => {
  // SUPERSEDES an earlier assertion in this file, deliberately rather than by deletion. That one
  // required the static catalogue quantity and its "(baseline)" caveat to be two elements rather
  // than one welded string. That was a real improvement and it stopped short of the actual problem:
  // the NUMBER. The Owner ruled on 2026-08-24 that the catalogue is not an availability authority,
  // so the requirement is now strictly stronger and subsumes the one it replaces.
  const src = read("src/modules/inventory/PartsList.jsx");

  // The original requirement, still held: no welded string.
  expect(/\$\{part\.warehouseQty\} \(baseline\)/.test(src)).toBe(false);
  // The new one: no catalogue quantity in the availability column at all.
  expect(/data-label="Warehouse Available"[^>]*part\.warehouseQty/.test(src)).toBe(false);

  // UNKNOWN travels as null, never as 0 — a formatter handed a zero would print one, and "nobody
  // has looked at this shelf" would become "this shelf is empty".
  expectMatch(src, /data-raw=\{health \? health\.stock\.availableStock : null\}/);
  expectMatch(src, /Not known/);
});

test("Inventory Health renders WORDS, never the stored urgency token", () => {
  const src = read("src/modules/inventory/PartsList.jsx");
  expectMatch(src, /label=\{inventoryUrgencyLabel\(urgency\)\}/);
  // The raw value stays reachable on the cell for a filter or a test, and off the screen.
  expectMatch(src, /data-raw=\{urgency \?\? \(health \? "NEEDS_PLANNING" : "NO_LEDGER_ACTIVITY"\)\}/);
  expect(/label=\{health\.recommendation\.urgency\}/.test(src)).toBe(false);
});

test("the three health outcomes stay three different statements", () => {
  const src = read("src/modules/inventory/PartsList.jsx");
  // Never seen by the ledger / seen but unplannable / computed urgency. Collapsing them loses the
  // distinction that decides what to do next.
  expectMatch(src, /No ledger activity/);
  expectMatch(src, /Needs planning/);
  expectMatch(src, /inventoryUrgencyTone\(urgency\)/);
});

test("a link inside a stacked card is a real tap target", () => {
  // FOUND BY MEASURING, not by reading. In card mode the part name IS the control that opens the
  // part, and at desk density it is a 19px line of text: "Compressor" measured 74x19 at 320px. The
  // row whose name wrapped to three lines cleared 44px by accident, so the targets that failed were
  // the SHORT names — which is most of them.
  const css = read("src/index.css");
  expectMatch(css, /\.fo-table--stack td a \{ display: inline-flex; align-items: center; min-height: 44px; \}/);
  // Scoped INSIDE the phone breakpoint: a 44px row height at a desk would wreck table density.
  // Line endings are normalized before slicing — this file is CRLF, and an offset search anchored on
  // "\n" silently found nothing rather than failing, which made the assertion pass on an empty
  // string once already.
  const lf = css.split("\r\n").join("\n");
  const start = lf.indexOf("@media (max-width: 640px) {\n  .fo-table--stack thead");
  expectOk(start >= 0, "the stack breakpoint block must be findable");
  const stackBlock = lf.slice(start, lf.indexOf("}", lf.indexOf(".fo-table--stack td a")) + 1);
  expectMatch(stackBlock, /\.fo-table--stack td a \{/);
});
