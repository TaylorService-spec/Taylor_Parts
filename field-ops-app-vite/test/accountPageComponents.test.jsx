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
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { formatTimestamp } from "../src/domain/displayTimestamp.js";
import MetadataRecordPage from "../src/metadata/MetadataRecordPage.jsx";
import { componentRegistry } from "../src/metadata/registry.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import { accountEntity } from "../src/metadata/definitions/account.js";
import { opportunityEntity, opportunityRelatedList } from "../src/metadata/definitions/opportunity.js";
import { salesOrderEntity, salesOrderRelatedList } from "../src/metadata/definitions/salesOrder.js";
import {
  registerAccountPageComponents,
  accountPageComponentIds,
  accountRecordPageMainSubset,
  accountRecordPageSideSubset,
} from "../src/metadata/definitions/accountPageComponents.js";

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
      <MemoryRouter>
        <MetadataRecordPage
        definition={accountRecordPageMainSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": false, "crm.activity.read": false }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText(FIN_MARK)).toBeNull();
    expect(screen.queryByText(NOTES_MARK)).toBeNull();
    // The ungated section is unaffected by either denial.
    expect(screen.getByText(SERVICE_MARK)).toBeTruthy();
  });

  it("an explicit grant reveals the section, and only the section that capability covers", () => {
    render(
      <MemoryRouter>
        <MetadataRecordPage
        definition={accountRecordPageMainSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
        />
      </MemoryRouter>
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
      <MemoryRouter>
        <MetadataRecordPage
        definition={accountRecordPageSideSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
        />
      </MemoryRouter>
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
      <MemoryRouter>
        <MetadataRecordPage
        definition={accountRecordPageSideSubset}
        record={{ id: "acct-1" }}
        // Matches production's real, current state: finance.read is registered catalog-wide
        // active:false, so an empty decisions map is not a contrived edge case here — it is what
        // every viewer sees today.
        capabilityDecisions={{}}
        embedded
        />
      </MemoryRouter>
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
      <MemoryRouter>
        <MetadataRecordPage
        definition={accountRecordPageSideSubset}
        record={{ id: "acct-1" }}
        capabilityDecisions={{ "finance.read": true }}
        embedded
        />
      </MemoryRouter>
    );
    expect(screen.getByText(ATTENTION_MARK)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X-ACCOUNT-WIRE-CALLABLE-LISTS — opportunities / salesOrders RE-EVALUATED after commit
// 6c6480d8 closed the CALLABLE-readVia gap the earlier finding (above) named. These tests
// render the REAL "opportunities" / "salesOrders" sections straight off accountRecordPage
// (never test doubles) through the REAL DefaultRelatedList binding, against the REAL
// opportunity.js / salesOrder.js / account.js definitions — proving BOTH halves of the
// honest comparison this lane owes: (1) the CALLABLE gap really is closed (correct scope,
// real reference numbers, honest truncation, correct denied/absent behavior), and (2) two
// DIFFERENT, newly-found reasons still block wiring them in. See accountPageComponents.js's
// WIRING SCOPE note for the full narrative these tests lock in.
describe("opportunities / salesOrders RELATED_LIST — re-evaluated after the CALLABLE gap closed (6c6480d8)", () => {
  // Single-section subsets of the REAL accountRecordPage — not accountRecordPageMainSubset,
  // since that subset deliberately still excludes both (see the "not part of the wired MAIN
  // subset" test at the bottom of this block).
  const opportunitiesOnly = {
    ...accountRecordPage,
    sections: accountRecordPage.sections.filter((s) => s.id === "opportunities"),
  };
  const salesOrdersOnly = {
    ...accountRecordPage,
    sections: accountRecordPage.sections.filter((s) => s.id === "salesOrders"),
  };
  const listResolver = (id) =>
    ({ "account.opportunities": opportunityRelatedList, "account.salesOrders": salesOrderRelatedList }[id] ?? null);
  const entityResolver = (id) =>
    ({ account: accountEntity, opportunity: opportunityEntity, salesOrder: salesOrderEntity }[id] ?? null);

  beforeEach(() => {
    fetchPageMock.mockReset();
    fetchCallablePageMock.mockReset();
  });

  it("the CALLABLE gap really is closed: reads go through the callable source, correctly scoped to THIS account, never Firestore", async () => {
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
        listResolver={listResolver}
        entityResolver={entityResolver}
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
        listResolver={listResolver}
        entityResolver={entityResolver}
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
    // trigger by accident.
    const { container } = render(
      <MemoryRouter>
        <MetadataRecordPage
        definition={opportunitiesOnly}
        record={{ id: "acct-42" }}
        // Matches production's real, current state: opportunity.read/salesOrder.read are
        // registered catalog-wide active:false, so an empty decisions map is what every
        // current viewer sees, not a contrived edge case.
        capabilityDecisions={{}}
        listResolver={listResolver}
        entityResolver={entityResolver}
        embedded
        />
      </MemoryRouter>
    );
    // Absent, not an empty-list message ("No opportunities on this account.") and not a
    // rendered DENIED failure box either — the section-level gate excludes it from the plan
    // before either state could render. Never attempts the read.
    expect(container.textContent).not.toMatch(/no opportunities/i);
    expect(container.textContent).not.toMatch(/not available to you/i);
    expect(container.textContent).toBe("");
    expect(fetchCallablePageMock).not.toHaveBeenCalled();
  });

  it("BLOCKER 1 — opportunities' TIMESTAMP column (expectedCloseAt) renders the raw epoch-millisecond value, not a formatted date", async () => {
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
        listResolver={listResolver}
        entityResolver={entityResolver}
        />
      </MemoryRouter>
    );
    await screen.findByText("OPP-2026-000999");
    // Closed by the TIMESTAMP branch in listPresentation.js. Asserted as the ABSENCE of the
    // raw value rather than an exact formatted string: formatTimestamp is locale- and
    // timezone-dependent, so pinning "8/23/2025, 5:00:00 PM" would pass here and fail on a
    // machine set to another zone. What matters is that a machine value no longer reaches
    // a user.
    expect(screen.queryByText("1755993600000")).toBeNull();
    expect(formatTimestamp(1755993600000, { unknown: null })).toBeTruthy();
    expect(screen.getByText(formatTimestamp(1755993600000, { unknown: null }))).toBeTruthy();
  });

  it("BLOCKER 2 — salesOrders rows carry no link and no click handler: the real per-order route is unreachable from a wired section", async () => {
    fetchCallablePageMock.mockResolvedValue({
      rows: [{ id: "so-1", salesOrderNumber: "SO-2026-000045", state: "OPEN" }],
      hasMore: false,
      nextCursorDoc: null,
    });
    const { container } = render(
      <MemoryRouter>
        <MetadataRecordPage
        definition={salesOrdersOnly}
        record={{ id: "acct-42" }}
        capabilityDecisions={{ "salesOrder.read": true }}
        listResolver={listResolver}
        entityResolver={entityResolver}
        />
      </MemoryRouter>
    );
    const cell = await screen.findByText("SO-2026-000045");
    // Closed by DefaultRelatedList consuming `rowNavigationTo` (salesOrder.js declares
    // `/customers/opportunities/sales-order/:salesOrderId`). The row is now reachable, so
    // it carries a real keyboard affordance rather than being a dead cell.
    const row = cell.closest("tr");
    expect(row.getAttribute("tabindex")).not.toBeNull();
    // The document id may address the record, but it must never be readable AS content.
    expect(container.textContent).not.toMatch(/so-1/);
  });

  it("still not part of the wired MAIN subset AccountDetail.jsx actually renders — both stay hand-rendered", () => {
    const wiredIds = accountRecordPageMainSubset.sections.map((s) => s.id);
    expect(wiredIds).not.toContain("opportunities");
    expect(wiredIds).not.toContain("salesOrders");
  });
});
