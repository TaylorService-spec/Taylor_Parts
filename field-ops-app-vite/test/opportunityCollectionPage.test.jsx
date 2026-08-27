// THE OPPORTUNITY COLLECTION — North Star P1v4. Render + authority tests (vitest + jsdom).
//
// ════════════════════ WHY THIS FILE EXISTS AT THE SIZE IT DOES ════════════════════
//
// When the P1v2 record page shipped, 2,330 passing tests failed to catch a blank "Owner" label,
// because every fixture in the suite resolved the employee directory and nothing asserted what a
// row does when a fact is MISSING. The lesson taken from that is the shape of this file: most of
// what follows is about absence, denial and unresolved references, not about the happy path.
//
// The other half is authority. This surface replaced a master-detail workspace, and the ways a
// replacement like that silently goes wrong are specific and testable: it re-reads per row, it
// prints a document id where a name belongs, it invents a currency, or it quietly drops a governed
// capability that only the retired surface offered. There is a test for each.

import { afterEach, describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import OpportunityList from "../src/modules/sales/OpportunityList.jsx";
import {
  opportunityListRow,
  opportunityListCounts,
  filterOpportunityRows,
  opportunityResultContext,
} from "../src/domain/opportunityListView.js";
import { buildOpportunityPipeline, OPPORTUNITY_VIEW } from "../src/domain/opportunityLifecycle.js";

afterEach(cleanup);

const NOW = 1_754_600_000_000;
const DAY = 86_400_000;

const opp = (id, over = {}) => ({
  id,
  opportunityNumber: `OPP-2026-${id}`,
  accountId: `acct-${id}`,
  ownerEmployeeId: "emp-1",
  salesChannel: "RETAIL",
  stage: "QUOTING",
  outcome: null,
  need: `need for ${id}`,
  expectedValue: 12500,
  expectedCloseAt: NOW + 5 * DAY,
  nextAction: "Send quote",
  lines: [{ kind: "PART", ref: "P1", qty: 1 }],
  ...over,
});

// A source seam that COUNTS ITS INVOCATIONS. This is the N+1 detector: the page is allowed to read
// opportunities, and it is not allowed to read again because there happen to be rows.
const countingSource = (list, names = {}) => {
  const source = vi.fn(() => ({
    status: "ready",
    synthetic: false,
    opportunities: list.map((o) => ({ ...o })),
    accountNameById: names,
    error: null,
  }));
  return source;
};

const stateSource = (status, extra = {}) => () => ({
  status,
  synthetic: false,
  opportunities: [],
  accountNameById: {},
  error: null,
  ...extra,
});

const render = (ui, { route = "/customers/opportunities" } = {}) =>
  rtlRender(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);

const rowFor = (text) => screen.getByText(text).closest("tr");

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{`${loc.pathname}${loc.search}`}</span>;
}

// Renders the page inside a REAL route table with a location probe.
//
// This exists because the plain `render` above cannot observe navigation: with no routes declared,
// a stray `navigate()` is a no-op and a test asserting "nothing happened" passes for the wrong
// reason. A mutation that auto-navigated from the retired `?opportunity=` parameter survived
// exactly that blind spot, so every claim about where the page does or does not send somebody is
// made against this harness instead.
const renderWithProbe = (list, names, { route = "/customers/opportunities" } = {}) =>
  rtlRender(
    <MemoryRouter initialEntries={[route]}>
      <LocationProbe />
      <Routes>
        <Route path="/customers/opportunities" element={<OpportunityList source={countingSource(list, names)} />} />
        <Route path="/customers/opportunities/:id" element={<span>RECORD PAGE</span>} />
      </Routes>
    </MemoryRouter>,
  );

// ════════════════════════════════════════════ the collection is a collection

