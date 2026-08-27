// THE OPPORTUNITY RECORD PAGE, AGAINST NORTH STAR P1v2.
//
// Visual authority: `North Star - Opportunity P1v2.dc.html`. The derivation layer is asserted
// offline in test/opportunityNorthStar.test.mjs; this suite asserts the COMPOSITION and — the half
// that matters most for a presentation-layer migration — that composing it introduced NO AUTHORITY.
//
// Structure follows the implementation brief's own test list: Opportunity · Sales Agreement ·
// Sales Order · responsive · authority.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpportunityDetail from "../src/modules/sales/OpportunityDetail.jsx";
import { useOpportunity } from "../src/hooks/useOpportunity.js";
import { useSalesAgreement } from "../src/hooks/useSalesAgreement.js";
import { useOpportunitySectionSave } from "../src/hooks/useOpportunitySectionSave.js";

vi.mock("../src/hooks/useOpportunity.js", () => ({ useOpportunity: vi.fn() }));
vi.mock("../src/hooks/useSalesAgreement.js", () => ({ useSalesAgreement: vi.fn() }));
vi.mock("../src/hooks/useOpportunitySectionSave.js", () => ({ useOpportunitySectionSave: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    loading: false,
    byEmployeeId: new Map([["EMP-3", { displayName: "R. Amado" }]]),
  }),
}));

const DOC_IDS = ["opp_doc_secret", "acct_doc_1", "so_doc_9", "agr_doc_5"];
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const OPEN = { enabled: true, reason: null };

function projection(overrides = {}) {
  return {
    id: "opp_doc_secret",
    opportunityNumber: "OPP-2026-000041",
    name: null,
    accountId: "acct_doc_1",
    salesChannel: "NATIONAL_ACCOUNTS",
    ownerEmployeeId: "EMP-3",
    stage: "QUOTING",
    outcome: null,
    need: "Second commissary build-out — soft serve and shake capacity.",
    expectedValue: 41000,
    expectedCloseAt: NOW + 30 * DAY,
    nextAction: "Call M. Delgado after their board meeting.",
    lines: [{ kind: "MODEL", ref: "Taylor C712", qty: 2 }],
    salesOrderId: null,
    salesAgreementId: null,
    createdAtMillis: NOW - 47 * DAY,
    updatedAtMillis: NOW - DAY,
    closedAtMillis: null,
    ...overrides,
  };
}

const NO_AGREEMENT = { kind: "NONE" };
function agreementState(view, extra = {}) {
  return {
    view,
    refresh: vi.fn(),
    create: vi.fn(),
    updateDraft: vi.fn(),
    accept: vi.fn(),
    pending: {},
    commandError: null,
    clearCommandError: vi.fn(),
    ...extra,
  };
}

let saveSection;

beforeEach(() => {
  saveSection = vi.fn().mockResolvedValue({ kind: "applied", sectionId: "need" });
  useOpportunitySectionSave.mockReturnValue({ pending: {}, outcome: null, saveSection, clearOutcome: vi.fn() });
  useSalesAgreement.mockReturnValue(agreementState(NO_AGREEMENT));
});

