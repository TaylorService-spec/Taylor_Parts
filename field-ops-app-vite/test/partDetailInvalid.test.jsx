// Issue #100 C1/C2 invalid-passthrough — RENDER gate for PartDetail (C2). Runs via `npm run test:components`
// (vitest + jsdom). Proves PartDetail passes fetchPartMasterList's `invalid` into the shared composer and,
// when the canonical read reports invalid (or malformed-invalid) documents, renders the BLOCKED detail
// message — showing neither canonical nor static detail and never raw invalid-document data. The shared
// composer + static catalog are REAL; only the Firebase-touching hooks, router, and heavy children are
// mocked. (PartDetail early-returns on the blocked branch, so the heavy READY body never mounts.)
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ transactions: [], healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useReorderRequests", () => ({ useReorderRequestForPart: () => ({ request: null, loading: false, error: null }) }));
vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: {}, loading: false }), resolveActorDisplayName: (id) => id }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0, startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn() }));
vi.mock("../src/domain/inventoryActions", () => ({ recordInventoryAction: vi.fn() }));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn(), voidPurchaseOrder: vi.fn() }));
vi.mock("../src/domain/workflowActionError", () => ({ workflowActionErrorMessage: () => "" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/modules/inventory/UsedInEquipmentSection", () => ({ default: () => null }));
vi.mock("../src/shared/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../src/shared/ui/form", () => ({ FormError: () => null }));
vi.mock("../src/shared/inventory/RequestReorderControl", () => ({ default: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ partId: "TST-9001" }), useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const BLOCKED_DETAIL = /could not be verified against the canonical source, so its details are not shown/i;

describe("PartDetail (C2) — invalid-passthrough fail-closed render", () => {
  it("canonical read with invalid documents => BLOCKED detail message; NO canonical/static detail, no raw invalid data", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }], invalid: [{ partId: "TST-9001", secretField: "raw-invalid-value", invalid: true }] });
    render(<PartDetail />);
    await screen.findByText(BLOCKED_DETAIL);
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(document.body.textContent.includes("raw-invalid-value")).toBe(false);
    expect(document.body.textContent.includes("secretField")).toBe(false);
  });

  it("malformed invalid metadata (non-array) also blocks the detail page (never a static-fallback page)", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }], invalid: "not-an-array" });
    render(<PartDetail />);
    await screen.findByText(BLOCKED_DETAIL);
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
  });
});
