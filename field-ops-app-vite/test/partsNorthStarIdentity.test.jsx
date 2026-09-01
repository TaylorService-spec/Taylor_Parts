// Parts North Star P1 — the three identity corrections, at the render.
//
// ND-26 (Owner, 2026-08-30) made internalPartNumber the human-facing Part Number and left partId as
// the immutable document/routing key, and authorised three presentation fixes. Each had the same
// shape: a component read a key the projection does not carry, so a value silently never arrived and
// the page fell back to something that looked plausible. Nothing failed; the wrong thing rendered.
//
// The projection contract is proved in test/partsNorthStarProjection.test.mjs. This suite proves the
// three RENDERS, because a widened projection that no component reads fixes nothing.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "Static Name", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ transactions: [], healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequestForPart: () => ({ data: null, request: null, loading: false, error: null, refresh: () => {} }),
    useReorderRequests: r, useReorderRequestsByStatus: r, useReorderRequestsByStatuses: r,
    useReorderRequestsAssignedTo: r, useReorderRequestsHistory: r, useReorderRequestById: r,
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: {}, loading: false }), resolveActorDisplayName: (id) => id }));
vi.mock("../src/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [], loading: false }) }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0, startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn() }));
vi.mock("../src/domain/inventoryActions", () => ({ recordInventoryAction: vi.fn() }));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn(), voidPurchaseOrder: vi.fn() }));
vi.mock("../src/domain/workflowActionError", () => ({ workflowActionErrorMessage: () => "" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, hasCapability: () => false, accessVersion: 1 }) }));
vi.mock("../src/modules/inventory/UsedInEquipmentSection", () => ({ default: () => null }));
vi.mock("../src/modules/inventory/PartWorkOrderDemandSection", () => ({ default: () => null }));
vi.mock("../src/shared/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../src/shared/inventory/RequestReorderControl", () => ({ default: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("../src/shared/supplier/SupplierPicker", () => ({ default: () => null }));
vi.mock("../src/shared/partMaster/PartWriteModal.jsx", () => ({ default: () => null }));
vi.mock("../src/shared/search/GlobalSearch", () => ({ default: () => null }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));
vi.mock("../src/shared/ui/FilterBar", () => ({ default: () => null }));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));

// The identifiers section is REAL nowhere else in these tests, so it is stubbed to a probe that
// reports exactly the prop under test. Rendering the real section would prove its own honest
// unavailable state, not what it was told the part is called.
vi.mock("../src/shared/partMaster/PartIdentifiersSection.jsx", () => ({
  default: ({ partNumber }) => <div data-testid="identifiers-label">{partNumber ?? "UNDEFINED"}</div>,
}));

vi.mock("../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: () => ({
    loading: false,
    errorStatus: null,
    result: { manufacturers: [{ manufacturerId: "MFR-TAYLOR", name: "Taylor Company", status: "ACTIVE" }] },
  }),
}));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useParams: () => ({ partId: "TST-9001" }),
    useSearchParams: () => [new URLSearchParams(), () => {}],
    Link: ({ children }) => children,
  };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsList from "../src/modules/inventory/PartsList.jsx";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// A canonical row as toPartView now produces it: the document key and the business Part Number are
// deliberately DIFFERENT strings, which is the only way a test can tell which one rendered.
const CANONICAL = {
  invalid: false,
  partId: "TST-9001",
  internalPartNumber: "X49463-3",
  name: "Scraper Blade Kit",
  description: "Scraper Blade Kit, C7xx series",
  category: "Valves",
  status: "ACTIVE",
  stockingUnit: "EACH",
  controlType: "STANDARD",
  stockingClass: "STOCKED",
  manufacturerId: "MFR-TAYLOR",
  manufacturerPartNumber: "047-712-88",
  oemStatus: "OEM",
  version: 1,
};

// FRAME 1a (ND-30) MOVED THIS. There is no longer a separate "Part Number" column: the number is
// the PRIMARY line of the Part cell with the description beneath it, which is Frame 1a’s own
// arrangement. The assertion is unchanged in substance -- the cell must hold internalPartNumber and
// never the document key -- only where it looks has moved.
function partCell() {
  return document.querySelector('[data-label="Part"]');
}

describe("ND-26 — the Parts workspace stops printing the document id under 'Part Number'", () => {
  it("the Part Number cell holds internalPartNumber, not the document key", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: [CANONICAL], invalid: [] });
    render(<PartsList />);
    // A SUBSTRING MATCHER, because P1v2 folded the manufacturer into this line (Owner ruling 6/W7:
    // the Manufacturer column read "Not recorded" on 25 of 25 rows and spent 194px doing it). The
    // description is no longer the whole of its element's text, so an exact match would now be
    // asserting the composition rather than the identity this test is about.
    await screen.findByText(/Scraper Blade Kit/);

    const cell = partCell();
    expect(cell).not.toBeNull();
    expect(cell.textContent).toContain("X49463-3");
    // The regression this replaces: the same cell rendered part.sku, which IS the document id
    // (toPartView requires partId === docId).
    expect(cell.textContent).not.toContain("TST-9001");
  });

  it("a row with no canonical document says so rather than substituting the key", async () => {
    // TST-1047 is an approved STATIC_ONLY_EXCLUDED sku: a real row, with no canonical Part behind
    // it and therefore no Part Number. Falling back to the key here would restore the defect for
    // exactly the rows most likely to mislead.
    vi.doMock("../src/data/partsCatalog", () => ({
      PARTS_CATALOG: [{ sku: "TST-1047", name: "Excluded Part", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
      getCatalogItem: () => undefined,
    }));
    vi.resetModules();
    const { default: FreshPartsList } = await import("../src/modules/inventory/PartsList.jsx");
    const { fetchPartMasterList: freshFetch } = await import("../src/services/partMasterQueries");
    freshFetch.mockResolvedValue({ ok: true, parts: [], invalid: [] });

    render(<FreshPartsList />);
    await screen.findByText("Excluded Part");

    const cell = partCell();
    expect(cell.textContent).toContain("Part Number not recorded");
    expect(cell.textContent).not.toContain("TST-1047");
  });
});

describe("the two values that never arrived", () => {
  it("the Manufacturer row renders, and resolves the id to the governed NAME", async () => {
    // It could not render at all before: the row was gated on canonicalPart?.manufacturerId, a key
    // the projection did not carry, whose stored name is primaryManufacturerId anyway.
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: [CANONICAL], invalid: [] });
    render(<PartDetail />);
    // findAllByText: P1v2 states the manufacturer in BOTH the identity line and the Part information
    // band, which the Owner ruled intentional on 2026-08-31 — recognition and master-data summary
    // are two readings of the same part. The claim under test is unaffected: the label renders at
    // all (it could not before — the row was gated on a key the projection never carried), the NAME
    // resolves, and the raw id reaches the reader nowhere on the page.
    const labels = await screen.findAllByText("Manufacturer");
    expect(labels.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Taylor Company").length).toBeGreaterThan(0);
    // The raw id is not the reader's business once a name resolves.
    expect(document.body.textContent).not.toContain("MFR-TAYLOR");
  });

  it("the identifiers section is labelled with the Part Number, not the document id", async () => {
    // The prop was canonicalPart?.partNumber — a name the projection has never used — so the
    // section's own `partNumber || partId` fallback silently labelled it with the key.
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: [CANONICAL], invalid: [] });
    render(<PartDetail />);
    const label = await screen.findByTestId("identifiers-label");
    expect(label.textContent).toBe("X49463-3");
  });
});