// NO DEFAULTING BY DESTRUCTURING for the seams: `{ readiness = OPEN }` would silently replace an
// EXPLICIT undefined with a live one, which is exactly the case the fail-closed tests need.
function mount(overrides = {}, props = {}, envelope = {}) {
  useOpportunity.mockReturnValue({
    loading: false,
    errorStatus: null,
    refetch: vi.fn(),
    result: {
      status: "ready",
      opportunity: projection(overrides),
      accountName: "Desert Sun Beverage Co.",
      salesOrderNumber: null,
      ...envelope,
    },
  });
  const readiness = "readiness" in props ? props.readiness : OPEN;
  const hasCapability = "hasCapability" in props ? props.hasCapability : () => true;
  return render(
    <MemoryRouter initialEntries={["/customers/opportunities/opp_doc_secret"]}>
      <Routes>
        <Route
          path="/customers/opportunities/:opportunityId"
          element={<OpportunityDetail readiness={readiness} hasCapability={hasCapability} actionDeps={{ client: {} }} />}
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

// ═══════════════════════════════════════════════════ OPPORTUNITY

describe("Opportunity P1v2 — identity and stage", () => {
  it("the governed reference is the page's ONE h1", () => {
    mount();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("OPP-2026-000041");
  });

  it("the kicker carries the channel and the subtitle carries the need", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-identity__kicker").textContent).toBe("Opportunity · National Accounts");
    expect(container.querySelector(".ns-identity__subtitle").textContent).toMatch(/Second commissary/);
  });

  it("a pre-numbering record states the absence and never shows its id", () => {
    mount({ opportunityNumber: null });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Opportunity — not numbered");
    expect(h1.textContent).not.toContain("opp_doc");
  });

  it("no document id appears anywhere on the page, in any state", () => {
    const cases = [
      [{}, {}, NO_AGREEMENT],
      [{ opportunityNumber: null }, {}, NO_AGREEMENT],
      [{ salesOrderId: "so_doc_9", outcome: "WON", stage: "DECISION" }, { salesOrderNumber: "SO-2026-000014" }, NO_AGREEMENT],
      [{}, { accountName: null }, NO_AGREEMENT],
      [{}, {}, { kind: "READY", id: "agr_doc_5", salesAgreementNumber: "SA-2026-000012", state: "DRAFT", currency: "USD", totalMinor: 2345000, lines: [{ lineId: "l1", ref: "C712", unitPriceMinor: 100 }], salesOrderId: null, acceptedAtMillis: null }],
      [{}, {}, { kind: "READY", id: "agr_doc_5", salesAgreementNumber: null, state: "DRAFT", currency: "USD", totalMinor: null, lines: [], salesOrderId: "so_doc_9", acceptedAtMillis: null }],
    ];
    for (const [overrides, envelope, agreementView] of cases) {
      useSalesAgreement.mockReturnValue(agreementState(agreementView));
      const { container, unmount } = mount(overrides, {}, envelope);
      for (const id of DOC_IDS) {
        expect(container.textContent, `${id} leaked with ${JSON.stringify(overrides)}`).not.toContain(id);
      }
      unmount();
    }
  });

  it("the state reads as a sentence and no stored enum reaches the page", () => {
    const { container } = mount();
    expect(container.textContent).toContain("Quoting — next stage Customer review");
    for (const leak of ["QUOTING", "CUSTOMER_REVIEW", "NATIONAL_ACCOUNTS", "DECISION", "IDENTIFIED"]) {
      expect(container.textContent).not.toContain(leak);
    }
  });

  it("the value renders bare with the no-currency annotation — never a symbol the data lacks (O1)", () => {
    const { container } = mount();
    expect(container.textContent).toMatch(/41,000/);
    expect(container.textContent).toContain("(no currency recorded)");
    expect(container.textContent).not.toMatch(/\$41,000/);
  });

  it("the six governed stages render as chevrons — this family legally gets them", () => {
    mount();
    const rows = screen.getAllByRole("list", { name: /opportunity stage/i });
    expect(rows).toHaveLength(1);
    const row = within(rows[0]);
    for (const label of ["Identified", "Qualifying", "Solution", "Quoting", "Customer review"]) {
      expect(row.getByText(new RegExp(`${label}`))).toBeTruthy();
    }
  });

  it("the phone renders the SAME stage position in words", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-stage-row__words").textContent).toBe("Quoting · stage 4 of 6");
  });

  it("exactly ONE stage step is clickable, and it is the one the engine permits", () => {
    mount();
    const advance = screen.getAllByRole("button", { name: /advance to customer review/i });
    expect(advance).toHaveLength(1);
    // No other stage offers an action — the rest are static text.
    expect(screen.queryByRole("button", { name: /advance to quoting/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /advance to solution/i })).toBeNull();
  });

  it("Mark Won is absent before Decision and present at it — never invented", () => {
    const early = mount({ stage: "SOLUTION" });
    expect(screen.queryByRole("button", { name: /mark won/i })).toBeNull();
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeTruthy();
    early.unmount();

    mount({ stage: "DECISION" });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeTruthy();
  });

  it("a closed opportunity offers no lifecycle action at all", () => {
    const { container } = mount({ stage: "DECISION", outcome: "WON", closedAtMillis: NOW, salesOrderId: "so_doc_9" }, {}, { salesOrderNumber: "SO-2026-000014" });
    expect(container.textContent).toMatch(/no further lifecycle actions/i);
    expect(screen.queryByRole("button", { name: /advance to/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark won/i })).toBeNull();
  });

  it("the attention strip presents deriveAttention's reasons and the stored next action", () => {
    const { container } = mount({ stage: "DECISION", expectedCloseAt: NOW + 3 * DAY });
    const strip = container.querySelector(".ns-attention-strip");
    expect(strip).toBeTruthy();
    expect(strip.textContent).toMatch(/Awaiting customer decision/);
    expect(strip.textContent).toMatch(/expected close is in 3 days/);
    expect(strip.textContent).toMatch(/Call M. Delgado/);
    // It is presentation of an existing derivation, and must never be labelled as intelligence.
    // Word-bounded on purpose: a bare /AI/i matches the "ai" inside "Awaiting".
    // No intelligence vocabulary: the strip PRESENTS deriveAttention, it does not
    // recommend. Checked as whole words via a split rather than a regex escape --
    // an earlier version put a literal control byte in the file, which
    // test/noLiteralControlBytes.test.mjs correctly refused.
    const words = strip.textContent.split(/[^A-Za-z]+/).map((w) => w.toLowerCase());
    for (const banned of ["ai", "recommend", "recommended", "suggest", "suggested", "predict"]) {
      expect(words).not.toContain(banned);
    }
  });

  it("a closed opportunity shows no attention strip, even with a next action still stored", () => {
    // The stored `nextAction` outlives the close; the strip must not. deriveAttention already
    // returns nothing for WON/LOST and the composition is gated on the same fact.
    const closed = mount({ outcome: "LOST", stage: "DECISION", nextAction: "Call them back" });
    expect(closed.container.querySelector(".ns-attention-strip")).toBeNull();
  });

  it("the four honest read states are four different screens", () => {
    const denied = mountState({ loading: false, errorStatus: "denied", result: null });
    expect(denied.container.textContent).toMatch(/Opportunities are not available to you/i);
    denied.unmount();

    const notFound = mountState({ loading: false, errorStatus: null, result: { status: "not-found", opportunity: null } });
    expect(notFound.container.textContent).toMatch(/No opportunity exists for this address/i);
    expect(notFound.container.textContent).not.toMatch(/couldn’t load|unavailable/i);
    notFound.unmount();

    const unavailable = mountState({ loading: false, errorStatus: "unavailable", result: null });
    expect(unavailable.container.textContent).toMatch(/Couldn’t load this opportunity/i);
    expect(within(unavailable.container).getByRole("button", { name: /try again/i })).toBeTruthy();
    unavailable.unmount();

    const loading = mountState({ loading: true, errorStatus: null, result: null });
    expect(loading.container.textContent).toMatch(/loading/i);
  });

  it("an unresolved customer name keeps the account link live and never shows the id (O2)", () => {
    const { container } = mount({}, {}, { accountName: null });
    expect(container.textContent).toMatch(/Customer — name unavailable/);
    expect(container.textContent).not.toContain("acct_doc_1");
    const link = within(container).getAllByRole("link", { name: /name unavailable/i })[0];
    expect(link.getAttribute("href")).toBe("/customers/acct_doc_1");
  });

  it("an owner the directory cannot resolve is STATED, never left blank", () => {
    // FOUND LIVE on sandbox OPP-2026-000002: the header rendered "Owner" with nothing after it.
    // ownerName() returns null when the directory has no entry, and the fact passed
    // `<strong>{null}</strong>` -- a truthy element wrapping nothing, so RecordIdentity's
    // "drop a fact with no value" filter could not tell it was empty. A label with no value is
    // exactly the fail-blank the grammar exists to remove.
    const { container } = mount({ ownerEmployeeId: "EMP-NOT-IN-DIRECTORY" });
    const facts = container.querySelector(".ns-identity__facts").textContent;
    expect(facts).toMatch(/Owner/);
    // Something must follow the label, and it must not be the employee id.
    expect(facts).not.toMatch(/Owner\s*(·|$)/);
    expect(facts).not.toContain("EMP-NOT-IN-DIRECTORY");
  });

  it("no owner recorded and an unresolvable owner are different sentences", () => {
    // The employee directory is admin/dispatcher-only, so "cannot resolve" is a normal outcome
    // for a legitimate caller -- and a deal with no owner at all is a different fact about the
    // record. Collapsing them would report a data gap as a permissions one, or the reverse.
    const unresolved = mount({ ownerEmployeeId: "EMP-NOT-IN-DIRECTORY" });
    const a = unresolved.container.querySelector(".ns-identity__facts").textContent;
    unresolved.unmount();
    const none = mount({ ownerEmployeeId: null });
    const b = none.container.querySelector(".ns-identity__facts").textContent;
    expect(a).not.toBe(b);
    expect(b).toMatch(/Unassigned/);
  });

  it("a resolvable owner renders the person's name", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-identity__facts").textContent).toMatch(/R\. Amado/);
  });

  it("the activity gap is stated, never fabricated (O3)", () => {
    const { container } = mount();
    const activity = container.querySelector('[aria-label="Activity"]');
    expect(activity.textContent).toMatch(/No activity history can be shown yet/);
    expect(activity.textContent).toMatch(/audited\s+server-side/);
  });

  it("the qualification seam states it is not configured, and invents no schema", () => {
    const { container } = mount();
    expect(container.textContent).toMatch(/Not configured/i);
  });
});

