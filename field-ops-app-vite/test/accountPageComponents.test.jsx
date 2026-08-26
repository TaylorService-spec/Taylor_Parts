// accountPageComponents.js -- registration + capability-gated rendering tests.
//
// Two concerns, kept deliberately separate:
//   1. REGISTRATION -- registerAccountPageComponents() (the REAL adapters, wrapping the REAL
//      src/modules/accounts/ components) actually resolves every componentId accountRecordPage
//      names, and the registry's own duplicate-registration contract still holds through this
//      module. Iterates accountRecordPage's own sections rather than a hand-typed id list, so
//      this test cannot silently go stale if accountPage.js's componentId set ever changes.
//   2. VISIBILITY -- the exact subset definitions AccountDetail.jsx renders through the metadata
//      path (accountRecordPageMainSubset / accountRecordPageSideSubset) compose correctly with
//      MetadataRecordPage + a caller-supplied capabilityDecisions map: a gated section absent
//      from the DOM when denied, present when explicitly granted, and an EMPTY decisions map
//      hiding every gated section (fail-closed) rather than revealing it. These render through
//      TEST-DOUBLE components registered under the same ids the real ones use -- the real
//      src/modules/accounts/ components are exercised by registration (#1) and by their own
//      component-specific tests; what belongs HERE is proving the wiring (registry -> plan ->
//      visibility -> DOM) never quietly reveals or hides the wrong thing, independent of what a
//      section happens to render.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import MetadataRecordPage from "../src/metadata/MetadataRecordPage.jsx";
import { componentRegistry } from "../src/metadata/registry.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import { opportunityRelatedList } from "../src/metadata/definitions/opportunity.js";
import { contactRelatedList } from "../src/metadata/definitions/contact.js";
import { locationRelatedList } from "../src/metadata/definitions/location.js";
import { formatDateOnly } from "../src/domain/displayTimestamp.js";
import {
  registerAccountPageComponents,
  accountPageComponentIds,
  accountRecordPageMainSubset,
  accountRecordPageSideSubset,
  accountRecordPageContactsLocationsSubset,
  accountPageListResolver,
  accountPageEntityResolver,
  buildAccountRelatedListPresentation,
} from "../src/metadata/definitions/accountPageComponents.js";
import AccountDetail from "../src/modules/accounts/AccountDetail.jsx";
import { useAccount } from "../src/hooks/useAccount";
import { useLocationsForAccount } from "../src/hooks/useLocationsForAccount";
import { useContactsForAccount } from "../src/hooks/useContactsForAccount";

// The X-ACCOUNT-WIRE-CALLABLE-LISTS re-evaluation below renders the REAL Opportunities /
// Sales Orders RELATED_LIST sections (straight off accountRecordPage — not test doubles),
// through the REAL default RELATED_LIST binding (DefaultRelatedList, MetadataRecordPage.jsx).
// That binding's only Firestore/callable touch points are firestoreListSource.js's and
// callableListSource.js's own fetchPage — mocked at that boundary, the same boundary
// test/metadataRecordPage.test.jsx already mocks at, so these tests exercise the routing
// and rendering decisions, not either translator's internals.
const fetchPageMock = vi.fn();
vi.mock("../src/metadata/firestoreListSource.js", () => ({
  fetchPage: (...args) => fetchPageMock(...args),
}));
const fetchCallablePageMock = vi.fn();
vi.mock("../src/metadata/callableListSource.js", () => ({
  fetchPage: (...args) => fetchCallablePageMock(...args),
}));

// ── A-ACCOUNT-WIRE-CONTACTS-LOCATIONS — full AccountDetail.jsx integration mocks ──────
//
// Only used by the "contacts / locations RELATED_LIST — WIRED" describe block far below,
// but vi.mock is hoisted/file-scoped regardless of where it is written, so it lives here
// with the other module-boundary mocks this file already declares. Same boundary and same
// technique test/accountDetailFailClosed.test.jsx already uses for a full AccountDetail
// render: mock the account-shaped hooks directly (no Firebase, no network) and stub the
// heavy child sections that are irrelevant to Contacts/Locations, so the render stays
// narrow. useContactsForAccount / useLocationsForAccount are NOT mocked module-wide here —
// each test below supplies its own return value, since the whole point of this lane is
// exercising what AccountDetail does with that hook's OWN live data.
// Vitest hoists vi.mock factories above imports/declarations, and only allows a factory to
// reference an outer variable whose name is prefixed "mock" (its own documented escape
// hatch for exactly this) — hence mockCreateContact/mockCreateLocation, not
// createContactMock/createLocationMock.
vi.mock("../src/domain/contacts.js", async (orig) => {
  const actual = await orig();
  return { ...actual, createContact: (...args) => mockCreateContact(...args) };
});
const mockCreateContact = vi.fn();
vi.mock("../src/domain/locations.js", async (orig) => {
  const actual = await orig();
  return { ...actual, createLocation: (...args) => mockCreateLocation(...args) };
});
const mockCreateLocation = vi.fn();
vi.mock("../src/modules/accounts/ServiceActivitySection", () => ({ default: () => null }));
vi.mock("../src/modules/accounts/FinancialSummarySection", () => ({ default: () => null }));
vi.mock("../src/modules/accounts/FinancialForecastSection", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ accountId: "acct-1" }) };
});
vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({ useLocationsForAccount: vi.fn() }));
vi.mock("../src/hooks/useContactsForAccount", () => ({ useContactsForAccount: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ byUserId: {}, loading: false, error: null }),
}));

