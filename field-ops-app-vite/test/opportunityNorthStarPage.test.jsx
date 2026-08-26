// THE OPPORTUNITY PAGE, AGAINST THE NORTH STAR GRAMMAR.
//
// The derivation layer is asserted offline in test/opportunityNorthStar.test.mjs. This suite
// asserts the COMPOSITION: that the rendered page obeys the falsifiable rules in
// docs/design/eos-north-star-design-grammar.md, and that building it changed no authority.
//
// The rules carrying the most weight are the ones about what must NOT appear — a document id, a
// raw enum, a second h1, a second lifecycle progression, a second way to invoke a governed
// command, or a control that is live when the write seam is closed.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OpportunityDetail from "../src/modules/sales/OpportunityDetail.jsx";
import { useOpportunity } from "../src/hooks/useOpportunity.js";

vi.mock("../src/hooks/useOpportunity.js", () => ({ useOpportunity: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    loading: false,
    byEmployeeId: new Map([["EMP-3", { displayName: "Dana Whitfield" }]]),
  }),
}));

const DOC_IDS = ["opp_doc_secret", "acct_doc_1", "so_doc_9", "agr_doc_5"];
// RELATIVE TO THE REAL CLOCK, deliberately. The page reads `Date.now()` and injects it into the
// derivation — "the expected close date has passed" is a comparison against now, and a page that
// held a frozen clock would be wrong by one day tomorrow. So the FIXTURE moves instead: a deal
// closing in 30 days is clean and one that closed yesterday is overdue, whenever this suite runs.
// The derivation itself is asserted against a FIXED clock offline, in opportunityNorthStar.test.mjs.
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function projection(overrides = {}) {
  return {
    id: "opp_doc_secret",
    opportunityNumber: "OPP-2026-000007",
    name: null,
    accountId: "acct_doc_1",
    salesChannel: "NATIONAL_ACCOUNTS",
    ownerEmployeeId: "EMP-3",
    stage: "QUOTING",
    outcome: null,
    need: "Two reach-in freezers for the new prep line.",
    expectedValue: 56000,
    expectedCloseAt: NOW + 30 * DAY,
    nextAction: "Send the revised quote.",
    lines: [{ kind: "PART", ref: "PRT-9", qty: 2 }],
    salesOrderId: null,
    salesAgreementId: null,
    createdAtMillis: NOW - 60 * DAY,
    updatedAtMillis: NOW - DAY,
    closedAtMillis: null,
    ...overrides,
  };
}

