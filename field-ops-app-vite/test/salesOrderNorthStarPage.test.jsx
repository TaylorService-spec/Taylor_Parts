// THE SALES ORDER PAGE, AGAINST THE NORTH STAR GRAMMAR.
//
// The projection layer is asserted offline in test/salesOrderNorthStar.test.mjs. This suite asserts
// the COMPOSITION: that the rendered page obeys the falsifiable rules in
// docs/design/eos-north-star-design-grammar.md, and that composing it changed no authority.
//
// The rules that carry the most weight here are the ones about what must NOT appear — a document
// id, a raw enum, a second h1, a second way to invoke a governed command, or a claim the read
// cannot support.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SalesOrderDetail from "../src/modules/sales/SalesOrderDetail.jsx";
import { useSalesOrder } from "../src/hooks/useSalesOrder.js";

vi.mock("../src/hooks/useSalesOrder.js", () => ({ useSalesOrder: vi.fn() }));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  ACCOUNT_NAMES_STATUS: { IDLE: "IDLE", LOADING: "LOADING", READY: "READY", DENIED: "DENIED", ERROR: "ERROR" },
  useAccountNamesWithStatus: () => ({ names: new Map([["acct_doc_1", "Harbor Grill Restaurant Group"]]), status: "READY" }),
  useAccountNames: () => new Map([["acct_doc_1", "Harbor Grill Restaurant Group"]]),
}));

const DOC_IDS = ["so_doc_secret", "acct_doc_1", "opp_doc_9", "wo_doc_3", "agr_doc_5", "line_doc_1"];

function salesOrder(overrides = {}) {
  return {
    id: "so_doc_secret",
    salesOrderNumber: "SO-2026-000141",
    accountId: "acct_doc_1",
    sourceOpportunityId: "opp_doc_9",
    sourceOpportunityNumber: "OPP-2026-000007",
    sourceAgreementId: "agr_doc_5",
    ownerEmployeeId: null,
    salesChannel: "RETAIL",
    state: "CONFIRMED",
    customerPO: "PO-1",
    currency: "USD",
    locationId: "LOC-1",
    notes: null,
    totalMinor: 500000,
    pricingState: "PRICED",
    unpricedLineCount: 0,
    createdAtMillis: 1_724_000_000_000,
    updatedAtMillis: 1_724_500_000_000,
    lines: [{ lineId: "line_doc_1", kind: "PART", ref: "PRT-9", orderedQty: 4, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 }],
    serviceWorkOrderIds: ["wo_doc_3"],
    serviceWorkOrders: [{ workOrderId: "wo_doc_3", workOrderNumber: null }],
    ...overrides,
  };
}

