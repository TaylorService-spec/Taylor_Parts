// THE SALES AGREEMENTS INDEX -- the client surface for Owner ruling D (Wave 16 / Lane BQ).
//
// MOVED HERE, AS LANE BQ ASKED. These assertions were written into
// test/salesAgreementNorthStarPage.test.jsx -- a RECORD-page suite -- for one reason, recorded in
// that file's header: test/ciSuiteCoverage.test.mjs refuses a vitest suite that no workflow names,
// its KNOWN_UNNAMED allowlist is shrink-only, and the lane that built the index was not permitted
// to edit .github/workflows. The Phase 3 integration is, so this file now exists and
// composition-conformance-tests.yml names it beside its three siblings. Nothing else changed: the
// eleven assertions below, their helpers and their literals are the ones lane BQ wrote.
//
// The screen closes the server catalog's last DESTINATION gap, and the thing most worth pinning
// about it is not that it can draw a table. It is that it draws FOUR DIFFERENT KINDS OF NOTHING and
// never confuses them:
//
//   EMPTY        the governed read succeeded and this company has no Sales Agreements. This is the
//                state the screen actually ships in -- eos_commercial.sales_agreements is empty in
//                nonprod (C5 unexecuted, the twelve synthetic records deleted 2026-09-23) -- so it
//                is asserted first and hardest. It must NEVER be produced by a failure.
//   REFUSED      the caller does not hold salesAgreement.read. A fact, with no retry offered,
//                because retrying cannot change it.
//   UNAVAILABLE  the transport could not answer. Retryable, and visibly not a permission decision.
//   LOADING      nothing has arrived. Not a refusal.
//
// THE REAL TRANSPORT SEAM IS DRIVEN IN EVERY CASE -- an injected `fetchImpl` and `getIdToken`,
// through the real callCommercialApi and the real salesAgreementIndexView -- never a hand-written
// view object. That is the discipline test/dataImportSurfaceAccess.test.jsx records: a stub happily
// answers questions the real path never asks.
//
// NOTHING IS SEEDED. Every row below is a literal in this file, handed back through the transport as
// a server answer. No Commercial record is created anywhere by this suite.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SalesAgreementsList from "../src/modules/sales/SalesAgreementsList.jsx";
import { commercialApiClient, callCommercialApi } from "../src/services/commercialApiClient.js";
import * as firestoreEraAgreementClient from "../src/services/salesAgreementCommandClient.js";

// THE FIRESTORE-ERA AGREEMENT AUTHORITY, AS A LITERAL. Every Agreement write today (create,
// updateDraft, accept) is a Firebase callable into Firestore `sales_agreements`, and the record page
// reads back through getSalesAgreementContext. This mock stands in for that authority HOLDING an
// agreement, so the index's answer can be compared against where Agreements actually live.
vi.mock("../src/services/salesAgreementCommandClient.js", () => {
  const held = { id: "sa-fs-1", salesAgreementNumber: "SA-2026-000007", state: "ACCEPTED", sourceOpportunityId: "opp-1" };
  return {
    createSalesAgreement: vi.fn(async () => ({ errorStatus: "unimplemented" })),
    updateSalesAgreementDraft: vi.fn(async () => ({ errorStatus: "unimplemented" })),
    acceptSalesAgreement: vi.fn(async () => ({ errorStatus: "unimplemented" })),
    getSalesAgreementContext: vi.fn(async ({ salesAgreementId }) => (salesAgreementId === held.id
      ? { result: { status: "ready", salesAgreement: held } }
      : { result: { status: "not-found" } })),
    getSalesAgreementForOpportunity: vi.fn(async ({ opportunityId }) => (opportunityId === held.sourceOpportunityId
      ? { result: { status: "ready", salesAgreement: held } }
      : { result: { status: "not-found" } })),
    searchProductReferences: vi.fn(async () => ({ result: { items: [] } })),
  };
});