// NO DEFAULTING BY DESTRUCTURING for the write seam. `{ readiness = open }` would silently replace
// an EXPLICIT undefined with a live one, which is exactly the case the fail-closed test needs to
// render. Presence is checked instead, so "not passed" and "passed as undefined" stay distinct.
function mount(overrides = {}, props = {}, envelope = {}) {
  useOpportunity.mockReturnValue({
    loading: false,
    errorStatus: null,
    refetch: vi.fn(),
    result: {
      status: "ready",
      opportunity: projection(overrides),
      accountName: "Harbor Grill Restaurant Group",
      salesOrderNumber: null,
      ...envelope,
    },
  });
  const readiness = "readiness" in props ? props.readiness : { enabled: true, reason: null };
  return render(
    <MemoryRouter initialEntries={["/customers/opportunities/opp_doc_secret"]}>
      <Routes>
        <Route
          path="/customers/opportunities/:opportunityId"
          element={<OpportunityDetail readiness={readiness} actionDeps={{ client: {} }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function mountState(state) {
  useOpportunity.mockReturnValue({ ...state, refetch: vi.fn() });
  return render(
    <MemoryRouter initialEntries={["/customers/opportunities/opp_doc_secret"]}>
      <Routes>
        <Route path="/customers/opportunities/:opportunityId" element={<OpportunityDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Opportunity — North Star composition", () => {
  // ─────────────── R02: the governed reference is the single h1

  it("the record's governed reference is the page's ONE h1", () => {
    mount();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("OPP-2026-000007");
  });

  it("an opportunity with no governed reference states the absence as its title", () => {
    mount({ opportunityNumber: null });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/reference unavailable/i);
    expect(h1.textContent).not.toContain("opp_doc_secret");
  });

  // ─────────────── R03: a document id is never visible content

  it("no document id appears anywhere on the page, in any state", () => {
    for (const [overrides, envelope] of [
      [{}, {}],
      [{ opportunityNumber: null }, {}],
      [{ salesOrderId: "so_doc_9", salesAgreementId: "agr_doc_5" }, { salesOrderNumber: null }],
      [{ salesOrderId: "so_doc_9" }, { salesOrderNumber: "SO-2026-000141" }],
      [{ stage: "DECISION", outcome: "WON", closedAtMillis: NOW }, {}],
      [{ lines: [] }, {}],
      [{}, { accountName: null }],
    ]) {
      const { container, unmount } = mount(overrides, {}, envelope);
      for (const id of DOC_IDS) {
        expect(container.textContent, `${id} leaked with ${JSON.stringify(overrides)}`).not.toContain(id);
      }
      unmount();
    }
  });

  // ─────────────── R04: status is a word, never an enum, and never colour alone

  it("the state reads as a sentence and no stored enum reaches the page", () => {
    const { container } = mount();
    expect(container.textContent).toContain("Quoting — next stage Customer review");
    for (const leak of ["QUOTING", "CUSTOMER_REVIEW", "NATIONAL_ACCOUNTS", "IDENTIFIED", "DECISION"]) {
      expect(container.textContent).not.toContain(leak);
    }
    // The channel is a word too.
    expect(container.textContent).toContain("National Accounts");
  });

  // ─────────────── NS-P1: the lifecycle spine exists, and there is exactly ONE of it

  it("the lifecycle spine is drawn once, over the ratified stage vocabulary", () => {
    mount();
    const bands = screen.getAllByRole("list", { name: /opportunity lifecycle/i });
    expect(bands).toHaveLength(1);
    const band = within(bands[0]);
    for (const label of ["Identified", "Qualifying", "Solution", "Quoting", "Customer review", "Decision"]) {
      expect(band.getByText(new RegExp(`^✓?\\s*${label}$`))).toBeTruthy();
    }
  });

  it("the record page does NOT also draw the workspace's chevron progression", () => {
    // Two progressions for one deal on one page is the NS-P4 defect this migration removes. The
    // lifecycle control is asked for its `actions` variant precisely to prevent it.
    mount();
    expect(screen.queryByRole("list", { name: /opportunity stage/i })).toBeNull();
  });

  it("a won opportunity carries its outcome as a terminal badge, not as a spine step", () => {
    mount({ stage: "DECISION", outcome: "WON", closedAtMillis: NOW });
    const band = within(screen.getByRole("list", { name: /opportunity lifecycle/i }));
    expect(band.getByText("Won")).toBeTruthy();
    // ...and it is not a button, because a closed deal did not reach it as a clickable stage.
    expect(band.queryByRole("button", { name: "Won" })).toBeNull();
  });

  // ─────────────── ND-12: no fabricated stage times

  it("no stage but Identified claims a time on an open opportunity", () => {
    const { container } = mount();
    // The band opens the CURRENT stage by default, which is Quoting here.
    expect(container.textContent).toMatch(/No time is recorded for this stage/);
  });

  // ─────────────── NS-P2: attention sits ABOVE the work, and renders nothing when clean

  it("the attention band precedes the work area in document order", () => {
    const { container } = mount({ lines: [], nextAction: null });
    const attention = container.querySelector(".ns-attention");
    const body = container.querySelector(".ns-record-body");
    expect(attention).toBeTruthy();
    expect(body).toBeTruthy();
    // NS-P2's ordering law, asserted rather than eyeballed: attention BEFORE work.
    expect(attention.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a clean opportunity renders no attention band at all", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-attention")).toBeNull();
  });

  it("a blocking item states the fact in words, with its severity as a word", () => {
    const { container } = mount({ lines: [] });
    const band = within(container.querySelector(".ns-attention"));
    expect(band.getByText("Blocking")).toBeTruthy();
    expect(container.textContent).toMatch(/no solution lines/i);
  });

  // ─────────────── NS pattern 7: the honest states are distinct renderings

  it("denied, not-found, unavailable and loading are four different screens", () => {
    const denied = mountState({ loading: false, errorStatus: "denied", result: null });
    expect(denied.container.textContent).toMatch(/not authorized/i);
    denied.unmount();

    const notFound = mountState({ loading: false, errorStatus: null, result: { status: "not-found", opportunity: null } });
    expect(notFound.container.textContent).toMatch(/No Opportunity exists for this address/i);
    // A real answer about a real address must never read as a failure.
    expect(notFound.container.textContent).not.toMatch(/unavailable/i);
    notFound.unmount();

    const unavailable = mountState({ loading: false, errorStatus: "unavailable", result: null });
    expect(unavailable.container.textContent).toMatch(/currently unavailable/i);
    // The load-bearing second sentence.
    expect(unavailable.container.textContent).toMatch(/Your work elsewhere is unaffected/i);
    expect(within(unavailable.container).getByRole("button", { name: /try again/i })).toBeTruthy();
    unavailable.unmount();

    const loading = mountState({ loading: true, errorStatus: null, result: null });
    expect(loading.container.textContent).toMatch(/loading/i);
  });

  it("an unresolvable customer name is stated, never replaced by the accountId", () => {
    const { container } = mount({}, {}, { accountName: null });
    expect(container.textContent).toMatch(/name unavailable/i);
    expect(container.textContent).not.toContain("acct_doc_1");
  });

  // ─────────────── authority: unchanged, and fail-closed without the seam

  it("the write seam is fail-closed when no readiness is supplied", () => {
    // The production mount injects the real trusted decision. A mount that injects nothing must
    // get protected controls carrying their reason — never live ones.
    mount({ stage: "DECISION" }, { readiness: undefined });
    for (const name of [/mark won/i, /mark lost/i]) {
      const button = screen.getByRole("button", { name });
      expect(button.disabled).toBe(true);
    }
  });

  it("there is exactly ONE way to advance the deal, and it is the governed control", () => {
    mount();
    // One advance affordance, from `allowedActions` — not one per surface region.
    const advance = screen.getAllByRole("button", { name: /advance to customer review/i });
    expect(advance).toHaveLength(1);
  });

  it("WON and LOST are offered only where the engine allows them", () => {
    // `allowedActions`: LOST from any open stage, WON only from DECISION.
    mount();
    expect(screen.queryByRole("button", { name: /mark won/i })).toBeNull();
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeTruthy();
    screen.unmount?.();
  });

  it("a closed opportunity offers no lifecycle action at all", () => {
    const { container } = mount({ stage: "DECISION", outcome: "LOST", closedAtMillis: NOW });
    expect(container.textContent).toMatch(/no further lifecycle actions/i);
    expect(screen.queryByRole("button", { name: /advance to/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark won/i })).toBeNull();
  });

  // ─────────────── the page is a page, not a shell

  it("the page composes ns-page and hosts no workspace shell", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-page")).toBeTruthy();
    expect(container.querySelector(".fo-workspace-shell")).toBeNull();
  });

  it("a line with no quantity is NAMED as unrecorded rather than shown as a dash or a zero", () => {
    const { container } = mount({ lines: [{ kind: "PART", ref: "PRT-9", qty: null }] });
    const table = within(container.querySelector(".ns-table"));
    expect(table.getByText(/not recorded/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/PRT-9\s*PART\s*0/);
  });

  it("the expected value carries no currency symbol the data does not justify", () => {
    const { container } = mount();
    expect(container.textContent).toMatch(/Expected value 56,000/);
    expect(container.textContent).not.toMatch(/\$56,000/);
  });

  it("no AI suggestion slot is fabricated where no engine exists", () => {
    // §8's prohibition: if the capability does not exist, do not fabricate it. An empty slot
    // saying "nothing is proposed" would be composition for its own sake.
    const { container } = mount();
    expect(container.querySelector(".ns-suggest")).toBeNull();
  });
});