// ═══════════════════════════════════════════════════ EDITING

describe("Opportunity P1v2 — editing goes through the version-checked authority", () => {
  it("a section save sends the loaded version token to the governed command", async () => {
    const { container } = mount();
    const editButtons = within(container).getAllByRole("button", { name: /^edit/i });
    expect(editButtons.length).toBeGreaterThan(0);
    fireEvent.click(editButtons[0]);
    const save = await screen.findByRole("button", { name: /^save$/i });
    fireEvent.click(save);
    expect(saveSection).toHaveBeenCalled();
    // The THIRD argument is the optimistic-concurrency token. A save that did not carry the
    // version the page loaded would be an unguarded overwrite.
    const [, , version] = saveSection.mock.calls[0];
    expect(version).toBe(projection().updatedAtMillis);
  });

  it("editing is refused on a closed opportunity, because the command refuses it", () => {
    const { container } = mount({ outcome: "WON", stage: "DECISION" });
    const edits = within(container).queryAllByRole("button", { name: /^edit/i });
    for (const b of edits) expect(b.disabled).toBe(true);
  });

  it("the write seam is fail-closed when no readiness is supplied", () => {
    mount({ stage: "DECISION" }, { readiness: undefined });
    for (const name of [/mark won/i, /mark lost/i]) {
      expect(screen.getByRole("button", { name }).disabled).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════ SALES AGREEMENT

describe("Opportunity P1v2 — the Sales Agreement relationship", () => {
  const READY_DRAFT = {
    kind: "READY", id: "agr_doc_5", salesAgreementNumber: "SA-2026-000012", state: "DRAFT",
    currency: "USD", totalMinor: 2345000, salesOrderId: null, acceptedAtMillis: null,
    lines: [{ lineId: "l1", ref: "C712", unitPriceMinor: 100 }, { lineId: "l2", ref: "441", unitPriceMinor: 200 }, { lineId: "l3", ref: "INS", unitPriceMinor: 300 }],
  };

  it("absent renders the truthful empty state and the governed Create action", () => {
    useSalesAgreement.mockReturnValue(agreementState(NO_AGREEMENT));
    const { container } = mount();
    const section = container.querySelector('[aria-label="Sales agreement"]');
    expect(section.textContent).toMatch(/No sales agreement associated/);
    expect(within(section).getByRole("button", { name: /create sales agreement/i })).toBeTruthy();
  });

  it("Create is NOT rendered when the capability is absent — never a dead button", () => {
    useSalesAgreement.mockReturnValue(agreementState(NO_AGREEMENT));
    const { container } = mount({}, { hasCapability: () => false });
    const section = container.querySelector('[aria-label="Sales agreement"]');
    expect(within(section).queryByRole("button", { name: /create sales agreement/i })).toBeNull();
  });

  it("Create invokes the EXISTING governed command and nothing else", () => {
    const state = agreementState(NO_AGREEMENT);
    useSalesAgreement.mockReturnValue(state);
    const { container } = mount();
    const section = container.querySelector('[aria-label="Sales agreement"]');
    fireEvent.click(within(section).getByRole("button", { name: /create sales agreement/i }));
    expect(state.create).toHaveBeenCalledWith({ opportunityId: "opp_doc_secret" });
  });

  it("a present agreement renders its governed facts, with REAL money", () => {
    useSalesAgreement.mockReturnValue(agreementState(READY_DRAFT));
    const { container } = mount();
    const section = container.querySelector('[aria-label="Sales agreement"]');
    expect(section.textContent).toMatch(/SA-2026-000012/);
    expect(section.textContent).toMatch(/Draft — awaiting acceptance/);
    expect(section.textContent).toMatch(/3 lines, all priced/);
    // The agreement DOES store a currency, so unlike the opportunity's value this is money.
    expect(section.textContent).toMatch(/\$23,450\.00/);
    expect(within(section).getByRole("link", { name: /view agreement/i })).toBeTruthy();
  });

  it("an unpriced draft names the view model's own acceptability reason", () => {
    useSalesAgreement.mockReturnValue(agreementState({
      ...READY_DRAFT,
      lines: [{ lineId: "l1", ref: "C712", unitPriceMinor: null }, { lineId: "l2", ref: "441", unitPriceMinor: null }],
    }));
    const { container } = mount();
    const section = container.querySelector('[aria-label="Sales agreement"]');
    expect(section.textContent).toMatch(/needs a price before this can be accepted/i);
  });

  it("NOT_ENABLED, DENIED and UNAVAILABLE stay three distinct sentences", () => {
    const seen = new Set();
    for (const [kind, pattern] of [
      ["NOT_ENABLED", /aren’t enabled in this environment/i],
      ["DENIED", /Not available to you/i],
      ["UNAVAILABLE", /Couldn’t load the agreement/i],
    ]) {
      useSalesAgreement.mockReturnValue(agreementState({ kind }));
      const { container, unmount } = mount();
      const text = container.querySelector('[aria-label="Sales agreement"]').textContent;
      expect(text, `${kind} did not render its own sentence`).toMatch(pattern);
      seen.add(text);
      unmount();
    }
    // Three states, three DIFFERENT sentences — never collapsed into one failure.
    expect(seen.size).toBe(3);
  });

  it("no Create button is offered in NOT_ENABLED or DENIED", () => {
    for (const kind of ["NOT_ENABLED", "DENIED"]) {
      useSalesAgreement.mockReturnValue(agreementState({ kind }));
      const { container, unmount } = mount();
      const section = container.querySelector('[aria-label="Sales agreement"]');
      expect(within(section).queryByRole("button", { name: /create sales agreement/i })).toBeNull();
      unmount();
    }
  });

  it("the agreement NEVER appears in the stage chevrons, and never moves the stage", () => {
    useSalesAgreement.mockReturnValue(agreementState({ ...READY_DRAFT, state: "ACCEPTED", acceptedAtMillis: NOW }));
    const { container } = mount();
    const chevrons = screen.getByRole("list", { name: /opportunity stage/i });
    expect(chevrons.textContent).not.toMatch(/agreement|SA-2026/i);
    // The stage is exactly what the opportunity's own record says, agreement or not.
    expect(container.querySelector(".ns-stage-row__words").textContent).toBe("Quoting · stage 4 of 6");
  });

  it("the header states the agreement ONLY when one exists — never 'Agreement: —'", () => {
    useSalesAgreement.mockReturnValue(agreementState(NO_AGREEMENT));
    const none = mount();
    expect(none.container.querySelector(".ns-identity__facts").textContent).not.toMatch(/Agreement/);
    none.unmount();

    useSalesAgreement.mockReturnValue(agreementState(READY_DRAFT));
    const some = mount();
    expect(some.container.querySelector(".ns-identity__facts").textContent).toMatch(/Agreement\s*SA-2026-000012/);
  });

  it("no acceptance, pricing or terms UI is offered here — that is the agreement's own surface", () => {
    useSalesAgreement.mockReturnValue(agreementState(READY_DRAFT));
    const { container } = mount();
    const section = container.querySelector('[aria-label="Sales agreement"]');
    for (const forbidden of [/^accept$/i, /decline/i, /add line/i, /set price/i]) {
      expect(within(section).queryByRole("button", { name: forbidden })).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════ SALES ORDER

describe("Opportunity P1v2 — both commercial paths stay intact", () => {
  it("the direct Won → Sales Order path is stated and linked when it exists", () => {
    const { container } = mount(
      { stage: "DECISION", outcome: "WON", salesOrderId: "so_doc_9" },
      {}, { salesOrderNumber: "SO-2026-000014" },
    );
    const section = container.querySelector('[aria-label="When this closes"]');
    expect(section.textContent).toMatch(/SO-2026-000014/);
    expect(within(section).getByRole("link", { name: /SO-2026-000014/ }).getAttribute("href"))
      .toBe("/customers/opportunities/sales-order/so_doc_9");
  });

  it("the agreement-derived order is reported as the agreement's, not the opportunity's", () => {
    useSalesAgreement.mockReturnValue(agreementState({
      kind: "READY", id: "agr_doc_5", salesAgreementNumber: "SA-2026-000012", state: "ACCEPTED",
      currency: "USD", totalMinor: 2345000, salesOrderId: "so_doc_9", acceptedAtMillis: NOW, lines: [],
    }));
    const { container } = mount({ salesOrderId: null });
    const section = container.querySelector('[aria-label="When this closes"]');
    expect(section.textContent).toMatch(/its agreement produced/i);
  });

  it("the page never implies an agreement is a prerequisite for Won", () => {
    const { container } = mount({ stage: "DECISION" });
    const section = container.querySelector('[aria-label="When this closes"]');
    expect(section.textContent).toMatch(/never a prerequisite/i);
    // And Mark Won is offered with NO agreement present at all.
    expect(screen.getByRole("button", { name: /mark won/i }).disabled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════ RESPONSIVE (structural)

describe("Opportunity P1v2 — responsive composition", () => {
  it("the stage row carries both renderings, so neither width invents its own derivation", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-stage-row__chevrons")).toBeTruthy();
    expect(container.querySelector(".ns-stage-row__words")).toBeTruthy();
  });

  it("wide content scrolls inside its own box, never the page", () => {
    // The chevron row is the only element that can exceed the measure; it owns its overflow.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.css"), "utf8");
    expect(css).toMatch(/\.ns-stage-row__chevrons > \.fo-sales-detail__lifecycle \{ overflow-x: auto; \}/);
  });
});

// ═══════════════════════════════════════════════════ AUTHORITY (§24)

// ═══════════════════════════════════════════════════ THE PRODUCTION WIRING
//
// A seam resolved and not threaded is indistinguishable, on screen, from a seam that answered
// "no" -- and this one produced a sentence that reads like a deliberate environment gate.

describe("Opportunity P1v2 — the connected mount threads what it resolves", () => {
  const APP = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.jsx"),
    "utf8",
  );
  const MOUNT = APP.slice(
    APP.indexOf("function OpportunityDetailConnected"),
    APP.indexOf("function SalesOrderDetailConnected"),
  );

  it("passes hasCapability to OpportunityDetail, not just resolves it", () => {
    // FOUND LIVE: the mount called useOpportunityCapabilities and never passed the result on, so
    // the page used its fail-closed default and the Sales Agreement card rendered
    // "aren't enabled in this environment yet" on every record -- while those capabilities ARE
    // activated for platform-sandbox. Create could never appear either.
    expect(MOUNT).toMatch(/useOpportunityCapabilities/);
    expect(MOUNT, "hasCapability is resolved but never threaded").toMatch(/hasCapability=\{hasCapability\}/);
  });

  it("still threads the write-readiness seam it already had", () => {
    // The regression to guard against in the other direction: a future edit that swaps one seam
    // for the other rather than passing both.
    expect(MOUNT).toMatch(/readiness=\{opportunityWriteReadiness\(/);
  });
});

describe("Opportunity P1v2 — the migration introduced NO authority", () => {
  const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "modules", "sales", "OpportunityDetail.jsx"),
    "utf8",
  );
  const CARD = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "modules", "sales", "OpportunityAgreementCard.jsx"),
    "utf8",
  );

  it("neither the page nor the agreement card touches Firestore directly", () => {
    for (const [name, src] of [["OpportunityDetail", SRC], ["OpportunityAgreementCard", CARD]]) {
      expect(src, `${name} imports firebase`).not.toMatch(/from "firebase\//);
      for (const forbidden of ["setDoc", "updateDoc", "addDoc", "deleteDoc", "writeBatch", "runTransaction", "collection("]) {
        expect(src, `${name} uses ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("every write is reached through an existing governed hook — no new command client", () => {
    // The three write seams, and only these three.
    expect(SRC).toMatch(/useOpportunityTransitions/);
    expect(SRC).toMatch(/useOpportunitySectionSave/);
    expect(CARD).not.toMatch(/CommandClient|httpsCallable/);
    expect(SRC).not.toMatch(/CommandClient|httpsCallable/);
  });

  it("no lifecycle, numbering or pricing logic is defined on the client", () => {
    for (const [name, src] of [["OpportunityDetail", SRC], ["OpportunityAgreementCard", CARD]]) {
      // No stage vocabulary is re-declared: the page imports it or does without.
      expect(src, `${name} declares stages`).not.toMatch(/["']IDENTIFIED["']\s*,\s*["']QUALIFYING["']/);
      expect(src, `${name} mints a reference`).not.toMatch(/OPP-\$\{|SA-\$\{|SO-\$\{/);
      // No arithmetic on money: minor units go to the formatter untouched.
      expect(src, `${name} does money arithmetic`).not.toMatch(/Minor\s*[*/+-]\s*\d/);
    }
  });

  it("the stage vocabulary and legality come from the domain, not from this page", () => {
    expect(SRC).toMatch(/from "\.\.\/\.\.\/domain\/opportunityNorthStar\.js"/);
    // allowedActions/stageProgress are consulted through the shared control + derivation, never
    // re-implemented here.
    expect(SRC).not.toMatch(/allowedActions\s*\(/);
    expect(SRC).not.toMatch(/function\s+\w*[Ss]tageProgress/);
  });
});