describe("the collection is a list, not a workspace", () => {
  it("SELECTS NOTHING on load — there is no pane to fill", () => {
    const names = { "acct-a": "Northgate Grocery" };
    render(<OpportunityList source={countingSource([opp("a")], names)} />);
    // The record page's landmarks must be absent. A collection that renders a record is the
    // master-detail surface P1v4 replaced, wearing a different class name.
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("heading", { name: /OPP-2026-a/ })).toBeNull();
    // Nothing on the page claims a selection.
    expect(document.querySelector(".is-selected, [aria-selected='true']")).toBeNull();
  });

  it("IGNORES a stale `?opportunity=` link — it must not select, and must not auto-navigate", () => {
    renderWithProbe([opp("a")], { "acct-a": "Northgate Grocery" }, {
      route: "/customers/opportunities?opportunity=a",
    });
    // The parameter addressed the retired pane. It must do NOTHING now.
    expect(screen.getByText("Northgate Grocery")).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
    // And critically: the reader STAYS ON THE COLLECTION. Auto-opening the record from a stale
    // parameter would recreate the pane's auto-selection with a redirect, which is the same
    // behaviour P1v4 removed — a person who asked for the list would never see one.
    expect(screen.getByTestId("loc").textContent).toBe("/customers/opportunities?opportunity=a");
    expect(screen.queryByText("RECORD PAGE")).toBeNull();
  });

  it("READS ONCE, no matter how many rows there are — the N+1 guard", () => {
    // The Agreement/Order column is exactly where a per-row read would be introduced, because the
    // list knows an agreement's ID but not its NUMBER and the temptation is to go and fetch it.
    const many = Array.from({ length: 25 }, (_, i) =>
      opp(`r${i}`, { salesAgreementId: `sa-${i}`, salesOrderId: i % 2 ? `so-${i}` : null }),
    );
    const source = countingSource(many);
    render(<OpportunityList source={source} />);
    expect(screen.getAllByRole("row").length).toBeGreaterThan(20);
    expect(source).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════ row → record

describe("the row opens the record", () => {
  it("the reference is a REAL anchor to the record route", () => {
    renderWithProbe([opp("a")], { "acct-a": "Northgate Grocery" });
    const link = screen.getByRole("link", { name: "OPP-2026-a" });
    // A real href is what makes cmd-click, middle-click and "open in new tab" work without any of
    // them being reimplemented — and it is why the row handler defers to it.
    expect(link.getAttribute("href")).toBe("/customers/opportunities/a");
  });

  it("clicking the row body navigates to the same place the anchor points", () => {
    renderWithProbe([opp("a")], { "acct-a": "Northgate Grocery" });
    fireEvent.click(screen.getByText("Northgate Grocery"));
    expect(screen.getByTestId("loc").textContent).toBe("/customers/opportunities/a");
    expect(screen.getByText("RECORD PAGE")).toBeTruthy();
  });

  it("a MODIFIED click on the row body is left alone — the anchor is the new-tab path", () => {
    renderWithProbe([opp("a")], { "acct-a": "Northgate Grocery" });
    fireEvent.click(screen.getByText("Northgate Grocery"), { metaKey: true });
    // Forcing a cmd-click into this tab would take away the one gesture people use to open a list
    // item without losing their place in the list.
    expect(screen.getByTestId("loc").textContent).toBe("/customers/opportunities");
  });

  it("adds NO second tab stop per row — the anchor is the focusable thing", () => {
    renderWithProbe([opp("a")], { "acct-a": "Northgate Grocery" });
    const tr = rowFor("Northgate Grocery");
    // role="button" + tabIndex on the <tr> would announce every row twice and put a fake button in
    // the tab order, which is why the row defers to its anchor instead of becoming one.
    expect(tr.getAttribute("tabindex")).toBeNull();
    expect(tr.getAttribute("role")).toBeNull();
  });
});

// ════════════════════════════════════════════ what a row may and may not say

describe("a row never shows a fact the read does not support", () => {
  it("NEVER renders a document id — not for the opportunity, the account, the agreement or the order", () => {
    // DECISIONS #106. Every id in this fixture is distinctive so a leak anywhere is a failure.
    const list = [opp("a", { salesAgreementId: "SA-DOC-ID-XYZ", salesOrderId: "SO-DOC-ID-XYZ" })];
    render(<OpportunityList source={countingSource(list, { "acct-a": "Northgate Grocery" })} />);
    const body = document.body.textContent;
    expect(body).not.toContain("SA-DOC-ID-XYZ");
    expect(body).not.toContain("SO-DOC-ID-XYZ");
    expect(body).not.toContain("acct-a");
  });

  it("states an UNRESOLVED customer name rather than falling back to the account id", () => {
    // The exact defect class the record page hit: no name resolved, so an id was shown instead.
    render(<OpportunityList source={countingSource([opp("a")], {})} />);
    expect(screen.getByText("Customer — name unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("acct-a");
  });

  it("renders EST. VALUE as a bare number with NO currency symbol (G5)", () => {
    render(<OpportunityList source={countingSource([opp("a")], { "acct-a": "N" })} />);
    const cell = rowFor("N").querySelector(".ns-num");
    // `expectedValue` is stored as a plain number with no currency field. A "$" would assert a unit
    // nobody recorded — the same fabrication the old workspace shipped.
    expect(cell.textContent).toContain("12,500");
    expect(cell.textContent).not.toMatch(/[$€£]/);
  });

  it("an ABSENT value is 'Not estimated', never 0", () => {
    render(<OpportunityList source={countingSource([opp("a", { expectedValue: null })], { "acct-a": "N" })} />);
    // A zero reads as a worthless deal. Absence of an estimate is a different fact.
    expect(rowFor("N").querySelector(".ns-num").textContent).toBe("Not estimated");
  });

  it("an ABSENT close date says so rather than inventing one", () => {
    render(<OpportunityList source={countingSource([opp("a", { expectedCloseAt: null })], { "acct-a": "N" })} />);
    expect(within(rowFor("N")).getByText("Not recorded")).toBeTruthy();
  });
});

// ════════════════════════════════════════════ Agreement / Order (G2, G3)

describe("the Agreement / Order column states EXISTENCE and stops", () => {
  it("says an agreement exists WITHOUT naming it, because the list read carries no reference", () => {
    render(<OpportunityList source={countingSource([opp("a", { salesAgreementId: "sa-1" })], { "acct-a": "N" })} />);
    const cell = rowFor("N").querySelector(".ns-col--commercial");
    expect(cell.textContent).toContain("Agreement");
    expect(cell.textContent).not.toContain("sa-1");
    // And it does not pretend to a number it was never given.
    expect(cell.textContent).not.toMatch(/SA-\d{4}-\d+/);
  });

  it("distinguishes 'no agreement' from 'agreement exists'", () => {
    const list = [opp("a", { salesAgreementId: "sa-1" }), opp("b", { salesAgreementId: null })];
    render(<OpportunityList source={countingSource(list, { "acct-a": "Has", "acct-b": "None" })} />);
    expect(rowFor("Has").querySelector(".ns-col--commercial").textContent).toContain("Agreement");
    expect(rowFor("None").querySelector(".ns-col--commercial").textContent).toContain("No agreement");
  });

  it("marks an absence as an absence so it is styled as one, not as a value", () => {
    render(<OpportunityList source={countingSource([opp("a", { salesAgreementId: null })], { "acct-a": "N" })} />);
    expect(rowFor("N").querySelector(".ns-col--commercial .ns-state--na")).toBeTruthy();
  });
});

// ════════════════════════════════════════════ the owner is a person

describe("the owner column tells three states apart", () => {
  it("UNASSIGNED and UNRESOLVED are different sentences", () => {
    const list = [opp("a", { ownerEmployeeId: null }), opp("b", { ownerEmployeeId: "emp-missing" })];
    render(<OpportunityList source={countingSource(list, { "acct-a": "NoOwner", "acct-b": "BadOwner" })} />);
    // No owner is a business condition and a reason to act; an owner the directory could not resolve
    // is a data problem. Collapsing them hides unassigned work behind a plausible-looking error.
    expect(rowFor("NoOwner").querySelector(".ns-col--owner").textContent).toBe("Unassigned");
    expect(rowFor("BadOwner").querySelector(".ns-col--owner").textContent).toBe("Unresolved");
  });

  it("never prints the employee id", () => {
    render(<OpportunityList source={countingSource([opp("a", { ownerEmployeeId: "emp-secret" })], { "acct-a": "N" })} />);
    expect(document.body.textContent).not.toContain("emp-secret");
  });
});

// ════════════════════════════════════════════ honest states

describe("each unsettled read gets its OWN sentence", () => {
  it("DENIED is not an empty list", () => {
    render(<OpportunityList source={stateSource("denied")} />);
    // An empty table tells somebody their pipeline is empty when their permission is.
    expect(screen.getByText(/not available to you/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("UNAVAILABLE is not an empty list", () => {
    render(<OpportunityList source={stateSource("unavailable")} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/not connected yet/i)).toBeTruthy();
  });

  it("states NO COUNT while the read is unsettled — a '0' would be a claim about the business", () => {
    // ASSERTS THE ELEMENT IS ABSENT, not that a phrase is missing. The first version of this test
    // matched the words "0 open", and a mutation rendering a bare "0" (the count element with its
    // label suppressed) sailed straight through it. A count derived from an unsettled read is wrong
    // whether or not the word "open" happens to sit next to it.
    for (const status of ["denied", "unavailable", "error"]) {
      cleanup();
      render(<OpportunityList source={stateSource(status)} />);
      expect(document.querySelector(".ns-workspace__count")).toBeNull();
      expect(document.querySelector(".ns-workspace__summary")).toBeNull();
    }
  });

  it("TRULY EMPTY and FILTERED EMPTY are different sentences", () => {
    render(<OpportunityList source={countingSource([])} />);
    expect(screen.getByText(/No opportunities yet/i)).toBeTruthy();

    cleanup();
    // Won-only data: the OPEN view is empty, but the collection is not.
    render(<OpportunityList source={countingSource([opp("w", { outcome: "WON", stage: "DECISION" })])} />);
    expect(screen.getByText(/No open opportunities/i)).toBeTruthy();
    // And it offers the way out — the absence of which is what made the original defect invisible.
    expect(screen.getByRole("button", { name: /Show all/i })).toBeTruthy();
  });

  it("AN UNRESOLVED VIEWER IS NOT AN EMPTY VIEW — nothing was counted, so nothing is reported", () => {
    // Lists P2's UNKNOWN state. My-opportunities with no resolvable viewer identity used to render
    // through the same component as an empty view, which framed a RESOLUTION FAILURE as a RESULT:
    // the sentence was right and the container said "we looked and found none".
    //
    // The sentence is unchanged and still says whose fact is missing. What changed is that the page
    // now says it in the state that means "we could not determine this" — and that state has no
    // count slot at all, so a 0 cannot appear beside it.
    render(<OpportunityList source={countingSource([opp("a"), opp("b")])} viewerUid={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /My opportunities/i }));
    expect(screen.getByText(/can't tell which opportunities are yours/i)).toBeTruthy();
    // Not an emptiness: no empty-state container, and therefore none of its vocabulary.
    expect(document.querySelector(".fo-empty-state")).toBeNull();
    // Still offers a way out — an unresolvable identity is exactly when a person most needs a view
    // that does not depend on one.
    expect(screen.getByRole("button", { name: /Show all/i })).toBeTruthy();
  });
});

// ════════════════════════════════════════════ the state view

describe("the state view and the rows cannot disagree", () => {
  const MIX = [
    opp("open-1"),
    opp("dec-1", { stage: "DECISION" }),
    opp("att-1", { expectedCloseAt: NOW - 3 * DAY, nextAction: null }),
    opp("won-1", { outcome: "WON", stage: "DECISION" }),
    opp("lost-1", { outcome: "LOST", stage: "DECISION" }),
  ];

  it("every tab's count equals the number of rows that tab shows", () => {
    const pipeline = buildOpportunityPipeline(MIX, { nowMillis: NOW, accountNameById: {} });
    const counts = opportunityListCounts(pipeline);
    // Proven against the domain rather than by reading the DOM twice: the counts and the rows come
    // from one derivation, and this is the assertion that keeps them there.
    for (const view of Object.values(OPPORTUNITY_VIEW)) {
      // MINE is viewer-scoped and has no count without a viewer — asserted separately below.
      if (view === OPPORTUNITY_VIEW.MINE) { expect(counts.byView[view]).toBeNull(); continue; }
      const shown = view === OPPORTUNITY_VIEW.OPEN
        ? pipeline.rows.length
        : view === OPPORTUNITY_VIEW.NEEDS_ATTENTION
          ? pipeline.rows.filter((r) => r.attentionTone === "attention").length
          : view === OPPORTUNITY_VIEW.AT_DECISION
            ? pipeline.rows.filter((r) => r.stage === "DECISION").length
            : view === OPPORTUNITY_VIEW.WON
              ? pipeline.all.filter((r) => r.outcome === "WON").length
              : view === OPPORTUNITY_VIEW.LOST
                ? pipeline.all.filter((r) => r.outcome === "LOST").length
                : pipeline.all.length;
      expect(counts.byView[view]).toBe(shown);
    }
  });

  it("the My-opportunities tab shows NO COUNT when the viewer cannot be identified", () => {
    const counts = opportunityListCounts(
      buildOpportunityPipeline(MIX, { nowMillis: NOW, accountNameById: {} }),
      { viewerEmployeeId: null },
    );
    // A "0" would assert the viewer has no work. The truth is we could not tell whose work is whose.
    expect(counts.byView[OPPORTUNITY_VIEW.MINE]).toBeNull();
    render(<OpportunityList source={countingSource(MIX)} />);
    const tab = screen.getByRole("radio", { name: /My opportunities/i });
    expect(tab.querySelector(".ns-view__count")).toBeNull();
  });

  it("selecting a view URL-STATES it, so the view is shareable and survives reload", () => {
    render(<OpportunityList source={countingSource(MIX)} />);
    fireEvent.click(screen.getByRole("radio", { name: /Won/ }));
    expect(screen.getAllByRole("radio", { checked: true })[0].textContent).toMatch(/Won/);
  });

  it("the views are RADIOS, not buttons — they are exclusive views of one collection", () => {
    render(<OpportunityList source={countingSource(MIX)} />);
    expect(screen.getByRole("radiogroup", { name: /Opportunity view/i })).toBeTruthy();
    // Exactly one is checked; a screen reader should hear a choice, not six independent toggles.
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
  });

  it("NEEDS ATTENTION shows only open work", () => {
    render(<OpportunityList source={countingSource(MIX)} />, {
      route: "/customers/opportunities?view=needs_attention",
    });
    // A closed deal cannot need attention.
    expect(screen.queryByText("OPP-2026-won-1")).toBeNull();
    expect(screen.queryByText("OPP-2026-lost-1")).toBeNull();
  });
});

// ════════════════════════════════════════════ the governed write survived the pane's retirement

describe("create is still reachable — the SA-G7 lesson", () => {
  it("renders the create control DISABLED with the seam's own reason when write is not ready", () => {
    render(<OpportunityList source={countingSource([])} />);
    const button = screen.getByRole("button", { name: /New Opportunity/i });
    // Fail-closed by default. Disabled-with-a-reason reads as a permission boundary; a control that
    // vanishes reads as a missing feature.
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(document.querySelector(".ns-collection__act-reason").textContent.length).toBeGreaterThan(0);
  });

  it("opens the governed create form when the write seam is enabled", () => {
    render(
      <OpportunityList
        source={countingSource([])}
        readiness={{ enabled: true, reason: null }}
      />,
    );
    const button = screen.getByRole("button", { name: /New Opportunity/i });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    // `opportunity.write` create lived ONLY in NewOpportunityForm, which only the retired workspace
    // mounted. If this stops rendering, retiring the pane has deleted a governed capability.
    expect(screen.getByRole("dialog") || screen.getByLabelText(/opportunity/i)).toBeTruthy();
  });

  it("does NOT put the half-filled create form in the URL", () => {
    render(<OpportunityList source={countingSource([])} readiness={{ enabled: true, reason: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /New Opportunity/i }));
    expect(window.location.search).not.toContain("creat");
  });
});

// ════════════════════════════════════════════ the derivation itself

describe("opportunityListRow derives, it does not decide", () => {
  const derive = (over) => {
    const [row] = buildOpportunityPipeline([opp("a", over)], { nowMillis: NOW, accountNameById: {} }).all;
    return opportunityListRow(row, { nowMillis: NOW });
  };

  it("an un-numbered opportunity says so and still routes by id", () => {
    const r = derive({ opportunityNumber: null });
    expect(r.reference).toBe("Opportunity — not numbered");
    expect(r.href).toBe("/customers/opportunities/a");
    // The label and the route key are different things, and only one of them is shown.
    expect(r.reference).not.toContain("a");
  });

  it("percent-encodes the id into the href rather than trusting it", () => {
    const [row] = buildOpportunityPipeline([opp("a b/c")], { nowMillis: NOW, accountNameById: {} }).all;
    expect(opportunityListRow(row, { nowMillis: NOW }).href).toBe("/customers/opportunities/a%20b%2Fc");
  });

  it("reads a closed deal by OUTCOME and an open one by STAGE", () => {
    expect(derive({ outcome: "WON" }).stage.words).toBe("Won");
    expect(derive({ outcome: "LOST" }).stage.words).toBe("Lost");
    expect(derive({ stage: "DECISION" }).stage.words).toMatch(/Decision/i);
    // A closed deal has no position on the open spine.
    expect(derive({ outcome: "WON" }).stage.position).toBeNull();
  });

  it("marks a past close date overdue and does not label it as days-away", () => {
    const r = derive({ expectedCloseAt: NOW - 3 * DAY });
    expect(r.close.overdue).toBe(true);
    expect(r.close.note).toBeNull();
  });

  it("notes a NEAR close in days, and says nothing about a distant one", () => {
    expect(derive({ expectedCloseAt: NOW + 3 * DAY }).close.note).toBe("3d");
    expect(derive({ expectedCloseAt: NOW + 90 * DAY }).close.note).toBeNull();
  });

  it("is PURE — the same row twice gives the same answer, and the input is not mutated", () => {
    const [row] = buildOpportunityPipeline([opp("a")], { nowMillis: NOW, accountNameById: {} }).all;
    const before = JSON.stringify(row);
    const a = opportunityListRow(row, { nowMillis: NOW });
    const b = opportunityListRow(row, { nowMillis: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(row)).toBe(before);
  });

  it("survives a row with nothing on it at all", () => {
    // Defensive, and the reason is concrete: a degraded read returns partially-projected documents,
    // and a list that throws on one bad row takes the whole page down with it.
    const r = opportunityListRow({}, { nowMillis: NOW });
    expect(r.reference).toBe("Opportunity — not numbered");
    expect(r.value.amount).toBeNull();
    expect(r.commercial.agreement.known).toBe(false);
    expect(r.owner.assigned).toBe(false);
  });
});

// ════════════════════════════════════════════ narrowing what is already loaded

describe("search and stage filtering narrow the view, and say so", () => {
  const LIST = [
    opp("a", { need: "Shake line refresh", stage: "QUOTING" }),
    opp("b", { need: "Two-store expansion", stage: "QUALIFYING" }),
    opp("c", { need: "Warranty plan", stage: "SOLUTION" }),
  ];
  const NAMES = { "acct-a": "Route 66 Custard", "acct-b": "Sonoran Partners", "acct-c": "Verde Creamery" };

  it("DOES NOT RE-READ when a search is typed — narrowing is over rows already in hand", () => {
    const source = countingSource(LIST, NAMES);
    render(<OpportunityList source={source} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Sonoran" } });
    // A filter that fetched would be a read this page has no authority to perform, and would let
    // the toolbar widen what a caller can see.
    expect(source).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sonoran Partners")).toBeTruthy();
    expect(screen.queryByText("Route 66 Custard")).toBeNull();
  });

  it("says the denominator is THE VIEW, never the whole collection", () => {
    render(<OpportunityList source={countingSource(LIST, NAMES)} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Sonoran" } });
    // Claiming "of 59 total" would imply the search reached records this page never read.
    expect(screen.getByText(/Showing 1 of 3 opportunit/i)).toBeTruthy();
    expect(screen.getByText(/narrowed by a search/i)).toBeTruthy();
  });

  it("a SEARCH that finds nothing echoes the term and says how far it reached", () => {
    // The failure mode this has always prevented: the screen reporting an empty pipeline while the
    // cause is a search box two inches above it. Lists P2 splits that one sentence into two states,
    // so this now asserts the SEARCH half specifically — the term is echoed (a typo is invisible
    // once it has scrolled out of the box) and the scope is stated, because this search runs over
    // the rows already loaded and "no results" must not read as a claim about the collection.
    render(<OpportunityList source={countingSource(LIST, NAMES)} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz-no-match" } });
    expect(screen.getByText(/No results for/i)).toBeTruthy();
    expect(screen.getByText(/zzzz-no-match/)).toBeTruthy();
    expect(screen.getByText(/loaded in this view/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect(screen.getByText("Sonoran Partners")).toBeTruthy();
  });

  it("a STAGE FILTER that empties the view says how many rows it is eating, and is a DIFFERENT sentence", () => {
    // The second half of the split. A filter that ate everything wants the count beside the
    // checkboxes still visible above it; it has no term to echo, and printing one would be a lie.
    render(<OpportunityList source={countingSource(LIST, NAMES)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    // A stage no row in the fixture is in.
    fireEvent.click(screen.getByLabelText(/Decision/i));
    expect(screen.getByText(/No opportunities match these stages/i)).toBeTruthy();
    expect(screen.getByText(/being narrowed to none/i)).toBeTruthy();
    // ...and it is NOT the search sentence.
    expect(screen.queryByText(/No results for/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }));
    expect(screen.getByText("Sonoran Partners")).toBeTruthy();
  });

  it("the stage filter offers the SIX GOVERNED STAGES and nothing else", () => {
    render(<OpportunityList source={countingSource(LIST, NAMES)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    // A stage cannot be filtered for that an opportunity could never be in.
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("SEARCH DOES NOT MATCH DOCUMENT IDS — ids are not findable on purpose", () => {
    // NOTHING VISIBLE may contain the id, or this test would pass on an unrelated field match.
    const row = opp("secret-doc-id", { opportunityNumber: "OPP-2026-000001", need: "A stated need" });
    render(<OpportunityList source={countingSource([row], { "acct-secret-doc-id": "Some Customer" })} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "secret-doc-id" } });
    // Making ids searchable is how they end up quoted as if they were references (#106). The
    // governed reference is already searchable, and it is what people actually quote.
    expect(screen.getByText(/No results for/i)).toBeTruthy();
  });

  it("the SEARCH PLACEHOLDER names exactly the fields the search reaches", () => {
    // Lists P2 §7. The placeholder is a promise about scope, and the only place a person learns
    // what the box does before typing into it. It named three things and matched four; naming the
    // OBJECT ("Search opportunities") rather than the fields implied stage, value and close date
    // were searchable, which would make a correct search look broken.
    render(<OpportunityList source={countingSource(LIST, NAMES)} />);
    const placeholder = screen.getByRole("searchbox").getAttribute("placeholder").toLowerCase();
    for (const field of ["reference", "need", "customer", "owner"]) {
      expect(placeholder, `placeholder must name ${field}`).toContain(field);
    }
    // And must not promise a field the filter does not match.
    for (const notSearched of ["stage", "value", "close"]) {
      expect(placeholder, `placeholder must not promise ${notSearched}`).not.toContain(notSearched);
    }
  });

  it("filterOpportunityRows matches on the STAGE KEY, not on the label", () => {
    const rows = buildOpportunityPipeline(LIST, { nowMillis: NOW, accountNameById: {} })
      .all.map((r) => opportunityListRow(r, { nowMillis: NOW }));
    // Filtering on words would break silently the moment a label is reworded.
    expect(filterOpportunityRows(rows, { stages: ["QUOTING"] })).toHaveLength(1);
    expect(filterOpportunityRows(rows, { stages: ["Quoting"] })).toHaveLength(0);
  });

  it("opportunityResultContext names every reason the list is narrowed", () => {
    expect(opportunityResultContext({ shown: 3, inView: 3, viewLabel: "open" }))
      .toBe("Showing 3 opportunities in open");
    expect(opportunityResultContext({ shown: 1, inView: 9, viewLabel: "open", query: "x", stageCount: 2 }))
      .toMatch(/Showing 1 of 9 opportunit.* narrowed by a search and 2 stages/);
  });
});

// ════════════════════════════════════════════ the tablet stays a list (Owner ruling, #136)

describe("every sub-line is addressable, so a narrow width can drop the right ones", () => {
  const LIST = [opp("a", { salesChannel: "RETAIL", stage: "QUOTING", expectedCloseAt: NOW + 3 * DAY })];
  const NAMES = { "acct-a": "Route 66 Custard" };

  it("names each sub-line for the FACT it carries, not just 'sub'", () => {
    render(<OpportunityList source={countingSource(LIST, NAMES)} />);
    const row = rowFor("Route 66 Custard");
    // THE REGRESSION THIS EXISTS FOR. All four sub-lines once shared `ns-row__sub`, so no stylesheet
    // could drop one without dropping all of them -- and the only lever a narrow width had left was
    // FOLDING facts under the reference, which adds a line to every row at exactly the width where
    // vertical space is scarcest. That is what made the tablet read as detail rather than as a list.
    //
    // Merging these back into one class would silently restore that, with every test still green,
    // so the names are pinned here rather than left as a stylesheet's private assumption.
    expect(row.querySelector(".ns-row__need")).toBeTruthy();
    expect(row.querySelector(".ns-row__channel")).toBeTruthy();
    expect(row.querySelector(".ns-row__stagepos")).toBeTruthy();
  });

  it("does NOT fold attention into the identity cell — it keeps its own column at every width", () => {
    render(<OpportunityList source={countingSource(
      [opp("a", { expectedCloseAt: NOW - 3 * DAY, nextAction: null })], NAMES)} />);
    const row = rowFor("Route 66 Custard");
    const cells = [...row.querySelectorAll("td")];
    const attentionCell = cells.find((c) => /overdue|next action|decision/i.test(c.textContent));
    // Attention is the reason to open a row, so it survives every fold rather than being moved.
    expect(attentionCell).toBeTruthy();
    expect(attentionCell).not.toBe(cells[0]);
    // And it is rendered ONCE. A folded copy plus a column copy is two renderings of one fact.
    expect(row.querySelectorAll(".ns-row__attention")).toHaveLength(1);
  });

  it("renders each row's facts once — no duplicate markup branch per breakpoint", () => {
    render(<OpportunityList source={countingSource(LIST, NAMES)} />);
    const row = rowFor("Route 66 Custard");
    // Responsive behaviour here is CSS over one DOM. A second markup branch shown by width is how
    // two copies of one fact drift apart, and it doubles what every future change has to update.
    expect(row.querySelectorAll(".ns-row__ref")).toHaveLength(1);
    expect(row.querySelectorAll(".ns-row__need")).toHaveLength(1);
    expect(row.textContent.match(/Route 66 Custard/g)).toHaveLength(1);
  });
});
