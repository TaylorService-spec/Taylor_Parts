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
