// VISUAL HARNESS — renders the real Parts WORKSPACE to a static file, so Frame 1a can be compared
// against the design artifact without a dev server and without anybody handing credentials to a tool.
//
// Companion to renderPartsRecord.test.jsx. It exists because the Parts Catalog panel was offered for
// Owner acceptance once without anybody looking at it first, and the comparison failed on sight.
//
// Skipped unless VISUAL=1.
import { describe, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

const DOC = (n) => `CW-P-000${n}`;

vi.mock("../../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: DOC(0), name: "Evaporator Fan Motor", category: "Refrigeration", unit: "each", cost: 1, price: 2, reorderThreshold: 1, warehouseQty: 3 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../../src/hooks/useInventoryLedger", () => ({
  useInventoryLedger: () => ({ transactions: [], healthEntries: [], loading: false, error: null }),
}));
vi.mock("../../src/hooks/useReorderRequests", () => {
  const empty = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    // One live reorder request, so the Attention column has something governed to say.
    useReorderRequests: () => ({
      data: [{ id: "rr-1", partId: "CW-P-0002", status: "PENDING_REVIEW", createdAt: 1_755_000_000_000 }],
      loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null,
    }),
    useReorderRequestsByStatus: empty, useReorderRequestsByStatuses: empty,
    useReorderRequestsAssignedTo: empty, useReorderRequestsHistory: empty, useReorderRequestById: empty,
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: {}, loading: false }), resolveActorDisplayName: (id) => id }));
vi.mock("../../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: () => ({ loading: false, errorStatus: null, result: { manufacturers: [{ manufacturerId: "MFR-TAYLOR", name: "Taylor Company", status: "ACTIVE" }] } }),
}));
vi.mock("../../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0 }));
vi.mock("../../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "u1" }, role: "PARTS_MANAGER", operationalRoles: ["PARTS_MANAGER"], accessVersion: 1 }),
}));
vi.mock("../../src/shared/search/GlobalSearch", () => ({ default: () => null }));
vi.mock("../../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => <a href="#p">{children}</a> };
});

const { default: PartsList } = await import("../../src/modules/inventory/PartsList.jsx");
const { fetchPartMasterList } = await import("../../src/services/partMasterQueries");

// Canonical parts as toPartView produces them. One SERIALIZED and one manufacturer-bearing row, so
// the Control and Manufacturer columns show a value rather than only their honest absences.
const PARTS = [
  { invalid: false, partId: DOC(0), internalPartNumber: DOC(0), name: "Evaporator Fan Motor", description: "", category: "Refrigeration", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", manufacturerId: null, manufacturerPartNumber: null, oemStatus: null, version: 1 },
  { invalid: false, partId: DOC(1), internalPartNumber: DOC(1), name: "Condenser Fan Blade", description: "", category: "Refrigeration", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", manufacturerId: "MFR-TAYLOR", manufacturerPartNumber: "047-1", oemStatus: "OEM", version: 1 },
  { invalid: false, partId: DOC(2), internalPartNumber: DOC(2), name: "Expansion Valve", description: "", category: "Refrigeration", status: "ACTIVE", stockingUnit: "EACH", controlType: "SERIALIZED", stockingClass: "STOCKED", manufacturerId: null, manufacturerPartNumber: null, oemStatus: null, version: 1 },
  { invalid: false, partId: DOC(3), internalPartNumber: DOC(3), name: "Refrigerant Filter Drier", description: "", category: "Seals & Gaskets", status: "SUPERSEDED", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", manufacturerId: null, manufacturerPartNumber: null, oemStatus: null, version: 1 },
];

beforeEach(() => { vi.clearAllMocks(); });

describe.skipIf(!process.env.VISUAL)("visual harness — Parts workspace (Frame 1a)", () => {
  it("writes the workspace to a static page", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: PARTS, invalid: [] });
    const { container, findByRole } = render(<PartsList accessVersion={1} />);
    // Waited on by its own contract rather than by a heading the design is free to rename —
    // "Parts Catalog" was exactly such a heading, and it is gone now that the catalogue leads the
    // page and wears the page's title.
    await findByRole("table");
    await waitFor(() => {
      if (!container.querySelector("[data-parts-catalog]")) throw new Error("catalogue not rendered");
    });

    const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
    const out = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parts workspace — rendered</title>
<style>${css}</style>
<body class="fo-app">${container.innerHTML}</body>`;
    fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", "parts-workspace.rendered.html"), out);
  });
});
