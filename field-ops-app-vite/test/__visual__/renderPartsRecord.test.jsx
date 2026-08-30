// VISUAL HARNESS — renders the real Parts RECORD page to a static file. Not an assertion suite.
//
// Companion to the Opportunity and Sales Agreement harnesses: the real component with the real
// stylesheet, so a composition can be compared against its design artifact without a dev server and
// without anybody handing credentials to a tool.
//
// It drives the page through the REAL buildPartDetailView derivation — the canonical read is mocked
// at fetchPartMasterList, exactly as the page's own suites mock it, so the composition on screen is
// the one the page actually produces. A hand-built view object would render the page's honest error
// state, which is the harness lying about the composition rather than showing it.
//
// Skipped unless VISUAL=1, so it never runs in CI or in the normal suite.

import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";

const DOC_ID = "TST-9001";

vi.mock("../../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: DOC_ID, name: "Compressor Assembly", category: "Refrigeration", unit: "each", cost: 2480, price: 3999, reorderThreshold: 2, warehouseQty: 3 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../../src/hooks/useInventoryLedger", () => ({
  useInventoryLedger: () => ({
    loading: false,
    error: null,
    transactions: [
      { id: "t1", partId: DOC_ID, workOrderId: "WO-2026-001241", type: "CONSUMED", quantity: 1, timestamp: 1_755_542_460_000 },
      { id: "t2", partId: DOC_ID, workOrderId: "WO-2026-001237", type: "RESERVED", quantity: 2, timestamp: 1_755_100_000_000 },
      { id: "t3", partId: DOC_ID, workOrderId: "WO-2026-001190", type: "RECEIVED", quantity: 3, timestamp: 1_754_000_000_000 },
    ],
    healthEntries: [
      {
        partId: DOC_ID,
        stock: { availableStock: 3 },
        usage: { avgDailyUsage: 0.4, totalConsumed: 12, daysObserved: 30 },
        recommendation: { urgency: "MEDIUM", reorderPoint: 2.4, recommendedOrderQty: 6.2, daysRemaining: 7.5 },
      },
    ],
  }),
}));
vi.mock("../../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequestForPart: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
    useReorderRequests: r, useReorderRequestsByStatus: r, useReorderRequestsByStatuses: r,
    useReorderRequestsAssignedTo: r, useReorderRequestsHistory: r, useReorderRequestById: r,
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: {}, loading: false }), resolveActorDisplayName: (id) => id }));
vi.mock("../../src/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [], loading: false }) }));
vi.mock("../../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: () => ({ loading: false, errorStatus: null, result: { manufacturers: [{ manufacturerId: "MFR-TAYLOR", name: "Taylor Company", status: "ACTIVE" }] } }),
}));
// A Parts Manager session: the reorder control is eligible, so the harness shows the composition an
// authorised reader actually sees rather than one with its primary control silently absent.
vi.mock("../../src/auth/AuthContext", () => ({
  useAuth: () => ({
    user: { uid: "u1" },
    role: "PARTS_MANAGER",
    operationalRoles: ["PARTS_MANAGER"],
    hasCapability: () => false,
    accessVersion: 1,
  }),
}));
vi.mock("../../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0, startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn() }));
vi.mock("../../src/domain/inventoryActions", () => ({ recordInventoryAction: vi.fn() }));
vi.mock("../../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn(), voidPurchaseOrder: vi.fn() }));

const { default: PartDetail } = await import("../../src/modules/inventory/PartDetail.jsx");
const { fetchPartMasterList } = await import("../../src/services/partMasterQueries");

// The canonical Part, as toPartView produces it. internalPartNumber is deliberately UNLIKE the
// document id, so the rendered page shows which one reached the title.
const CANONICAL = {
  invalid: false,
  partId: DOC_ID,
  internalPartNumber: "C712-COMP",
  name: "Compressor Assembly",
  description: "Compressor Assembly, Taylor C712",
  category: "Refrigeration",
  status: "ACTIVE",
  stockingUnit: "EACH",
  controlType: "SERIALIZED",
  stockingClass: "STOCKED",
  manufacturerId: "MFR-TAYLOR",
  manufacturerPartNumber: "047-712-88",
  oemStatus: "OEM",
  version: 3,
};

beforeEach(() => { vi.clearAllMocks(); });

describe.skipIf(!process.env.VISUAL)("visual harness — Parts record", () => {
  it("writes the part record to a static page", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: [CANONICAL], invalid: [] });

    const { container, findByRole } = render(
      <MemoryRouter initialEntries={[`/inventory/${DOC_ID}`]}>
        <Routes>
          <Route path="/inventory/:partId" element={<PartDetail hasCapability={() => false} accessVersion={1} />} />
        </Routes>
      </MemoryRouter>,
    );
    await findByRole("heading", { level: 1 });

    const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
    const out = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parts record — rendered</title>
<style>${css}</style>
<body class="fo-app">${container.innerHTML}</body>`;
    fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", "parts-record.rendered.html"), out);
  });
});
