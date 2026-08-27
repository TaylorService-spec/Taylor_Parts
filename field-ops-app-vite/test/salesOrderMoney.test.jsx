// A SALES ORDER IS THE ENTRY POINT OF A SALE, SO IT CARRIES THE SALE'S MONEY.
//
// GOVERNANCE: Owner ruling, 2026-08-24.
//
// ============================ WHAT THIS CORRECTS ============================
//
// This programme previously recorded `SALES_ORDER_TOTAL_AUTHORITY_GAP`, which stated that a Sales
// Order "carries no authoritative money" and that deriving a total was refused because "INVOICE
// MONEY IS NOT SALES ORDER MONEY". That was drawn from a pilot trace and never checked against the
// billing engine, and it had it backwards:
//
//   functions/src/finance/invoiceCommands.ts snapshots each Sales Order line's `unitPrice` as
//   `unitPriceMinor` (integer minor units), REFUSES to bill a line that has none (UNPRICED), and
//   REFUSES any invoice price that disagrees with it (PRICE_MISMATCH).
//
// The invoice is DERIVED from the order's committed price and is forbidden from contradicting it.
// The order is the source. The money was in the database the whole time; the read projection simply
// never returned it, so no surface above it could show a Dollars column.
//
// ============================ WHAT THIS PROTECTS ============================
//
// The one genuine hazard, which is why the total is computed on the server rather than summed in a
// client: `unitPrice` is OPTIONAL per line, so an order can be PARTLY priced. Summing whatever
// happens to be priced yields a real number that is not the sale's total -- worse than showing
// nothing, because somebody would act on it. NULL IS NOT ZERO.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { salesOrderEntity, salesOrderIndexList, salesOrderRelatedList } from "../src/metadata/definitions/salesOrder.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const SERVICE = read("../functions/src/salesOrder/salesOrderReadService.ts");
const INVOICING = read("../functions/src/finance/invoiceCommands.ts");

// ═════════════════════════════════════════ the authority, in the billing engine

