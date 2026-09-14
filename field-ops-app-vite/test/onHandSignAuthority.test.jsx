// CLIENT PART-LEVEL ON-HAND -- the sign rule must come from the ONE authority, not a sixth copy.
//
// THE DEFECT THIS PINS. computeAvailableStockByPart carried its OWN sign branches:
//
//     RECEIVED / TRANSFER_IN  +qty      TRANSFER_OUT  -qty      ADJUSTED  +qty (signed)
//
// That is the same rule functions/src/inventoryLedger/locationOnHand.ts holds -- restated. The
// server file exists precisely because FIVE such copies had already drifted: when Decision #171
// made WORK_ORDER_CONSUMPTION physical, only one of the five learned about it and the rest kept
// counting consumed stock as present. This was the sixth copy, and it had drifted the same way:
// RETURNED, SCRAPPED, RELOCATION_IN, RELOCATION_OUT and WORK_ORDER_CONSUMPTION were all missing,
// so a part fitted to a machine, scrapped, or returned still read as available on three surfaces
// (Inventory Health, Part Detail, Warehouse Manager Home).
//
// It also added a STATIC catalog baseline (data/partsCatalog.ts warehouseQty, 200 synthetic rows)
// on top of real ledger movement -- the exact thing DECISIONS #165 removed server-side, ruling
// that a fixture quantity may not decide a real figure.
//
// These assertions are PURE. No emulator, no Firestore, no network.
//
// Run: npx vitest run test/onHandSignAuthority.test.jsx
import { describe, it, expect } from "vitest";
import { computeAvailableStockByPart, normalizeLedgerTransaction } from "../src/domain/inventoryAnalyticsEngine";
// The authority itself, imported so this file compares against the REAL rule rather than a
// restatement of it. If the two ever disagree these tests fail, which is the whole point.
import { MOVEMENT_SIGN, signedQuantity } from "../../functions/src/inventoryLedger/locationOnHand";

let seq = 0;
const tx = (partId, type, quantity, extra = {}) => ({
  id: `t${(seq += 1)}`, workOrderId: "", partId, type, quantity, timestamp: seq, ...extra,
});
const GOV = "PRT-9001";        // no static catalog row
const CATALOGUED = "TST-1003"; // HAS a static catalog row (warehouseQty 20)

describe("the client on-hand derivation routes through the ONE sign authority", () => {
  it("every physical movement type the authority names contributes with the authority's sign", () => {
    // The defect, stated as a loop rather than a list: for each governed type, one unit at the
    // authority's sign must be what the client figure moves by. The five types the client copy
    // never learned are exactly the ones that fail here.
    for (const type of Object.keys(MOVEMENT_SIGN)) {
      const qty = MOVEMENT_SIGN[type] === "SIGNED" ? -2 : 3;
      const moved = computeAvailableStockByPart([tx(GOV, "RECEIVED", 100), tx(GOV, type, qty)]).get(GOV)
        - computeAvailableStockByPart([tx(GOV, "RECEIVED", 100)]).get(GOV);
      expect({ type, moved }).toEqual({ type, moved: signedQuantity({ type, quantity: qty }) });
    }
  });

  it("a part consumed by a Work Order stops reading as available", () => {
    // Decision #171. The consequence that made the server unify the rule in the first place.
    expect(computeAvailableStockByPart([tx(GOV, "RECEIVED", 5), tx(GOV, "WORK_ORDER_CONSUMPTION", -3)]).get(GOV)).toBe(2);
  });

  it("a scrapped part stops reading as available", () => {
    expect(computeAvailableStockByPart([tx(GOV, "RECEIVED", 5), tx(GOV, "SCRAPPED", 2)]).get(GOV)).toBe(3);
  });

  it("a customer return adds stock back", () => {
    expect(computeAvailableStockByPart([tx(GOV, "RECEIVED", 5), tx(GOV, "RETURNED", 2)]).get(GOV)).toBe(7);
  });

  it("an in-warehouse relocation pair neither creates nor destroys stock", () => {
    const m = computeAvailableStockByPart([
      tx(GOV, "RECEIVED", 5), tx(GOV, "RELOCATION_OUT", 2), tx(GOV, "RELOCATION_IN", 2),
    ]);
    expect(m.get(GOV)).toBe(5);
  });

  it("a corrupt negative receipt cannot manufacture stock", () => {
    // signedQuantity's guard: an IN/OUT row is a positive magnitude by contract; a non-positive one
    // is malformed and contributes NOTHING. Taking its absolute value would invent 2 units here.
    expect(computeAvailableStockByPart([tx(GOV, "RECEIVED", 5), tx(GOV, "RECEIVED", -2)]).get(GOV)).toBe(5);
  });
});

