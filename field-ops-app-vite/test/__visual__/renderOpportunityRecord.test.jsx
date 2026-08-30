// VISUAL HARNESS — renders the real Opportunity RECORD page to a static file, the same way
// renderOpportunityCollection.test.jsx does for the collection. Not an assertion suite.
//
// The hook shapes below mirror test/opportunityNorthStarPage.test.jsx's own mount() exactly — an
// approximated shape renders the page's honest error state, which is the harness lying about the
// composition rather than showing it. Skipped unless VISUAL=1.

import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../src/hooks/useOpportunity.js", () => ({ useOpportunity: vi.fn() }));
vi.mock("../../src/hooks/useSalesAgreement.js", () => ({ useSalesAgreement: vi.fn() }));
vi.mock("../../src/hooks/useOpportunitySectionSave.js", () => ({ useOpportunitySectionSave: vi.fn() }));
vi.mock("../../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    loading: false,
    byUserId: new Map(),
    byEmployeeId: new Map([["EMP-3", { displayName: "R. Amado" }]]),
  }),
}));

const { default: OpportunityDetail } = await import("../../src/modules/sales/OpportunityDetail.jsx");
const { useOpportunity } = await import("../../src/hooks/useOpportunity.js");
const { useSalesAgreement } = await import("../../src/hooks/useSalesAgreement.js");
const { useOpportunitySectionSave } = await import("../../src/hooks/useOpportunitySectionSave.js");

const NOW = Date.now();
const DAY = 86_400_000;

beforeEach(() => {
  useOpportunitySectionSave.mockReturnValue({
    pending: {}, outcome: null, saveSection: vi.fn(), clearOutcome: vi.fn(),
  });
});

describe.skipIf(!process.env.VISUAL)("visual harness — record", () => {
  it("writes the record page to a static page", () => {
    useOpportunity.mockReturnValue({
      loading: false,
      errorStatus: null,
      refetch: vi.fn(),
      result: {
        status: "ready",
        accountName: "Desert Sun Beverage Co.",
        salesOrderNumber: "SO-2026-000014",
        opportunity: {
          id: "opp_doc", opportunityNumber: "OPP-2026-000041", name: null,
          accountId: "acct_1", salesChannel: "NATIONAL_ACCOUNTS", ownerEmployeeId: "EMP-3",
          stage: "QUOTING", outcome: null,
          need: "Second commissary build-out — soft serve and shake capacity.",
          expectedValue: 41000, expectedCloseAt: NOW + 30 * DAY,
          nextAction: "Call M. Delgado after their board meeting.",
          lines: [{ kind: "MODEL", ref: "Taylor C712", qty: 2 }, { kind: "PART", ref: "PRT-1005", qty: 1 }],
          salesOrderId: "so_doc_9", salesAgreementId: "agr_doc_5",
          createdAtMillis: NOW - 47 * DAY, updatedAtMillis: NOW - DAY, closedAtMillis: null,
        },
      },
    });
    useSalesAgreement.mockReturnValue({
      view: {
        kind: "READY", id: "agr_doc_5", salesAgreementNumber: "SA-2026-000012", state: "ACCEPTED",
        currency: "USD", totalMinor: 953000, salesOrderId: null, acceptedAtMillis: NOW - 2 * DAY,
        lines: [{ kind: "PART", ref: "PRT-1005", quantity: 1, unitPriceMinor: 953000 }],
      },
      refresh: vi.fn(), create: vi.fn(), updateDraft: vi.fn(), accept: vi.fn(),
      pending: {}, commandError: null, clearCommandError: vi.fn(),
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/customers/opportunities/opp_doc"]}>
        <Routes>
          <Route
            path="/customers/opportunities/:opportunityId"
            element={<OpportunityDetail readiness={{ enabled: true, reason: null }} hasCapability={() => true} actionDeps={{ client: {} }} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
    const out = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opportunity record — rendered</title>
<style>${css}</style>
<body class="fo-app">${container.innerHTML}</body>`;
    fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", "opportunity-record.rendered.html"), out);
  });
});