describe("the order's committed price is already authoritative", () => {
  it("invoicing refuses to bill a line with no committed price", () => {
    expect(INVOICING).toMatch(/UNPRICED/);
    expect(INVOICING).toMatch(/has no committed unit price/);
  });

  it("invoicing refuses any price that disagrees with the order", () => {
    expect(INVOICING).toMatch(/PRICE_MISMATCH/);
    expect(INVOICING).toMatch(/does not match the sales order's committed unit price/);
  });

  it("the invoice snapshots the order's unitPrice as integer minor units", () => {
    expect(INVOICING).toMatch(/unitPriceMinor: number; \/\/ committed SO unitPrice snapshot, integer minor units/);
  });
});

// ═════════════════════════════════════════ the projection returns it

describe("the read projection returns the money", () => {
  it("a line projects its committed price and its extended amount", () => {
    expect(SERVICE).toMatch(/unitPriceMinor: number \| null;/);
    expect(SERVICE).toMatch(/extendedMinor: number \| null;/);
  });

  it("the order projects a total, a pricing state, and an unpriced count", () => {
    expect(SERVICE).toMatch(/totalMinor: number \| null;/);
    expect(SERVICE).toMatch(/pricingState: SalesOrderPricingState;/);
    expect(SERVICE).toMatch(/unpricedLineCount: number;/);
  });

  it("the total is populated ONLY when every line is priced", () => {
    // The load-bearing line. A partial sum presented as a total is the failure this guards.
    expect(SERVICE).toMatch(/pricingState === "PRICED"\s*\n?\s*\?\s*lines\.reduce/);
    expect(SERVICE).toMatch(/:\s*null;/);
  });

  it("a malformed stored price is treated as absent, never coerced", () => {
    // A negative or fractional price is not a price this money model accepts. Coercing it would
    // produce a total from a number the system rejects everywhere else.
    expect(SERVICE).toMatch(/Number\.isInteger\(rawPrice\) && rawPrice >= 0 \? rawPrice : null/);
  });
});

// ═════════════════════════════════════════ the column

describe("the Dollars column", () => {
  it("is declared as minor-unit currency with a sibling currency field", () => {
    const total = salesOrderEntity.fields.find((f) => f.id === "totalMinor");
    expect(total, "Sales Order must declare the sale amount").toBeTruthy();
    expect(total.type).toBe("CURRENCY_MINOR");
    expect(total.label).toBe("Dollars");
    // The renderer reads `currency` from the ROW, so an amount never borrows a symbol its own
    // record does not carry.
    expect(salesOrderEntity.fields.some((f) => f.id === "currency")).toBe(true);
  });

  it("appears on the Sales Orders list AND on a customer's orders", () => {
    expect(salesOrderIndexList.columns.map((c) => c.fieldId)).toContain("totalMinor");
    expect(salesOrderRelatedList.columns.map((c) => c.fieldId)).toContain("totalMinor");
  });

  it("is NOT sortable, because the total is derived at read time", () => {
    // No stored order-level total exists for Firestore to order by. Sorting the PAGE and calling
    // it "by value" would sort fifty rows while labelling it as the list.
    for (const list of [salesOrderIndexList, salesOrderRelatedList]) {
      expect(list.columns.find((c) => c.fieldId === "totalMinor").sortable).not.toBe(true);
    }
  });
});

// ═════════════════════════════════════════ Lists P2 conformance (Phase 5)

describe("Lists P2 — the Sales Order collection", () => {
  const SCREEN = readFileSync(path.resolve(process.cwd(), "src/modules/sales/SalesOrdersList.jsx"), "utf8");
  // THE SOURCE WITH ITS COMMENTS REMOVED.
  //
  // Two assertions below are about strings that must NOT be in the code — and this file explains at
  // length why each was removed, quoting the string it is talking about. A bare text search over the
  // whole file matches the explanation and fails. That is the same measurement bug the migration
  // manifest was written to stop, arriving in a test: asserting on prose rather than on behaviour.
  // `[ \t]*` rather than `\s*`: `\s` includes the newline, so a greedy `^\s*//` swallows blank lines
  // and lands the match on a LATER comment, leaving the one on this line in place.
  const CODE = SCREEN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("wears the collection header, not the workspace shell", () => {
    expect(SCREEN).toMatch(/import WorkspaceIdentity from/);
    expect(SCREEN).not.toMatch(/^import WorkspaceShell from/m);
    expect(SCREEN).toMatch(/<WorkspaceIdentity/);
  });

  it("the row destination is READ FROM the definition, not merely claimed to be", () => {
    // The comment here already said "the destination the definition itself names ... so the row
    // target cannot drift from the declaration" while the code beneath it was a template literal.
    // They agreed by luck. A comment is not a mechanism.
    expect(SCREEN).toMatch(/buildRowHref\(salesOrderIndexList\.rowNavigationTo, id\)/);
    expect(SCREEN).not.toMatch(/navigate\(`\/customers\/opportunities\/sales-order\/\$\{id\}`\)/);
  });

  it("NO CREATE ACTION, because a Sales Order is not user-creatable", () => {
    // P2's third create treatment: absent, not disabled. Creation belongs to the atomic Won
    // transition on an Opportunity. A disabled button here would describe a permission boundary
    // when the truth is that the action lives on another object.
    expect(CODE).not.toMatch(/New sales order/i);
    expect(CODE).not.toMatch(/action=\{/);
    // ...and the REASON survives in the source, so the absence reads as a decision rather than as
    // something nobody got round to.
    expect(SCREEN).toMatch(/not user-creatable/);
  });

  it("the summary line is empty, because nothing here can be counted truthfully", () => {
    // No governed per-state aggregate and no attention projection. A workload line could only come
    // from the loaded page — the exact claim the Work Order status chips gave up.
    expect(SCREEN).toMatch(/summaryItems=\{\[\]\}/);
    expect(SCREEN).toMatch(/count=\{typeof total === "number" \? total : null\}/);
  });

  it("money still routes through the record page's OWN reading, unchanged", () => {
    // The migration must not grow a second opinion about the money of the sale.
    expect(SCREEN).toMatch(/resolveMoneyCell/);
    expect(SCREEN).toMatch(/salesOrderDollars/);
    expect(SCREEN).toMatch(/salesOrderDisplayCurrency/);
  });

  it("the stale comment that DENIED the money column is gone", () => {
    // It read "NO DOLLARS COLUMN ... the Sales Order document stores no total of any kind" over a
    // screen that renders totalMinor through salesOrderDollars. A comment describing the opposite
    // of the code is worse than none: the next reader trusts it and does not check.
    expect(CODE).not.toMatch(/NO DOLLARS COLUMN/);
    // ...and the explanation of its removal IS still present, so the record of the wrong call
    // survives the correction.
    expect(SCREEN).toMatch(/USED TO DENY IT/);
  });

  it("DEGRADED tells a withheld customer name apart from a failed one", () => {
    expect(SCREEN).toMatch(/ACCOUNT_NAMES_STATUS\.DENIED/);
    expect(SCREEN).toMatch(/ACCOUNT_NAMES_STATUS\.ERROR/);
    expect(SCREEN).toMatch(/degraded && presentation\?\.state === "READY"/);
  });

  it("the ONE index-backed filter is still the only one offered", () => {
    // sales_orders(state, salesOrderNumber DESC) is the only live composite. A shared grammar is
    // where a filter menu grows options no index can serve.
    expect(salesOrderIndexList.filters.map((f) => f.fieldId)).toEqual(["state"]);
  });
});