describe("a fixture quantity does not decide a real figure (DECISIONS #165, client side)", () => {
  it("a catalogued part's on-hand is its ledger, not the synthetic catalog baseline", () => {
    // TST-1003 carries warehouseQty 20 in the static 200-row catalog. Two real receipts is two.
    expect(computeAvailableStockByPart([tx(CATALOGUED, "RECEIVED", 1), tx(CATALOGUED, "RECEIVED", 1)]).get(CATALOGUED)).toBe(2);
  });

  it("a catalogued part and a governed part with identical ledgers read identically", () => {
    const rows = (p) => [tx(p, "RECEIVED", 4), tx(p, "ADJUSTED", -1)];
    const a = computeAvailableStockByPart(rows(CATALOGUED)).get(CATALOGUED);
    const b = computeAvailableStockByPart(rows(GOV)).get(GOV);
    expect(a).toBe(b);
  });
});

describe("the legacy Work-Order reservation vocabulary is unchanged", () => {
  it("RESERVED and RELEASED still net against availability", () => {
    expect(computeAvailableStockByPart([tx(GOV, "RECEIVED", 10), tx(GOV, "RESERVED", 3), tx(GOV, "RELEASED", 1)]).get(GOV)).toBe(8);
  });

  it("legacy CONSUMED is not a physical movement and is not double-counted", () => {
    // The location-less WO CONSUMED is a commitment event. WORK_ORDER_CONSUMPTION is the physical
    // one. Collapsing the two would subtract the same fact twice.
    expect(signedQuantity({ type: "CONSUMED", quantity: 2 })).toBe(0);
    expect(computeAvailableStockByPart([tx(GOV, "RECEIVED", 5), tx(GOV, "CONSUMED", 2)]).get(GOV)).toBe(5);
  });

  it("a part with no ledger activity is not fabricated into existence", () => {
    expect(computeAvailableStockByPart([tx(GOV, "RECEIVED", 1)]).has("PRT-DOES-NOT-EXIST")).toBe(false);
  });
});

