// SALES AGREEMENT LINEAGE, BOTH DIRECTIONS — PR 5.
//
//     Opportunity  →  Sales Agreement  →  Sales Order
//
// The agreement gained its own address in PR 3 (DECISIONS #134). Two neighbours were still pointing
// somewhere else: the Opportunity card linked to the workspace pane, because no per-agreement route
// existed when it was written, and the Sales Order computed its agreement edge and rendered nothing.
// This suite asserts the chain now navigates in both directions and that nothing about IDENTITY
// changed while it did.
//
// The rule under test everywhere: a document id may be a ROUTE KEY and may never be visible
// business identity (DECISIONS #106, R03). ND-9 still stands — a Sales Agreement has no resolvable
// reference from a Sales Order — so the back-link is navigable without becoming resolvable.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpportunityAgreementCard from "../src/modules/sales/OpportunityAgreementCard.jsx";
import SalesAgreementDetail from "../src/modules/sales/SalesAgreementDetail.jsx";
import { useSalesAgreementById } from "../src/hooks/useSalesAgreementById.js";
import { salesAgreementView } from "../src/domain/salesAgreementView.js";
import { salesOrderLineage, EDGE } from "../src/domain/salesOrderNorthStar.js";

vi.mock("../src/hooks/useSalesAgreementById.js", () => ({ useSalesAgreementById: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ loading: false, error: null, byEmployeeId: new Map(), byUserId: new Map() }),
}));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  useAccountNamesWithStatus: () => ({ names: new Map([["acct_1", "Desert Sun Beverage Co."]]), status: "READY" }),
  ACCOUNT_NAMES_STATUS: { READY: "READY", DENIED: "DENIED", ERROR: "ERROR", LOADING: "LOADING" },
}));

const AGREEMENT_DOC_ID = "MHc7xk2QpLbR9vTn4sYe";
const OPPORTUNITY_DOC_ID = "opp_doc_7f3a";
const ORDER_DOC_ID = "so_doc_11b2";
const ROUTE = `/customers/opportunities/sales-agreement/${AGREEMENT_DOC_ID}`;

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, "../src", p), "utf8");

function agreementProjection(overrides = {}) {
  return {
    status: "ready",
    salesAgreement: {
      id: AGREEMENT_DOC_ID, salesAgreementNumber: "SA-2026-000003", state: "DRAFT",
      accountId: "acct_1", ownerEmployeeId: "emp_1", locationId: "loc_1", currency: "USD",
      customerPO: "PO-88231", isLease: false, fulfillmentIntent: "BOTH",
      shippingInstructions: null, shipVia: null, specialInstructions: null,
      lines: [{ lineId: "ln-1", kind: "PART", ref: "X49463-3", quantity: 2, unitPriceMinor: 17500, extendedMinor: 35000, condition: null, warranty: null, estimatedArrivalMillis: null }],
      subtotalMinor: 35000, shippingMinor: 0, installChargeMinor: 0, taxMinor: 0, totalMinor: 35000,
      downPaymentMinor: 0, tradeInMinor: 0, balanceMinor: 35000,
      sourceOpportunityId: OPPORTUNITY_DOC_ID, salesOrderId: null,
      acceptedAtMillis: null, acceptedByUid: null,
      ...overrides,
    },
  };
}

const links = () => screen.queryAllByRole("link").map((a) => a.getAttribute("href"));

beforeEach(() => { vi.clearAllMocks(); });

// ═════════════════════════════════════════ 1–4. OPPORTUNITY → SALES AGREEMENT