describe("registerAccountPageComponents", () => {
  beforeEach(() => {
    componentRegistry.__resetForTest();
  });

  it("resolves every componentId accountRecordPage's sections name -- discovered, not hardcoded", () => {
    // The set under test is read off the real definition, exactly as CI/pageRuntime would --
    // if accountPage.js ever names a sixth section, this test still covers it with no edit.
    const declaredIds = [...new Set(accountRecordPage.sections.map((s) => s.componentId).filter(Boolean))];
    expect(declaredIds.length).toBeGreaterThan(0);
    expect(declaredIds).toEqual(accountPageComponentIds());

    registerAccountPageComponents();

    for (const id of declaredIds) {
      expect(componentRegistry.has(id)).toBe(true);
    }
  });

  it("registering twice throws -- the registry's own contract (re-registering an id is refused, never shadowed)", () => {
    registerAccountPageComponents();
    expect(() => registerAccountPageComponents()).toThrow();
  });
});

describe("accountRecordPageMainSubset / accountRecordPageSideSubset -- capability-gated visibility", () => {
  const FIN_MARK = "financials section rendered";
  const NOTES_MARK = "activity and notes section rendered";
  const SERVICE_MARK = "service activity section rendered";
  const ATTENTION_MARK = "account attention section rendered";

  beforeEach(() => {
    componentRegistry.__resetForTest();
    // Test doubles under the SAME ids accountPage.js names -- proves the wiring (plan ->
    // visibility -> DOM), independent of what the real src/modules/accounts/ components
    // actually render (that is registerAccountPageComponents' + those components' own concern).
    componentRegistry.register({
      id: "accountFinancialsSection",
      kind: "RECORD_SECTION",
      component: () => <p>{FIN_MARK}</p>,
    });
    componentRegistry.register({
      id: "accountActivityAndNotesSection",
      kind: "RECORD_SECTION",
      component: () => <p>{NOTES_MARK}</p>,
    });
    componentRegistry.register({
      id: "accountServiceActivity",
      kind: "RECORD_SECTION",
      component: () => <p>{SERVICE_MARK}</p>,
    });
    componentRegistry.register({
      id: "accountAttentionSection",
      kind: "RECORD_SECTION",
      component: () => <p>{ATTENTION_MARK}</p>,
    });
  });

  it("financials and activityAndNotes carry the real declared capability requirements", () => {
    const byId = Object.fromEntries(accountRecordPageMainSubset.sections.map((s) => [s.id, s]));
    expect(byId.financials.capabilityRequirement).toBe("finance.read");
    expect(byId.activityAndNotes.capabilityRequirement).toBe("crm.activity.read");
    expect(byId.serviceActivity.capabilityRequirement).toBeNull();
    const side = Object.fromEntries(accountRecordPageSideSubset.sections.map((s) => [s.id, s]));
    expect(side.accountAttention.capabilityRequirement).toBe("finance.read");
  });

  it("a section whose capability is not granted does not render -- absent from the DOM, not merely invisible", () => {
    render(
      <MetadataRecordPage
        definition={accountRecordPageMainSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": false, "crm.activity.read": false }}
      />
    );
    expect(screen.queryByText(FIN_MARK)).toBeNull();
    expect(screen.queryByText(NOTES_MARK)).toBeNull();
    // The ungated section is unaffected by either denial.
    expect(screen.getByText(SERVICE_MARK)).toBeTruthy();
  });

  it("an explicit grant reveals the section, and only the section that capability covers", () => {
    render(
      <MetadataRecordPage
        definition={accountRecordPageMainSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
      />
    );
    expect(screen.getByText(FIN_MARK)).toBeTruthy();
    // finance.read grants financials, not activityAndNotes -- that needs crm.activity.read,
    // which this decisions map never answers.
    expect(screen.queryByText(NOTES_MARK)).toBeNull();
    expect(screen.getByText(SERVICE_MARK)).toBeTruthy();
  });

  it("the fail-closed default: an empty decisions map hides every gated section across both subsets", () => {
    const { container } = render(
      <>
        <MetadataRecordPage definition={accountRecordPageMainSubset} record={{ id: "acct-1" }} capabilityDecisions={{}} />
        <MetadataRecordPage definition={accountRecordPageSideSubset} record={{ id: "acct-1" }} capabilityDecisions={{}} />
      </>
    );
    expect(screen.queryByText(FIN_MARK)).toBeNull();
    expect(screen.queryByText(NOTES_MARK)).toBeNull();
    expect(screen.queryByText(ATTENTION_MARK)).toBeNull();
    // serviceActivity has no capabilityRequirement -- an empty map cannot hide what was never gated.
    expect(screen.getByText(SERVICE_MARK)).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("the SIDE subset's accountAttention is granted by the same finance.read decision as financials", () => {
    render(
      <MetadataRecordPage
        definition={accountRecordPageSideSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
      />
    );
    expect(screen.getByText(ATTENTION_MARK)).toBeTruthy();
  });
});

// X-ACCOUNT-PAGE-WIRING-COMPLETE — the SIDE subset stays hand-rendered in AccountDetail.jsx even
// with `embedded` (GAP 3) available. These two tests lock in WHY, so a future lane cannot "fix"
// AccountDetail.jsx by simply adding `embedded` without also addressing the real cause: a
// section-level capabilityRequirement cannot express "this component has an ungated half".
// See accountPageComponents.js's WIRING SCOPE note and AccountDetail.jsx's own comment above the
// hand-rendered <AccountAttentionSection> for the full case (AccountAttentionSection.jsx composes
// a finance.read-gated AR read with an UNGATED Work-Order-past-due read; a section that vanishes
// whenever finance.read is denied throws away the ungated half too).
describe("accountRecordPageSideSubset with `embedded` — evaluated and still not adopted", () => {
  const ATTENTION_MARK = "account attention section rendered";

  beforeEach(() => {
    componentRegistry.__resetForTest();
    componentRegistry.register({
      id: "accountAttentionSection",
      kind: "RECORD_SECTION",
      component: () => <p>{ATTENTION_MARK}</p>,
    });
  });

  it("embedded does NOT rescue the SIDE subset: a denied finance.read still hides the section entirely, with no page-level failure to signal it", () => {
    const { container } = render(
      <MetadataRecordPage
        definition={accountRecordPageSideSubset}
        record={{ id: "acct-1" }}
        // Matches production's real, current state: finance.read is registered catalog-wide
        // active:false, so an empty decisions map is not a contrived edge case here — it is what
        // every viewer sees today.
        capabilityDecisions={{}}
        embedded
      />
    );
    // Embedded correctly avoids the page-level "Not available to you" FailureState (GAP 3's own
    // job) — but that only proves the REGION-level symptom is fixed. Nothing at all renders in
    // its place: no test double, no failure state, nothing. A real AccountAttentionSection mounted
    // by hand would still show its own Work-Order-past-due content here (that half is Rules-gated
    // by role, not by finance.read) — this is exactly the content a metadata-driven swap would
    // discard, for every viewer, today.
    expect(screen.queryByText(ATTENTION_MARK)).toBeNull();
    expect(screen.queryByText(/not available to you/i)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("granted, embedded renders the section content cleanly — proving the mechanism works; the rejection above is a section-design mismatch, not a bug in `embedded` itself", () => {
    render(
      <MetadataRecordPage
        definition={accountRecordPageSideSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
        embedded
      />
    );
    expect(screen.getByText(ATTENTION_MARK)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A-ACCOUNT-WIRE-CALLABLE-LISTS-2 — opportunities / salesOrders WIRED after commit 6998306f
// closed BOTH renderer blockers the prior lane found (X-LIST-TIMESTAMP-FORMATTING,
// X-LIST-ROW-NAVIGATION — docs/orchestration/metadata-program/LEDGER.md; reviewed as PR
// #1202). These tests render the REAL "opportunities" / "salesOrders" sections straight off
// accountRecordPage (never test doubles) through the REAL DefaultRelatedList binding, using
// this module's own exported accountPageListResolver / accountPageEntityResolver (the same
// functions AccountDetail.jsx passes to MetadataRecordPage) against the REAL opportunity.js /
// salesOrder.js / account.js definitions — proving the wiring is correct, not merely that it
// no longer crashes: correct account scoping, real reference numbers (never a document id),
// a formatted expectedCloseAt date, honest truncation disclosure, correct denied/absent
// behavior, and Sales Orders' real per-order route working end to end. See
// accountPageComponents.js's WIRING SCOPE note for the full narrative.
//
// DefaultRelatedList calls react-router's useNavigate() unconditionally once a RELATED_LIST
// section mounts (MetadataRecordPage.jsx) — every render below that GRANTS opportunity.read/
// salesOrder.read (so the section actually mounts) needs a <MemoryRouter> ancestor; the
// "denied" test does not, because a denied section is excluded from the plan before
// DefaultRelatedList ever mounts.
describe("opportunities / salesOrders RELATED_LIST — WIRED (A-ACCOUNT-WIRE-CALLABLE-LISTS-2, commit 6998306f)", () => {
  // Single-section subsets of the REAL accountRecordPage — isolates each section's assertions
  // from the other MAIN-column sections accountRecordPageMainSubset also carries.
  const opportunitiesOnly = {
    ...accountRecordPage,
    sections: accountRecordPage.sections.filter((s) => s.id === "opportunities"),
  };
  const salesOrdersOnly = {
    ...accountRecordPage,
    sections: accountRecordPage.sections.filter((s) => s.id === "salesOrders"),
  };

  beforeEach(() => {
    fetchPageMock.mockReset();
    fetchCallablePageMock.mockReset();
  });

  it("the CALLABLE gap stays closed: reads go through the callable source, correctly scoped to THIS account, never Firestore", async () => {
    fetchCallablePageMock.mockResolvedValue({
      rows: [{ id: "opp-doc-1", opportunityNumber: "OPP-2026-000123", stage: "QUALIFICATION", need: "New freezer" }],
      hasMore: false,
      nextCursorDoc: null,
    });
    render(
      <MemoryRouter>
        <MetadataRecordPage
          definition={opportunitiesOnly}
          record={{ id: "acct-42" }}
          capabilityDecisions={{ "opportunity.read": true }}
          listResolver={accountPageListResolver}
          entityResolver={accountPageEntityResolver}
        />
      </MemoryRouter>
    );
    // The real reference number, not the document id — the document id never reaches the DOM.
    expect(await screen.findByText("OPP-2026-000123")).toBeTruthy();
    expect(screen.queryByText("opp-doc-1")).toBeNull();
    expect(fetchCallablePageMock).toHaveBeenCalledTimes(1);
    expect(fetchPageMock).not.toHaveBeenCalled();
    const [descriptor] = fetchCallablePageMock.mock.calls[0];
    // Scoped to THIS account (account.js's account.opportunities relationship, viaField
    // accountId) — never every Opportunity in the system.
    expect(descriptor.filters).toContainEqual(expect.objectContaining({ fieldId: "accountId", operator: "EQUALS", value: "acct-42" }));
  });

  it("truncation is honestly disclosed, not presented as the whole set", async () => {
    fetchCallablePageMock.mockResolvedValue({
      rows: Array.from({ length: 25 }, (_, i) => ({ id: `opp-${i}`, opportunityNumber: `OPP-2026-${String(i).padStart(6, "0")}` })),
      hasMore: true,
      nextCursorDoc: null,
    });
    render(
      <MemoryRouter>
        <MetadataRecordPage
          definition={opportunitiesOnly}
          record={{ id: "acct-42" }}
          capabilityDecisions={{ "opportunity.read": true }}
          listResolver={accountPageListResolver}
          entityResolver={accountPageEntityResolver}
        />
      </MemoryRouter>
    );
    expect(await screen.findByText(/showing the most recent 25/i)).toBeTruthy();
  });

  it("denied/unactivated capability makes the section absent, not read as \"there are none\" — matching the ALREADY-ACCEPTED financials/activityAndNotes precedent, not a new capability regression", () => {
    // `embedded`, matching how AccountDetail.jsx actually mounts this: opportunities/
    // salesOrders sit alongside other MAIN-column sections on the real page, so denying
    // ONE section's capability is a REGION-level "nothing to show here" (this test's own
    // concern), never the PAGE-level "Not available to you" — that box is what a plan with
    // ZERO visible sections anywhere on the page would show (GAP 3, MetadataRecordPage.jsx),
    // a different, correctly-distinct case this single-section definition would otherwise
    // trigger by accident. No MemoryRouter needed — the denied section never mounts
    // DefaultRelatedList at all.
    const { container } = render(
      <MetadataRecordPage
        definition={opportunitiesOnly}
        record={{ id: "acct-42" }}
        // Matches production's real, current state: opportunity.read/salesOrder.read are
        // registered catalog-wide active:false, so an empty decisions map is what every
        // current viewer sees, not a contrived edge case.
        capabilityDecisions={{}}
        listResolver={accountPageListResolver}
        entityResolver={accountPageEntityResolver}
        embedded
      />
    );
    // Absent, not an empty-list message ("No opportunities on this account.") and not a
    // rendered DENIED failure box either — the section-level gate excludes it from the plan
    // before either state could render. Never attempts the read.
    expect(container.textContent).not.toMatch(/no opportunities/i);
    expect(container.textContent).not.toMatch(/not available to you/i);
    expect(container.textContent).toBe("");
    expect(fetchCallablePageMock).not.toHaveBeenCalled();
  });

  it("CLOSED BLOCKER 1 — opportunities' TIMESTAMP column (expectedCloseAt) renders a formatted date, never the raw epoch-millisecond value", async () => {
    fetchCallablePageMock.mockResolvedValue({
      rows: [{ id: "opp-1", opportunityNumber: "OPP-2026-000999", expectedCloseAt: 1755993600000 }],
      hasMore: false,
      nextCursorDoc: null,
    });
    render(
      <MemoryRouter>
        <MetadataRecordPage
          definition={opportunitiesOnly}
          record={{ id: "acct-42" }}
          capabilityDecisions={{ "opportunity.read": true }}
          listResolver={accountPageListResolver}
          entityResolver={accountPageEntityResolver}
        />
      </MemoryRouter>
    );
    await screen.findByText("OPP-2026-000999");
    // The exact same shared formatter (domain/displayTimestamp.js) the rest of the codebase
    // already uses for a stored time, not a value re-derived here — so this assertion cannot
    // silently drift from what cellValue() actually calls.
    expect(screen.getByText(formatDateOnly(1755993600000, { unknown: null }))).toBeTruthy();
    // The raw epoch number never reaches the DOM — this is the exact regression BLOCKER 1
    // used to lock in (PR #1202); now it locks in the opposite fact.
    expect(screen.queryByText("1755993600000")).toBeNull();
  });

  it("CLOSED BLOCKER 2 — salesOrders rows navigate to the real, existing per-order route on click", async () => {
    fetchCallablePageMock.mockResolvedValue({
      rows: [{ id: "so-1", salesOrderNumber: "SO-2026-000045", state: "OPEN" }],
      hasMore: false,
      nextCursorDoc: null,
    });
    // Renders the current location's pathname so a click's navigation effect is observable
    // without mocking react-router's useNavigate — same technique as
    // test/metadataRecordPage.test.jsx's "DEFECT 2" suite.
    function LocationProbe() {
      const location = useLocation();
      return <p data-testid="location">{location.pathname}</p>;
    }
    render(
      <MemoryRouter initialEntries={["/customers/acct-42"]}>
        <LocationProbe />
        <MetadataRecordPage
          definition={salesOrdersOnly}
          record={{ id: "acct-42" }}
          capabilityDecisions={{ "salesOrder.read": true }}
          listResolver={accountPageListResolver}
          entityResolver={accountPageEntityResolver}
        />
      </MemoryRouter>
    );
    const cell = await screen.findByText("SO-2026-000045");
    const row = cell.closest("tr");
    // The row is a real interactive target now (DefaultRelatedList wired rowNavigationTo).
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.click(row);
    // salesOrderRelatedList's own rowNavigationTo — the SAME real route SalesOrderDetail.jsx
    // is mounted at in App.jsx, with the routing key (document id) substituted, never shown
    // as content.
    expect((await screen.findByTestId("location")).textContent).toBe("/customers/opportunities/sales-order/so-1");
  });

  it("opportunities rows stay non-focusable: opportunity.js declares no rowNavigationTo, because no per-Opportunity route exists anywhere in App.jsx", async () => {
    fetchCallablePageMock.mockResolvedValue({
      rows: [{ id: "opp-1", opportunityNumber: "OPP-2026-000999" }],
      hasMore: false,
      nextCursorDoc: null,
    });
    function LocationProbe() {
      const location = useLocation();
      return <p data-testid="location">{location.pathname}</p>;
    }
    render(
      <MemoryRouter initialEntries={["/customers/acct-42"]}>
        <LocationProbe />
        <MetadataRecordPage
          definition={opportunitiesOnly}
          record={{ id: "acct-42" }}
          capabilityDecisions={{ "opportunity.read": true }}
          listResolver={accountPageListResolver}
          entityResolver={accountPageEntityResolver}
        />
      </MemoryRouter>
    );
    const cell = await screen.findByText("OPP-2026-000999");
    const row = cell.closest("tr");
    // The exact "rowNavigationTo absent" degrade DefaultRelatedList already tests for on its
    // own (test/metadataRecordPage.test.jsx's DEFECT 2 suite) — non-focusable, no click.
    expect(row.getAttribute("tabindex")).toBeNull();
    fireEvent.click(row);
    expect((await screen.findByTestId("location")).textContent).toBe("/customers/acct-42");
    // The lane that wrote this test asserted the broken value was still present, and asked
    // for the assertion to be revisited if opportunity.js were ever fixed. It has been:
    // the stale route is gone at the source, so the row is non-focusable because nothing
    // declares a route, not because a consumer stripped one.
    expect(opportunityRelatedList.rowNavigationTo ?? null).toBeNull();
  });

  it("now part of the wired MAIN subset AccountDetail.jsx actually renders — in accountPage.js's own order, ahead of financials", () => {
    const wiredIds = accountRecordPageMainSubset.sections.map((s) => s.id);
    expect(wiredIds).toEqual(["opportunities", "salesOrders", "financials", "activityAndNotes", "serviceActivity"]);
  });

  // H-A11 — before this fix, neither section declared `label`, so makeSection defaulted it
  // to null: no <h3> heading rendered at all, and MetadataRecordPage's aria-label fallback
  // was `section.label ?? section.kind` — IDENTICAL for both sections ("RELATED_LIST"),
  // making them indistinguishable to a screen-reader user despite sitting in the same MAIN
  // column. This is the assertion the prior test file (this one) never made — no test here
  // ever checked for a heading or an accessible name — which is exactly why the regression
  // shipped silently when these replaced AccountOpportunitiesSection.jsx's `<h4>Opportunities</h4>`
  // and AccountSalesOrdersSection.jsx's `<h4>Sales Orders</h4>`.
  it("H-A11: Opportunities and Sales Orders each render a real, distinct, meaningful accessible name — never the generic \"RELATED_LIST\" kind", async () => {
    fetchCallablePageMock.mockResolvedValue({ rows: [], hasMore: false, nextCursorDoc: null });
    const bothSections = {
      ...accountRecordPage,
      sections: accountRecordPage.sections.filter((s) => s.id === "opportunities" || s.id === "salesOrders"),
    };
    render(
      <MemoryRouter>
        <MetadataRecordPage
          definition={bothSections}
          record={{ id: "acct-42" }}
          capabilityDecisions={{ "opportunity.read": true, "salesOrder.read": true }}
          listResolver={accountPageListResolver}
          entityResolver={accountPageEntityResolver}
        />
      </MemoryRouter>
    );
    // Wait for both related lists to settle so their empty-state copy is present too.
    await screen.findByText(/no opportunities yet/i);
    await screen.findByText(/no sales orders yet/i);

    // Each section is a distinctly-named accessible region — getByRole throws if a name is
    // missing, ambiguous, or shared, so this alone would fail against the pre-fix null label.
    const opportunitiesRegion = screen.getByRole("region", { name: "Opportunities" });
    const salesOrdersRegion = screen.getByRole("region", { name: "Sales Orders" });
    expect(opportunitiesRegion).not.toBe(salesOrdersRegion);

    // A visible heading renders for each — not just an aria-label with no on-screen text.
    expect(screen.getByRole("heading", { name: "Opportunities" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sales Orders" })).toBeTruthy();

    // The regression's exact symptom: the generic section KIND must never surface as an
    // accessible name, for either section.
    expect(screen.queryByRole("region", { name: "RELATED_LIST" })).toBeNull();
    expect(document.body.textContent).not.toContain("RELATED_LIST");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A-ACCOUNT-WIRE-CONTACTS-LOCATIONS — contacts / locations RELATED_LIST WIRED
// (X-RELATED-LIST-ACTIONS, #1211, unblocked this). Two layers of proof, matching the
// altitude each concern actually lives at:
//
//   1. buildAccountRelatedListPresentation, unit-level, against the REAL contact.js /
//      location.js definitions — the presentation-building step itself: human-meaningful
//      cells, no document id, the Location address-flattening and Contact isPrimary fixes
//      the WIRING SCOPE note in accountPageComponents.js documents, and the
//      DENIED/UNAVAILABLE/EMPTY three-way distinction (with the hook's own real error text
//      preserved for test/accountDetailFailClosed.test.jsx's sake — an existing, out-of-scope
//      external contract this lane must not break).
//
//   2. A full AccountDetail.jsx render (mocked hooks, no Firebase/network — same technique
//      test/accountDetailFailClosed.test.jsx already uses) — the actual shipped wiring: the
//      section-level Add/Import affordances survive, and the post-create keyboard-focus
//      handoff this whole lane exists to prove still works end to end.
describe("buildAccountRelatedListPresentation — contacts / locations against the REAL definitions", () => {
  it("contacts: human-meaningful cells, never the document id, isPrimary renders through cellValue's BOOLEAN branch", () => {
    const presentation = buildAccountRelatedListPresentation({
      listId: "account.contacts",
      rows: [
        { id: "contact-doc-1", name: "Jane Doe", role: "Manager", email: "jane@example.com", phone: "555-1000", isPrimary: true, accountId: "acct-1" },
        { id: "contact-doc-2", name: "John Roe", role: null, email: null, phone: null, isPrimary: false, accountId: "acct-1" },
      ],
      loading: false,
      error: null,
    });
    expect(presentation.state).toBe("READY");
    expect(presentation.listId).toBe(contactRelatedList.id);
    const [row1, row2] = presentation.rows;
    // The document id routes the row (row.key) and never appears as a cell value.
    expect(row1.key).toBe("contact-doc-1");
    expect(row1.cells.some((c) => c.value === "contact-doc-1")).toBe(false);
    expect(row1.cells.find((c) => c.fieldId === "name").value).toBe("Jane Doe");
    // BOOLEAN true -> a real, visible string, not `true` (which React would render as nothing).
    expect(row1.cells.find((c) => c.fieldId === "isPrimary").value).toBe("Yes");
    // BOOLEAN false -> null (the grid's normal blank-cell case), not the literal `false`.
    // "No", not blank. A non-primary contact and a contact whose primary status was
    // never recorded are different claims, and a blank cell says neither.
    expect(row2.cells.find((c) => c.fieldId === "isPrimary").value).toBe("No");
  });

  it("locations: the stored `address` map is flattened to the declared flat fieldIds, never blank", () => {
    const presentation = buildAccountRelatedListPresentation({
      listId: "account.locations",
      rows: [
        {
          id: "location-doc-1",
          name: "Main Plant",
          accountId: "acct-1",
          address: { street: "1 Main St", city: "Springfield", state: "IL", zip: "62701" },
          accessNotes: "Use the loading dock.",
        },
      ],
      loading: false,
      error: null,
    });
    expect(presentation.state).toBe("READY");
    expect(presentation.listId).toBe(locationRelatedList.id);
    const [row] = presentation.rows;
    expect(row.key).toBe("location-doc-1");
    expect(row.cells.some((c) => c.value === "location-doc-1")).toBe(false);
    // Not blank — the exact regression a raw, unflattened row would produce (a nested
    // `address.city` never matches the flat `addressCity` fieldId cellValue() looks up).
    expect(row.cells.find((c) => c.fieldId === "addressCity").value).toBe("Springfield");
    expect(row.cells.find((c) => c.fieldId === "addressState").value).toBe("IL");
    expect(row.cells.find((c) => c.fieldId === "accessNotes").value).toBe("Use the loading dock.");
  });

  it("EMPTY, DENIED and UNAVAILABLE are three distinct states, not one collapsed error box", () => {
    const empty = buildAccountRelatedListPresentation({ listId: "account.contacts", rows: [], loading: false, error: null });
    const denied = buildAccountRelatedListPresentation({
      listId: "account.contacts",
      rows: [],
      loading: false,
      error: "You do not have permission to view these contacts.",
    });
    const unavailable = buildAccountRelatedListPresentation({
      listId: "account.contacts",
      rows: [],
      loading: false,
      error: "Couldn't load contacts. Please try again.",
    });
    expect(empty.state).toBe("EMPTY");
    expect(denied.state).toBe("DENIED");
    expect(unavailable.state).toBe("UNAVAILABLE");
    // The hook's own real error text survives verbatim — listPresentation.js's generic
    // emptyMessageFor() copy does NOT silently replace it (test/accountDetailFailClosed.test.jsx
    // asserts this exact string reaches the screen for a denied Contacts read).
    expect(denied.emptyMessage).toBe("You do not have permission to view these contacts.");
    expect(unavailable.emptyMessage).toBe("Couldn't load contacts. Please try again.");
    expect(empty.emptyMessage).toBe("No contacts yet.");
  });

  it("LOADING takes priority over any error or row data", () => {
    const presentation = buildAccountRelatedListPresentation({
      listId: "account.locations",
      rows: [],
      loading: true,
      error: null,
    });
    expect(presentation.state).toBe("LOADING");
  });
});

describe("accountRecordPageContactsLocationsSubset", () => {
  it("carries exactly contacts then locations, matching accountPage.js's own order (60, 70)", () => {
    expect(accountRecordPageContactsLocationsSubset.sections.map((s) => s.id)).toEqual(["contacts", "locations"]);
  });

  it("neither section declares a capabilityRequirement — contact.js/location.js both declare readCapability: null", () => {
    for (const section of accountRecordPageContactsLocationsSubset.sections) {
      expect(section.capabilityRequirement).toBeNull();
    }
  });
});

describe("AccountDetail.jsx — Contacts/Locations wired through the metadata list runtime (full render)", () => {
  const RESOLVED_ACCOUNT = {
    account: { id: "acct-1", name: "Acme Foods", relationshipTypes: [], lineOfBusiness: [] },
    loading: false,
    error: null,
    retry: vi.fn(),
  };

  function renderDetail() {
    return render(
      <MemoryRouter>
        <AccountDetail />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    componentRegistry.__resetForTest();
    registerAccountPageComponents();
    mockCreateContact.mockReset();
    mockCreateLocation.mockReset();
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
  });

  it("section-level '+ Add Contact' / 'Import Contacts' / '+ Add Location' affordances survive the metadata wiring", () => {
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    useLocationsForAccount.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    renderDetail();
    expect(screen.getByRole("button", { name: "+ Add contact" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add location" })).toBeTruthy();
  });

  it("denied Contacts read shows the hook's real error text, never the false 'No contacts yet' empty state (still true through the metadata path)", () => {
    useContactsForAccount.mockReturnValue({
      data: [],
      loading: false,
      error: "You do not have permission to view these contacts.",
    });
    useLocationsForAccount.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    renderDetail();
    expect(screen.getByText("You do not have permission to view these contacts.")).toBeTruthy();
    expect(screen.queryByText(/no contacts yet/i)).toBeNull();
  });

  it("account-scoped rows render with human-meaningful cells and never a document id", () => {
    useContactsForAccount.mockReturnValue({
      data: [{ id: "contact-1", name: "Jane Doe", role: "Manager", email: null, phone: null, isPrimary: false, accountId: "acct-1" }],
      loading: false,
      error: null,
    });
    useLocationsForAccount.mockReturnValue({
      data: [{ id: "location-1", name: "Main Plant", accountId: "acct-1", address: { street: "1 Main St", city: "Springfield", state: "IL", zip: "62701" } }],
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    renderDetail();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("Main Plant")).toBeTruthy();
    expect(screen.getByText("Springfield")).toBeTruthy();
    expect(screen.queryByText("contact-1")).toBeNull();
    expect(screen.queryByText("location-1")).toBeNull();
  });

  // THE LOAD-BEARING TEST — this whole lane exists to prove this still works. Would FAIL
  // (focus stranded on <body>, or never moved) without MetadataListGrid's
  // focusRowKey/onFocusHandled wired to AccountDetail's own pendingContactFocus, the exact
  // accessibility parity #1211/this lane's own instructions require before wiring at all.
  it("post-create focus parity: creating a Contact moves keyboard focus onto its new row once the live subscription delivers it", async () => {
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    useLocationsForAccount.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    mockCreateContact.mockResolvedValue({ id: "contact-new", name: "New Contact" });

    const { rerender } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "+ Add contact" }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "New Contact" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Contact" }));

    // The write resolved; AccountDetail queued focus onto "contact-new" -- but the live
    // subscription has not "delivered" the row yet (the mocked hook still returns []), so
    // MetadataListGrid's own effect has nothing to focus (see its "waits for the target row
    // to actually appear" contract, test/metadataListGrid.test.jsx).
    await waitFor(() => expect(mockCreateContact).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(document.body);

    // The live subscription now "delivers" the new row -- re-render the SAME component
    // instance (not a fresh mount, which would reset AccountDetail's own pendingContactFocus
    // state back to null) with the updated hook return value, exactly as a real onSnapshot
    // callback would trigger.
    useContactsForAccount.mockReturnValue({
      data: [{ id: "contact-new", name: "New Contact", role: null, email: null, phone: null, isPrimary: false, accountId: "acct-1" }],
      loading: false,
      error: null,
    });
    rerender(
      <MemoryRouter>
        <AccountDetail />
      </MemoryRouter>
    );

    // Focus itself is the parity proof this test exists for. (MetadataListGrid's own
    // focus-target tabIndex=-1 contract is asserted in isolation by
    // test/metadataListGrid.test.jsx; checked again here it would race against
    // onFocusHandled's own follow-on state update -- AccountDetail clears
    // pendingContactFocus once the handoff lands, same as the hand-rolled pattern this
    // replaces, which drops focusRowKey and therefore the row's -1 on the NEXT render.)
    await waitFor(() => {
      const row = screen.getByText("New Contact").closest("tr");
      expect(document.activeElement).toBe(row);
    });
  });

  it("post-create focus parity: creating a Location moves keyboard focus onto its new row once the live subscription delivers it", async () => {
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    useLocationsForAccount.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
    mockCreateLocation.mockResolvedValue({ id: "location-new", name: "New Site" });

    const { rerender } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "+ Add location" }));
    fireEvent.change(screen.getByLabelText(/site name/i), { target: { value: "New Site" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Location" }));

    await waitFor(() => expect(mockCreateLocation).toHaveBeenCalledTimes(1));

    useLocationsForAccount.mockReturnValue({
      data: [{ id: "location-new", name: "New Site", accountId: "acct-1", address: {} }],
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    rerender(
      <MemoryRouter>
        <AccountDetail />
      </MemoryRouter>
    );

    await waitFor(() => {
      const row = screen.getByText("New Site").closest("tr");
      expect(document.activeElement).toBe(row);
    });
  });
});
