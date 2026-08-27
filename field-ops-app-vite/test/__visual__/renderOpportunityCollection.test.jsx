// VISUAL HARNESS — renders the real collection to a static file for side-by-side comparison
// against `docs/north-star/opportunity/Opportunity-North-Star-List-P1v4.dc.html`.
//
// Not an assertion suite. It exists because the dev server sits behind a real sign-in, and
// comparing a composition against its design artifact should not require anybody to hand credentials
// to a tool. This renders the SAME component with the SAME stylesheet over fixture data, so what
// lands in the output file is the product's own markup and CSS rather than a mock-up of it.
//
// Skipped unless VISUAL=1, so it never runs in CI or in the normal suite.

import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import OpportunityList from "../../src/modules/sales/OpportunityList.jsx";

const NOW = Date.parse("2026-08-27T12:00:00Z");
const DAY = 86_400_000;

const ROWS = [
  { id: "o1", opportunityNumber: "OPP-2026-001842", accountId: "a1", ownerEmployeeId: "e1",
    salesChannel: "NATIONAL_ACCOUNTS", stage: "DECISION", outcome: null,
    need: "Second commissary build-out", expectedValue: 41000, expectedCloseAt: NOW + 9 * DAY,
    nextAction: null, lines: [], salesAgreementId: "sa1", salesOrderId: "so1" },
  { id: "o2", opportunityNumber: "OPP-2026-001839", accountId: "a2", ownerEmployeeId: "e1",
    salesChannel: "RETAIL", stage: "QUOTING", outcome: null, need: "Shake line refresh",
    expectedValue: 18500, expectedCloseAt: NOW + 22 * DAY, nextAction: null, lines: [],
    salesAgreementId: "sa2", salesOrderId: null },
  { id: "o3", opportunityNumber: "OPP-2026-001833", accountId: "a3", ownerEmployeeId: "e2",
    salesChannel: "RETAIL", stage: "QUALIFYING", outcome: null, need: "Two-store expansion",
    expectedValue: 64200, expectedCloseAt: NOW - 6 * DAY, nextAction: "Site survey", lines: [],
    salesAgreementId: null, salesOrderId: null },
  { id: "o4", opportunityNumber: "OPP-2026-001828", accountId: "a4", ownerEmployeeId: "e2",
    salesChannel: "RETAIL", stage: "SOLUTION", outcome: null, need: "Warranty-plus service plan",
    expectedValue: 9800, expectedCloseAt: NOW + 36 * DAY, nextAction: "Draft proposal", lines: [],
    salesAgreementId: null, salesOrderId: null },
  { id: "o5", opportunityNumber: "OPP-2026-001824", accountId: "a5", ownerEmployeeId: null,
    salesChannel: "RETAIL", stage: "CUSTOMER_REVIEW", outcome: null,
    need: "Harbor Grill — soft serve pilot", expectedValue: 999999, expectedCloseAt: null,
    nextAction: null, lines: [], salesAgreementId: "sa3", salesOrderId: null },
  { id: "o6", opportunityNumber: null, accountId: "a6", ownerEmployeeId: "e2",
    salesChannel: "RETAIL", stage: "IDENTIFIED", outcome: null,
    need: "Ice cream cabinet replacement", expectedValue: null, expectedCloseAt: NOW + 79 * DAY,
    nextAction: "Qualify budget", lines: [], salesAgreementId: null, salesOrderId: null },
];

const NAMES = {
  a1: "Desert Sun Beverage Co.", a2: "Route 66 Frozen Custard",
  a3: "Sonoran Convenience Partners", a4: "Verde Valley Creamery",
  a5: "Harbor Grill Restaurant Group", // a6 intentionally absent — proves the unresolved state
};

const source = () => ({
  status: "ready", synthetic: false, opportunities: ROWS, accountNameById: NAMES, error: null,
});

describe.skipIf(!process.env.VISUAL)("visual harness", () => {
  it("writes the collection to a static page", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/customers/opportunities"]}>
        <OpportunityList source={source} readiness={{ enabled: true, reason: null }} />
      </MemoryRouter>,
    );
    const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
    const out = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opportunity collection — rendered</title>
<style>${css}</style>
<body class="fo-app">${container.innerHTML}</body>`;
    const dir = process.env.VISUAL_OUT || ".";
    fs.writeFileSync(path.join(dir, "opportunity-collection.rendered.html"), out);
  });
});