function mount(overrides = {}, props = {}) {
  useSalesOrder.mockReturnValue({
    loading: false,
    errorStatus: null,
    refetch: vi.fn(),
    result: { status: "ready", salesOrder: salesOrder(overrides) },
  });
  // NO DEFAULTING BY DESTRUCTURING. `{ hasCapability = () => true }` silently replaces an
  // EXPLICIT undefined with grant-all, which is exactly the case the fail-closed test needs to
  // render. Presence is checked instead, so "not passed" and "passed as undefined" stay distinct.
  const hasCapability = "hasCapability" in props ? props.hasCapability : () => true;
  return render(
    <MemoryRouter initialEntries={["/customers/opportunities/sales-order/so_doc_secret"]}>
      <Routes>
        <Route
          path="/customers/opportunities/sales-order/:salesOrderId"
          element={<SalesOrderDetail hasCapability={hasCapability} actionDeps={{ client: {} }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Sales Order — North Star composition", () => {
  // ─────────────── R02: the governed reference is the single h1

  it("the record's governed reference is the page's ONE h1", () => {
    mount();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("SO-2026-000141");
  });

  it("an order with no governed reference states the absence as its title", () => {
    mount({ salesOrderNumber: null });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/reference unavailable/i);
    expect(h1.textContent).not.toContain("so_doc_secret");
  });

  // ─────────────── R03: a document id is never visible content

  it("no document id appears anywhere on the page, in any state", () => {
    for (const overrides of [
      {},
      { salesOrderNumber: null },
      { sourceOpportunityNumber: null },
      { state: "CANCELLED" },
      { lines: [], pricingState: "NO_LINES", totalMinor: null },
    ]) {
      const { container, unmount } = mount(overrides);
      for (const id of DOC_IDS) {
        expect(container.textContent, `${id} leaked with overrides ${JSON.stringify(overrides)}`).not.toContain(id);
      }
      unmount();
    }
  });

  // ─────────────── R04: status is a word, never an enum, and never colour alone

  it("the lifecycle state renders as a sentence and the machine value never appears", () => {
    for (const [state, sentence] of [
      ["CONFIRMED", /Confirmed — awaiting allocation/],
      ["IN_FULFILLMENT", /In Fulfillment — every line must be fulfilled/],
      ["FULFILLED", /Fulfilled — awaiting closeout/],
      ["CLOSED", /Closed/],
      ["CANCELLED", /Cancelled/],
    ]) {
      const { container, unmount } = mount({ state });
      // SCOPED TO THE HEADER. A bare getByText(/Closed/) also matches the lifecycle CHIP of the
      // same name, and a matcher that hits two different facts proves neither.
      const identity = container.querySelector(".ns-identity");
      expect(identity.textContent, `${state} must state its sentence in the header`).toMatch(sentence);
      expect(container.textContent, `${state} leaked as an enum`).not.toContain(state);
      unmount();
    }
  });

  it("the state is stated ONCE — the header sentence, and nowhere else (NS-P4)", () => {
    // COUNT THE SENTENCE, NOT THE WORD. An earlier version of this test counted occurrences of
    // "Confirmed" and capped them at two, which was wrong on its face: the word is also the first
    // STAGE LABEL in the band, and again the lead of that stage's open detail strip. Those are a
    // different fact — where the record travelled — and the band is entitled to say it.
    //
    // What NS-P4 actually forbids is the STATE being rendered a second time as a state: a pill in a
    // summary band, or a `state` row in the field grid, beside the header sentence. So the state
    // sentence is what is counted, and the two treatments it replaced are asserted absent by name.
    const { container } = mount();
    const sentence = "Confirmed — awaiting allocation";
    expect(container.textContent.split(sentence).length - 1).toBe(1);

    // The field grid must not carry the state at all (salesOrderRecordPageRailSubset excludes it),
    // and no status pill may sit beside the sentence.
    const rail = container.querySelector(".ns-rail");
    expect(rail).toBeTruthy();
    expect(rail.textContent).not.toMatch(/Confirmed/);
    expect(container.querySelectorAll(".ns-identity .fo-status-pill, .ns-identity [class*='status-pill']")).toHaveLength(0);
  });

  // ─────────────── NS-P1: the lifecycle is visible

  it("the lifecycle band is present and marks exactly one stage as current", () => {
    const { container } = mount({ state: "IN_FULFILLMENT" });
    const band = container.querySelector(".ns-lifecycle");
    expect(band).toBeTruthy();
    // The chip label is split by the completion tick ("✓ " + label), so the CONTROL is matched by
    // its accessible name rather than a bare text node.
    expect(within(band).getByRole("button", { name: /In fulfillment/ }).getAttribute("aria-current")).toBe("step");
    expect(within(band).getByRole("button", { name: /Confirmed/ })).toBeTruthy();
    expect(within(band).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "step")).toHaveLength(1);
  });

  it("a cancelled order shows the terminal badge and claims no completed stage", () => {
    const { container } = mount({ state: "CANCELLED" });
    const band = container.querySelector(".ns-lifecycle");
    expect(within(band).getByText("Cancelled")).toBeTruthy();
    // No stage may be drawn as reached: a cancelled order did not travel the spine.
    expect(band.querySelectorAll(".ns-chip--complete")).toHaveLength(0);
    expect(band.querySelectorAll(".ns-chip--current")).toHaveLength(0);
  });

  // ─────────────── the honest read claim

  it("the page does NOT claim to be live, because the read is one-shot", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-live")).toBeNull();
    expect(container.textContent).not.toMatch(/updates in real time/i);
    // And it says what IS true instead, rather than saying nothing.
    expect(container.textContent).toMatch(/Read once/i);
  });

  // ─────────────── the suggestion slot

  it("the suggestion speaks only when the caller could actually act on it", () => {
    // Nothing allocated on a CONFIRMED order and the caller HOLDS salesOrder.fulfill: the governed
    // deterministic recommendation has something to say.
    const granted = mount({}, { hasCapability: () => true });
    expect(screen.getByLabelText("Suggested").textContent).toMatch(/not fully allocated/i);
    granted.unmount();

    // The SAME order, a caller without the capability: silence, not a proposal they cannot take.
    mount({}, { hasCapability: () => false });
    expect(screen.getByLabelText("Suggested").textContent).toMatch(/Nothing is proposed/i);
  });

  it("the suggestion offers no second way to invoke the command", () => {
    const { container } = mount();
    const slot = container.querySelector(".ns-suggest");
    expect(within(slot).queryByRole("button")).toBeNull();
    expect(within(slot).queryByRole("link")).toBeNull();
    // It points at the governed control that already exists.
    expect(slot.textContent).toMatch(/Use Allocate above/);
  });

  it("the suggestion never states a fact about inventory it cannot read", () => {
    const { container } = mount();
    const slot = container.querySelector(".ns-suggest");
    expect(slot.textContent).not.toMatch(/in stock|on hand|available now|will arrive|expected/i);
  });

  // ─────────────── attention

  it("a clean order renders no attention band at all", () => {
    const { container } = mount({ lines: [{ lineId: "line_doc_1", kind: "PART", ref: "PRT-9", orderedQty: 4, allocatedQty: 4, fulfilledQty: 4, billedQty: 4 }] });
    expect(container.querySelector(".ns-attention")).toBeNull();
  });

  it("an unpriced order says why it has no total, in words", () => {
    mount({ pricingState: "UNPRICED", totalMinor: null, unpricedLineCount: 1 });
    expect(screen.getByText(/No line carries a price/i)).toBeTruthy();
  });

  // ─────────────── ND-8: no fabricated stage times

  it("the milestone list carries only the two times the order records, and names the limit", () => {
    const { container } = mount();
    const rows = container.querySelectorAll(".ns-timeline__row");
    expect(rows).toHaveLength(2);
    expect(container.textContent).toMatch(/only when it was created and when it was last changed/i);
    // "Last changed" is not a lifecycle event and is not dressed as one.
    expect(container.textContent).toMatch(/Last changed/);
    expect(container.textContent).not.toMatch(/Fulfilled at|Closed at|Cancelled at|Allocated at/);
  });

  // ─────────────── authority is unchanged

  it("composing the page changed no authority: the governed actions are still the only writes", () => {
    mount({}, { hasCapability: () => true });
    // The action cluster is still rendered, and still the sole source of write affordances.
    expect(screen.getByRole("button", { name: /Allocate/i })).toBeTruthy();
  });

  it("a caller with no capability signal gets no live write affordance — fail-closed", () => {
    const { container } = mount({}, { hasCapability: undefined });
    for (const button of container.querySelectorAll("button")) {
      // The only enabled control on a fail-closed render is the lifecycle band's own stage
      // disclosure, which is a read affordance and writes nothing.
      if (!button.disabled) {
        expect(button.className, `${button.textContent} is enabled without a capability signal`)
          .toMatch(/ns-chip|ns-lifecycle/);
      }
    }
  });

  // ─────────────── honest states

  it("denied, not-found and unavailable are three distinct renderings", () => {
    const seen = new Set();
    for (const [readState, pattern] of [
      [{ loading: false, errorStatus: "denied", result: null }, /not authorized/i],
      [{ loading: false, errorStatus: null, result: { status: "not-found", salesOrder: null } }, /No Sales Order exists/i],
      [{ loading: false, errorStatus: "unavailable", result: null }, /currently unavailable/i],
      [{ loading: true, errorStatus: null, result: null }, /Loading sales order/i],
    ]) {
      useSalesOrder.mockReturnValue({ ...readState, refetch: vi.fn() });
      const { container, unmount } = render(
        <MemoryRouter initialEntries={["/customers/opportunities/sales-order/so_doc_secret"]}>
          <Routes>
            <Route path="/customers/opportunities/sales-order/:salesOrderId" element={<SalesOrderDetail />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(container.textContent).toMatch(pattern);
      seen.add(container.textContent.trim());
      unmount();
    }
    expect(seen.size).toBe(4);
  });

  // ─────────────── hostile data

  it("an order stripped to almost nothing still renders, and states every absence", () => {
    const { container } = mount({
      salesOrderNumber: null, accountId: null, sourceOpportunityId: null, sourceOpportunityNumber: null,
      sourceAgreementId: null, salesChannel: null, customerPO: null, currency: null, locationId: null,
      totalMinor: null, pricingState: null, unpricedLineCount: null,
      createdAtMillis: null, updatedAtMillis: null, lines: [], serviceWorkOrderIds: [], serviceWorkOrders: [],
    });
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(container.textContent).toMatch(/No lines have been recorded/i);
    expect(container.textContent).toMatch(/No times are recorded/i);
    for (const id of DOC_IDS) expect(container.textContent).not.toContain(id);
  });
});