const indexClientAnswering = ({ status = 200, body, fail = false }) => ({
  call: (operation, options = {}) => callCommercialApi(operation, {
    ...options,
    baseUrl: "https://eos-api.example",
    getIdToken: async () => "token",
    fetchImpl: async () => {
      if (fail) throw new Error("offline");
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  }),
});

const renderIndex = (client) => render(
  <MemoryRouter>
    <SalesAgreementsList client={client} />
  </MemoryRouter>,
);

const INDEX_ROW = Object.freeze({
  id: "sa-1",
  salesAgreementNumber: "SA-2026-000041",
  accountId: "acct-1",
  accountName: "Riverside Grocers",
  state: "ACCEPTED",
  currency: "USD",
  totals: { totalMinor: 125000 },
});

describe("the Sales Agreements index states its answer honestly", () => {
  it("renders the workspace identity whatever the read says", async () => {
    renderIndex(indexClientAnswering({ body: { ok: true, result: { items: [], truncated: false } } }));
    expect(await screen.findByText("Sales Agreements")).toBeTruthy();
  });

  it("EMPTY: a successful read with no rows says there are none, and offers no retry", async () => {
    // Post-cutover semantics (lane S3): "none exist" is only true once the list reads the store
    // Agreements are written to. Today's default is covered by THE AUTHORITY SPLIT block below.
    render(
      <MemoryRouter>
        <SalesAgreementsList
          client={indexClientAnswering({ body: { ok: true, result: { items: [], truncated: false, nextCursor: null } } })}
          writeAuthority="POSTGRES"
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No Sales Agreements exist for this company yet/)).toBeTruthy();
    // An empty list is not a failure, so there is nothing to retry and nothing is offered...
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    // ...and no table is drawn over nothing.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("REFUSED: a 403 names the capability and never reads as 'there are none'", async () => {
    renderIndex(indexClientAnswering({
      status: 403,
      body: { ok: false, operation: "listSalesAgreements", code: "CAPABILITY_REQUIRED", message: "nope" },
    }));
    expect(await screen.findByText(/does not hold it/)).toBeTruthy();
    expect(screen.queryByText(/No Sales Agreements exist/)).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("UNAVAILABLE: an unreachable service is retryable and says it is not a permission decision", async () => {
    renderIndex(indexClientAnswering({ fail: true }));
    expect(await screen.findByText(/not a permission decision/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(screen.queryByText(/No Sales Agreements exist/)).toBeNull();
  });

  it("UNAVAILABLE: a success envelope this bundle cannot read is a fault, not an empty company", async () => {
    renderIndex(indexClientAnswering({ body: { ok: true, result: { rows: [] } } }));
    expect(await screen.findByText(/not a permission decision/)).toBeTruthy();
    expect(screen.queryByText(/No Sales Agreements exist/)).toBeNull();
  });

  it("READY: rows render with the customer's NAME, the state label and the committed total", async () => {
    renderIndex(indexClientAnswering({ body: { ok: true, result: { items: [INDEX_ROW], truncated: false } } }));
    expect(await screen.findByText("SA-2026-000041")).toBeTruthy();
    expect(screen.getByText("Riverside Grocers")).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.getByText("USD 1250.00")).toBeTruthy();
  });

  it("an unpriced agreement says 'Not priced' -- NULL IS NOT ZERO and is not a blank cell", async () => {
    renderIndex(indexClientAnswering({
      body: { ok: true, result: { items: [{ ...INDEX_ROW, totals: { totalMinor: null } }], truncated: false } },
    }));
    expect(await screen.findByText("Not priced")).toBeTruthy();
    expect(screen.queryByText(/USD 0/)).toBeNull();
  });

  it("an unresolvable customer says so rather than printing a document id", async () => {
    renderIndex(indexClientAnswering({
      body: { ok: true, result: { items: [{ ...INDEX_ROW, accountName: null }], truncated: false } },
    }));
    expect(await screen.findByText("Unresolved customer")).toBeTruthy();
    // A routing key is not content. The account id must not appear as the customer.
    expect(screen.queryByText("acct-1")).toBeNull();
  });

  it("a truncated page says so rather than implying completeness", async () => {
    renderIndex(indexClientAnswering({ body: { ok: true, result: { items: [INDEX_ROW], truncated: true } } }));
    expect(await screen.findByText(/More Sales Agreements exist than are shown/)).toBeTruthy();
  });

  it("NO CREATE ACTION: an Agreement is created from an Opportunity, not from this index", async () => {
    renderIndex(indexClientAnswering({ body: { ok: true, result: { items: [INDEX_ROW], truncated: false } } }));
    await screen.findByText("SA-2026-000041");
    // A disabled "New agreement" would describe a permission boundary; the truth is that creation
    // belongs to another object entirely.
    expect(screen.queryByRole("button", { name: /new (sales )?agreement/i })).toBeNull();
  });

  it("the production default seam is the real Commercial transport, not an injected stub", () => {
    expect(typeof commercialApiClient.call).toBe("function");
  });
});

// ════════════════════ THE AUTHORITY SPLIT (lane S3) ════════════════════
//
// The index reads PostgreSQL (POST /commercial/sales -> eos_commercial.sales_agreements); every
// Agreement write goes to Firestore through Firebase callables. Until the Commercial writer is cut
// over (C5 copy + C6 writer), an EMPTY PostgreSQL answer is a fact about an un-migrated table, not
// about the business -- and the screen must not present it as an empty portfolio.
describe("the Sales Agreements index does not claim an empty portfolio while Agreements are written elsewhere", () => {
  const pgEmpty = () => indexClientAnswering({ body: { ok: true, result: { items: [], truncated: false, nextCursor: null } } });

  it("PG answers [] while the Firestore-era authority holds an agreement: NO 'none exist' claim", async () => {
    // The Firestore-era authority really does hold one -- proven through the same client the record
    // page and the Opportunity card use.
    const held = await firestoreEraAgreementClient.getSalesAgreementForOpportunity({ opportunityId: "opp-1" });
    expect(held.result.status).toBe("ready");

    renderIndex(pgEmpty());
    expect(await screen.findByText(/not yet listed here/i)).toBeTruthy();
    expect(screen.queryByText(/No Sales Agreements exist/)).toBeNull();
    // It points at where Agreements actually are, and draws no table over nothing.
    expect(screen.getByText(/Opportunity/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    // No retry: retrying the PostgreSQL read cannot change the answer before the writer moves.
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("NO NEW AUTHORITY: the index never reads the Firestore-era callables to fill itself", async () => {
    vi.mocked(firestoreEraAgreementClient.getSalesAgreementContext).mockClear();
    vi.mocked(firestoreEraAgreementClient.getSalesAgreementForOpportunity).mockClear();
    renderIndex(pgEmpty());
    await screen.findByText(/not yet listed here/i);
    expect(firestoreEraAgreementClient.getSalesAgreementContext).not.toHaveBeenCalled();
    expect(firestoreEraAgreementClient.getSalesAgreementForOpportunity).not.toHaveBeenCalled();
  });

  it("rows PG does return are shown, but never as the complete portfolio", async () => {
    renderIndex(indexClientAnswering({ body: { ok: true, result: { items: [INDEX_ROW], truncated: false } } }));
    expect(await screen.findByText("SA-2026-000041")).toBeTruthy();
    expect(screen.getByText(/not the complete list/i)).toBeTruthy();
  });

  it("AFTER THE WRITER MOVES to PostgreSQL, an empty answer is a true EMPTY again", async () => {
    render(
      <MemoryRouter>
        <SalesAgreementsList client={pgEmpty()} writeAuthority="POSTGRES" />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No Sales Agreements exist for this company yet/)).toBeTruthy();
    expect(screen.queryByText(/not yet listed here/i)).toBeNull();
    expect(screen.queryByText(/not the complete list/i)).toBeNull();
  });
});