// =================================================================================================
// OPERATING COMPANY SCOPE -- fail-closed, and an OPEN OWNER QUESTION.
//
// OWNER QUESTION (P2-J-Q1). `operatingCompanyId` is one of {taylor, ventana} and is NEVER inferred.
// The ledger rows carry it (operationalMovementRepository.ts accepts and shape-checks it; the
// 2026-08-30 ownership backfill wrote it), and the client read already loads the whole document --
// but normalizeLedgerTransaction dropped the field, so NO client on-hand figure could filter by
// company even in principle. Ventana truck stock therefore appears inside Taylor's "Available"
// column on all three surfaces.
//
// What is NOT settled, and what this lane deliberately did not decide: which company each of those
// three surfaces should be scoped to, and what a surface should show when the viewer's company
// cannot be resolved. Deciding it inside a derivation would be inventing custody.
//
// WHAT WAS IMPLEMENTED PENDING THE RULING -- the conservative reading:
//   - the field is carried through normalization instead of discarded, so the question is now
//     answerable at all;
//   - a STATED scope is fail-closed: only rows carrying that exact governed company id count. An
//     unattributed row is never absorbed into the company being asked about;
//   - a scope that is stated but not governed THROWS rather than widening back to everything;
//   - omitting the scope is the estate-wide reading -- unchanged behaviour for today's two call
//     sites, but now a declared argument rather than an unexamined default.
// The call sites are deliberately NOT rewired. Choosing a company for a live surface is the ruling.
// =================================================================================================
describe("operating-company scope is fail-closed and never inferred", () => {
  const taylorRow = (type, qty) => tx(GOV, type, qty, { operatingCompanyId: "taylor" });
  const ventanaRow = (type, qty) => tx(GOV, type, qty, { operatingCompanyId: "ventana" });

  it("Ventana stock does not appear in Taylor's number", () => {
    const rows = [taylorRow("RECEIVED", 4), ventanaRow("RECEIVED", 9)];
    expect(computeAvailableStockByPart(rows, { operatingCompanyId: "taylor" }).get(GOV)).toBe(4);
    expect(computeAvailableStockByPart(rows, { operatingCompanyId: "ventana" }).get(GOV)).toBe(9);
  });

  it("an unattributed row is excluded from a scoped figure, not absorbed into it", () => {
    // The whole point of "never inferred": a row written before the ownership backfill belongs to
    // nobody until somebody says so. Counting it as Taylor's would be a silent widening.
    const rows = [taylorRow("RECEIVED", 4), tx(GOV, "RECEIVED", 100)];
    expect(computeAvailableStockByPart(rows, { operatingCompanyId: "taylor" }).get(GOV)).toBe(4);
  });

  it("a malformed company id is refused rather than widened back to everything", () => {
    // Shape, not membership -- operatingCompanyAuthority.js is explicit that a shape-valid id which
    // is not one of the two seeded records is well-formed-but-UNKNOWN, not malformed, so that a
    // company can be added later without a schema change. Only a non-shape value is a caller error.
    expect(() => computeAvailableStockByPart([taylorRow("RECEIVED", 1)], { operatingCompanyId: "" })).toThrow();
    expect(() => computeAvailableStockByPart([taylorRow("RECEIVED", 1)], { operatingCompanyId: "TAYLOR" })).toThrow();
  });

  it("an unrecognised but well-formed company shows NOTHING rather than everything", () => {
    // Fail-closed by construction: no row carries it, so no row counts. The dangerous alternative
    // is a scope that matches nothing quietly falling back to the estate-wide total.
    const m = computeAvailableStockByPart([taylorRow("RECEIVED", 4), ventanaRow("RECEIVED", 9)], { operatingCompanyId: "acme" });
    expect(m.has(GOV)).toBe(false);
  });

  it("commitment events are scoped by their Work Order, not deleted by a company filter", () => {
    // RESERVED/RELEASED/CONSUMED carry no location and no company. A company filter that dropped
    // them would report gross stock as available for whichever company was asked about.
    const rows = [taylorRow("RECEIVED", 10), tx(GOV, "RESERVED", 3)];
    expect(computeAvailableStockByPart(rows, { operatingCompanyId: "taylor" }).get(GOV)).toBe(7);
  });

  it("omitting the scope is the estate-wide reading today's callers already get", () => {
    const rows = [taylorRow("RECEIVED", 4), ventanaRow("RECEIVED", 9)];
    expect(computeAvailableStockByPart(rows).get(GOV)).toBe(13);
  });

  it("normalization carries a well-formed company through and drops a malformed one", () => {
    // A future seeded company read by an older client must survive the boundary -- the authority is
    // explicit that UNKNOWN must never be collapsed into INVALID, because discarding a legitimate
    // governed value is how a row silently becomes unattributed.
    const raw = (over) => ({ id: "d1", workOrderId: "", partId: GOV, type: "RECEIVED", quantity: 1, timestamp: 1, ...over });
    expect(normalizeLedgerTransaction(raw({ operatingCompanyId: "taylor" })).operatingCompanyId).toBe("taylor");
    expect(normalizeLedgerTransaction(raw({ operatingCompanyId: "acme" })).operatingCompanyId).toBe("acme");
    expect(normalizeLedgerTransaction(raw({ operatingCompanyId: "TAYLOR" })).operatingCompanyId).toBeUndefined();
    expect(normalizeLedgerTransaction(raw({ operatingCompanyId: 7 })).operatingCompanyId).toBeUndefined();
    expect(normalizeLedgerTransaction(raw({})).operatingCompanyId).toBeUndefined();
  });
});
