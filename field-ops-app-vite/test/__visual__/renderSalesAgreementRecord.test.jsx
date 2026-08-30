// VISUAL HARNESS — renders the real Sales Agreement RECORD page to a static file. Not an assertion
// suite. Mock shapes mirror test/salesAgreementNorthStarPage.test.jsx's own mountWith(), which
// drives the page through the real view/absence derivation rather than a hand-built view object.
// Skipped unless VISUAL=1.

import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../src/hooks/useSalesAgreementById.js", () => ({ useSalesAgreementById: vi.fn() }));
vi.mock("../../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    loading: false, error: null,
    byEmployeeId: new Map([["emp_ramado", { displayName: "R. Amado" }]]),
    byUserId: new Map([["uid_actor_9f2c", { displayName: "R. Amado" }]]),
  }),
}));
vi.mock("../../src/hooks/useAccountNames.js", () => ({
  useAccountNamesWithStatus: () => ({
    names: new Map([["acct_desert_sun", "Desert Sun Beverage Co."]]), status: "READY",
  }),
  ACCOUNT_NAMES_STATUS: { READY: "READY", DENIED: "DENIED", ERROR: "ERROR", LOADING: "LOADING" },
}));

const { default: SalesAgreementDetail } = await import("../../src/modules/sales/SalesAgreementDetail.jsx");
const { useSalesAgreementById } = await import("../../src/hooks/useSalesAgreementById.js");
const { salesAgreementView } = await import("../../src/domain/salesAgreementView.js");
const { salesAgreementAbsence, SALES_AGREEMENT_READ_MODE } = await import("../../src/domain/salesAgreementRead.js");

const ID = "MHc7xk2QpLbR9vTn4sYe";
const ACCEPTED_AT = 1_755_542_460_000;
const L1 = { lineId: "ln-1", kind: "EQUIPMENT_MODEL", ref: "TAY-C712", quantity: 2, unitPriceMinor: 980000, extendedMinor: 1960000, condition: "NEW", warranty: "12 mo parts & labour", estimatedArrivalMillis: null };
const L2 = { lineId: "ln-2", kind: "PART", ref: "X49463-3", quantity: 12, unitPriceMinor: 17500, extendedMinor: 210000, condition: "NEW", warranty: null, estimatedArrivalMillis: null };

beforeEach(() => { vi.clearAllMocks(); });

describe.skipIf(!process.env.VISUAL)("visual harness — agreement", () => {
  it("writes the agreement page to a static page", () => {
    const lines = [L1, L2];
    const subtotalMinor = lines.reduce((n, l) => n + l.extendedMinor, 0);
    const totalMinor = subtotalMinor + 60000 + 25000 + 164605;
    const result = {
      status: "ready",
      salesAgreement: {
        id: ID, salesAgreementNumber: "SA-2026-000003", state: "ACCEPTED",
        accountId: "acct_desert_sun", ownerEmployeeId: "emp_ramado", locationId: "loc_broadway",
        currency: "USD", customerPO: "PO-88231", isLease: false, fulfillmentIntent: "BOTH",
        shippingInstructions: "Loading dock, 22nd St entrance.", shipVia: "Taylor truck",
        specialInstructions: "Commission both freezers on the same visit.",
        sourceOpportunityId: "opp_1842",
        // An order EXISTS, so the header's new order fact renders — the link that used to live in
        // the removed "What this agreement became" section.
        salesOrderId: "so_doc_15", salesOrderNumber: "SO-2026-000015",
        acceptedAtMillis: ACCEPTED_AT, acceptedByUid: "uid_actor_9f2c",
        lines, subtotalMinor, shippingMinor: 60000, installChargeMinor: 25000, taxMinor: 164605,
        totalMinor, downPaymentMinor: 500000, tradeInMinor: 150000, balanceMinor: totalMinor - 650000,
      },
    };
    const view = salesAgreementView({ result, loading: false, errorStatus: null });
    useSalesAgreementById.mockReturnValue({
      view,
      absence: salesAgreementAbsence(view, SALES_AGREEMENT_READ_MODE.BY_ID),
      readMode: SALES_AGREEMENT_READ_MODE.BY_ID,
      STATE: {},
      updateDraft: vi.fn(), accept: vi.fn(), pending: null,
      commandError: null, clearCommandError: vi.fn(), refresh: vi.fn(),
    });

    const { container } = render(
      <MemoryRouter initialEntries={[`/customers/opportunities/sales-agreement/${ID}`]}>
        <Routes>
          <Route
            path="/customers/opportunities/sales-agreement/:salesAgreementId"
            element={<SalesAgreementDetail hasCapability={() => true} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
    const out = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sales Agreement record — rendered</title>
<style>${css}</style>
<body class="fo-app">${container.innerHTML}</body>`;
    fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", "sales-agreement-record.rendered.html"), out);
  });
});
