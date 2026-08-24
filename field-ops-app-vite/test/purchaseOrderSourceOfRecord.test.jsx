// PURCHASE ORDERS: WHICH COLLECTION IS THE PURCHASE ORDER?
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md, "UX core object migrations" §14–§20.
//
// The direction was to move the modern Purchase Order UX onto `purchase_orders`, keeping
// `reorder_purchase_orders` as compatibility. The blocker is not architectural preference — it is a
// count. Measured read-only against eos-platform-sandbox on 2026-08-24:
//
//     purchase_orders          0 documents,  0 live composite indexes
//     reorder_purchase_orders  3 documents,  0 live composite indexes   (2 ORDERED, 1 VOIDED)
//
// Every Purchase Order this business has is in the collection that stores no money. The collection
// that stores `totalCost` has never been written to. Switching the screen today would replace a
// working three-row list with an empty one, and the Dollars column it was switched for would have
// no rows to appear on.
//
// These tests pin the facts that decision rests on, so the next reader does not have to re-derive
// them — and so the day procurement starts writing canonical Purchase Orders, the assertion that
// says "no Dollars column" is the one that fails and asks to be revisited.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { purchaseOrderEntity, purchaseOrderIndexList } from "../src/metadata/definitions/purchaseOrder.js";
import declaredIndexes from "../../firestore.indexes.json" with { type: "json" };

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

// ═════════════════════════════════════════ two collections, one name

describe("the two collections that both answer to Purchase Order", () => {
  it("the client and the backend define the SAME constant name as DIFFERENT collections", () => {
    // This is the whole trap, and it is not a typo — each is right for its own side.
    expect(read("src/domain/constants.js"))
      .toMatch(/PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders"/);
    expect(read("../functions/src/constants/collections.ts"))
      .toMatch(/PURCHASE_ORDERS_COLLECTION = "purchase_orders"/);
  });

  it("the reachable screen reads the collection with no money in it", () => {
    expect(purchaseOrderEntity.collection).toBe("reorder_purchase_orders");
    expect(purchaseOrderEntity.fields.some((f) => /price|amount|total|cost/i.test(f.id))).toBe(false);
  });

  it("totalCost is written by procurement into the OTHER collection", () => {
    const procurement = read("../functions/src/types/procurement.ts");
    expect(procurement).toMatch(/totalCost: number/);
  });
});

// ═════════════════════════════════════════ no Dollars, and why

describe("Dollars", () => {
  it("no Dollars column is declared, because no row could carry an authoritative one", () => {
    // UNKNOWN is not $0.00. A zero would be a claim about a purchase; an absent column is a claim
    // about the record, and only the second one is true here.
    expect(purchaseOrderIndexList.columns.some((c) => /dollar|total|cost/i.test(c.fieldId))).toBe(false);
  });

  it("attaching the other collection's total to these rows is refused, in writing", () => {
    const gap = purchaseOrderEntity.gaps.find((g) => g.id === "PURCHASE_ORDER_MONEY_LIVES_ON_A_DIFFERENT_COLLECTION");
    expect(gap).toBeTruthy();
    // A real number belonging to a different record is worse than no number: it is genuine, and
    // it is somebody else's.
    expect(gap.refused).toMatch(/dormant collection|deriving a total/i);
  });

  it("the emptiness of the canonical collection is recorded as a measurement", () => {
    const gap = purchaseOrderEntity.gaps.find((g) => g.id === "PURCHASE_ORDER_CANONICAL_COLLECTION_IS_EMPTY");
    expect(gap).toBeTruthy();
    expect(gap.finding).toMatch(/MEASURED/);
    expect(gap.finding).toMatch(/0 documents/);
  });
});

// ═════════════════════════════════════════ index honesty

describe("filters are not offered because nothing serves them", () => {
  const poIndexes = (collectionGroup) =>
    declaredIndexes.indexes.filter((i) => i.collectionGroup === collectionGroup);

  it("neither Purchase Order collection has a single declared composite", () => {
    expect(poIndexes("purchase_orders")).toEqual([]);
    expect(poIndexes("reorder_purchase_orders")).toEqual([]);
  });

  it("so the list declares ZERO filters, which is the honest number", () => {
    // Declaring Status or Vendor here would put a control on screen that errors at read time.
    expect(purchaseOrderIndexList.filters).toEqual([]);
  });

  it("status is a column whose stored value is immutable, and the definition says so", () => {
    const status = purchaseOrderEntity.fields.find((f) => f.id === "status");
    expect(status).toBeTruthy();
    // VOIDED and RECEIVED live on the LINKED reorder request, never on this document. A plain
    // metadata list rendering this ENUM would read "Ordered" on every row forever — including the
    // rows that are voided.
    expect(status.filterable).not.toBe(true);
  });
});

// ═════════════════════════════════════════ the surface stays a lifecycle composite

describe("the reachable screen is a join, not a document list", () => {
  const SCREEN = read("src/modules/purchasing/PurchaseOrders.jsx");

  it("it is driven by reorder requests and joined to purchase orders by id", () => {
    expect(SCREEN).toMatch(/useReorderRequestsByStatuses/);
    expect(SCREEN).toMatch(/usePurchaseOrdersByIds/);
  });

  it("the ORPHAN integrity state exists only because of that join", () => {
    // An ORDERED request whose PO document could not be read has NO row in either collection to
    // list. A list driven off one collection cannot produce it, and "Needs attention" would
    // vanish silently along with it.
    expect(read("src/domain/purchaseOrdersView.js")).toMatch(/ORPHAN/);
  });

  it("the buyer and business line stay absent rather than invented", () => {
    const ids = purchaseOrderEntity.gaps.map((g) => g.id);
    expect(ids).toContain("PURCHASE_ORDER_BUYER_NOT_AUTHORITATIVE");
    expect(ids).toContain("PURCHASE_ORDER_BUSINESS_LINE_NOT_DERIVABLE");
  });
});