describe("Opportunity → Sales Agreement", () => {
  function mountCard({ view }) {
    return render(
      <MemoryRouter>
        <OpportunityAgreementCard
          agreement={{ view, refresh: vi.fn() }}
          opportunityId={OPPORTUNITY_DOC_ID}
          hasCapability={() => true}
        />
      </MemoryRouter>,
    );
  }

  it("exposes navigation to the first-class Agreement record", () => {
    mountCard({ view: salesAgreementView({ result: agreementProjection(), loading: false, errorStatus: null }) });
    expect(links()).toContain(ROUTE);
    expect(screen.getByRole("link", { name: "View agreement" }).getAttribute("href")).toBe(ROUTE);
  });

  it("uses the governed human-readable identity as the link text", () => {
    mountCard({ view: salesAgreementView({ result: agreementProjection(), loading: false, errorStatus: null }) });
    expect(screen.getByRole("link", { name: "SA-2026-000003" })).toBeTruthy();
  });

  it("does not fabricate an Agreement when the Opportunity has none", () => {
    mountCard({ view: salesAgreementView({ result: { status: "not-found", salesAgreement: null }, loading: false, errorStatus: null }) });
    expect(document.body.textContent).toContain("No sales agreement associated.");
    expect(links()).not.toContain(ROUTE);
    expect(links().some((h) => h?.includes("sales-agreement"))).toBe(false);
  });

  it("never shows the Agreement document id as visible identity", () => {
    mountCard({ view: salesAgreementView({ result: agreementProjection(), loading: false, errorStatus: null }) });
    // The id is the route KEY — permitted in the href, forbidden in the text.
    expect(links()).toContain(ROUTE);
    expect(document.body.textContent).not.toContain(AGREEMENT_DOC_ID);
  });

  it("falls back to the truthful generic label, still never the id, when unnumbered", () => {
    mountCard({ view: salesAgreementView({ result: agreementProjection({ salesAgreementNumber: null }), loading: false, errorStatus: null }) });
    expect(screen.getByRole("link", { name: "Sales Agreement" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(AGREEMENT_DOC_ID);
  });
});

// ═════════════════════════════════════════ 5–8. SALES ORDER → SALES AGREEMENT

describe("Sales Order → Sales Agreement", () => {
  // The edge is the domain's; this asserts the contract the page renders from, plus the page's own
  // rendering rule at the source level — mounting SalesOrderDetail would pull in its whole read.
  const page = src("modules/sales/SalesOrderDetail.jsx");

  it("computes a navigable edge when sourceAgreementId is present", () => {
    const [, agreement] = salesOrderLineage({ sourceOpportunityId: null, sourceAgreementId: AGREEMENT_DOC_ID });
    expect(agreement.key).toBe("agreement");
    expect(agreement.state).toBe(EDGE.UNRESOLVED);
    expect(agreement.targetId).toBe(AGREEMENT_DOC_ID);
    // ND-9 still stands: navigable, not resolvable. No reference is invented.
    expect(agreement.reference).toBeUndefined();
  });

  it("does not fabricate provenance when there is no source agreement", () => {
    const [, agreement] = salesOrderLineage({ sourceOpportunityId: null, sourceAgreementId: null });
    expect(agreement.state).toBe(EDGE.ABSENT);
    expect(agreement.targetId).toBeUndefined();
    // And the page renders the row only for an UNRESOLVED edge carrying a target.
    expect(page).toMatch(/agreementEdge\?\.state === EDGE\.UNRESOLVED && agreementEdge\.targetId/);
  });

  it("routes the back-link to the approved Sales Agreement address", () => {
    expect(page).toMatch(/\/customers\/opportunities\/sales-agreement\/\$\{encodeURIComponent\(agreementEdge\.targetId\)\}/);
  });

  it("labels the back-link with honest neutral wording, never the raw id", () => {
    // The link TEXT is a phrase. targetId appears twice in source — the render guard and the route
    // key — and in neither position does it reach the reader.
    expect(page).toMatch(/>\s*the sales agreement\s*</);
    const provenance = page.slice(page.indexOf("COMMERCIAL PROVENANCE"), page.indexOf("ns-record-body"));
    expect(provenance).toMatch(/encodeURIComponent\(agreementEdge\.targetId\)/);
    // Never interpolated as content: no bare {agreementEdge.targetId} in a text position.
    expect(provenance).not.toMatch(/>\s*\{agreementEdge\.targetId\}/);
    expect(provenance).not.toMatch(/\{agreementEdge\.targetId\}\s*</);
  });

  it("presents it as commercial provenance rather than as a lifecycle stage", () => {
    expect(page).toMatch(/Priced from/);
    expect(page).toMatch(/the commercial commitment these lines and prices came from/);
  });
});

// ═════════════════════════════════════════ 9–12. THE AGREEMENT'S OWN EDGES

describe("Sales Agreement → upstream and downstream", () => {
  function mountAgreement(overrides) {
    const view = salesAgreementView({ result: agreementProjection(overrides), loading: false, errorStatus: null });
    useSalesAgreementById.mockReturnValue({
      view, absence: null, readMode: "BY_ID", refresh: vi.fn(),
      updateDraft: vi.fn(), accept: vi.fn(), pending: null, commandError: null, clearCommandError: vi.fn(), STATE: {},
    });
    return render(
      <MemoryRouter initialEntries={[ROUTE]}>
        <Routes>
          <Route path="/customers/opportunities/sales-agreement/:salesAgreementId"
            element={<SalesAgreementDetail hasCapability={() => true} />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("still resolves the upstream Opportunity link", () => {
    mountAgreement();
    expect(links()).toContain(`/customers/opportunities/${OPPORTUNITY_DOC_ID}`);
  });

  it("still resolves the downstream Sales Order link when one exists", () => {
    mountAgreement({ state: "ACCEPTED", acceptedAtMillis: 1_755_542_460_000, acceptedByUid: "uid_a", salesOrderId: ORDER_DOC_ID });
    expect(links()).toContain(`/customers/opportunities/sales-order/${ORDER_DOC_ID}`);
  });

  it("keeps the accepted/no-order state honest", () => {
    mountAgreement({ state: "ACCEPTED", acceptedAtMillis: 1_755_542_460_000, acceptedByUid: "uid_a", salesOrderId: null });
    expect(document.body.textContent).toContain("No Sales Order.");
    expect(links().some((h) => h?.includes("sales-order"))).toBe(false);
  });

  it("never describes acceptance as directly creating the Sales Order", () => {
    mountAgreement({ state: "ACCEPTED", acceptedAtMillis: 1_755_542_460_000, acceptedByUid: "uid_a", salesOrderId: null });
    const body = document.body.textContent;
    // The governed sequence: accepted -> the Opportunity's close-as-won -> validation -> order.
    expect(body).toContain("closed as won");
    expect(body).toContain("requires this agreement to be accepted first");
    expect(body).not.toMatch(/accept(ing|ance)? (will|automatically) creates?/i);
    expect(body).not.toMatch(/creates the sales order/i);
  });
});

// ═════════════════════════════════════════ 13–15. THE FENCES

describe("nothing else moved", () => {
  const card = src("modules/sales/OpportunityAgreementCard.jsx");
  const order = src("modules/sales/SalesOrderDetail.jsx");
  const detail = src("modules/sales/SalesAgreementDetail.jsx");
  const app = src("App.jsx");

  it("introduces no alternate or duplicate Agreement route", () => {
    // Counted by ELEMENT, not by path spelling. An alias route need not contain the literal
    // "sales-agreement" — `opportunities/agreement/:id` would be a duplicate address that a
    // path-shaped assertion cannot see. This was found by mutation proof, not by review.
    const mounts = app.match(/<Route[^>]*element=\{<SalesAgreementDetailConnected \/>\}/g) ?? [];
    expect(mounts.length).toBe(1);
    const declarations = app.match(/path="[^"]*sales-agreement[^"]*"/g) ?? [];
    expect(declarations).toEqual(['path="opportunities/sales-agreement/:salesAgreementId"']);
    // No redirect, alias or Navigate wired to the agreement address.
    expect(app).not.toMatch(/<Navigate[^>]*sales-agreement/);
    expect(app).not.toMatch(/<Navigate[^>]*SalesAgreement/);
  });

  it("every lineage link points at the one approved address", () => {
    // Only ROUTE usages. A comment naming docs/north-star/sales-agreement/ is not a link, and an
    // assertion that could not tell the difference would fail on its own documentation.
    for (const file of [card, order, detail]) {
      const routes = file.match(/\/customers\/opportunities\/sales-agreement[^`"'\s)]*/g) ?? [];
      for (const route of routes) {
        expect(route.startsWith("/customers/opportunities/sales-agreement/")).toBe(true);
      }
    }
    expect(card).toMatch(/\/customers\/opportunities\/sales-agreement\//);
    expect(order).toMatch(/\/customers\/opportunities\/sales-agreement\//);
  });

  it("adds no line-pricing or editing behaviour", () => {
    for (const file of [card, order]) {
      for (const banned of [/ProductReferencePicker/, /unitPriceMinor\s*=/, /LineEditor/, /priceLine/]) {
        expect(file).not.toMatch(banned);
      }
    }
  });

  it("introduces no SA-G2–SA-G6 behaviour", () => {
    for (const file of [card, order, detail]) {
      for (const banned of [/declineSalesAgreement/, /reviseSalesAgreement/, /supersede/i, /sendToCustomer/, /agreementIndex/]) {
        expect(file).not.toMatch(banned);
      }
    }
  });

  it("changes no backend authority from these surfaces", () => {
    for (const file of [card, order, detail]) {
      expect(file).not.toMatch(/firebase\/firestore/);
      expect(file).not.toMatch(/httpsCallable/);
    }
  });
});
