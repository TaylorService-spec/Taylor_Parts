// OD-3 -- RENDER gate for PartsManagerHome canonical part-name resolution (vitest + jsdom,
// via `npm run test:components`). Proves the surface resolves reorder-request part names
// through the shared fail-closed governed path and, when the canonical read is
// invalid/denied/unavailable, degrades names to the raw partId (never the static-catalog
// name), shows a bounded inline notice, keeps the operational tables rendering, and never
// leaks raw invalid-document contents. Shared composer + static catalog are REAL; only the
// Firebase-touching hooks and heavy children are mocked.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const queueRow = [{ id: "r1", partId: "TST-9001", quantity: 3, urgency: "HIGH", reviewedAt: 1 }];
  return {
    useReorderRequestsByStatus: () => ({ data: queueRow, loading: false }),
    useReorderRequestsByStatuses: () => ({ data: [], loading: false, error: null }),
    useReviewedRequestsHistory: () => ({ data: [], loading: false, error: null }),
  };
});
vi.mock("../src/hooks/useAssignableEmployees", () => ({ useAssignableEmployees: () => ({ employees: [] }) }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ assignReorderRequest: vi.fn(), getDisplayQty: () => 3 }));
// Spy: capture the resolveName PartsManagerHome passes into its Inventory Health panel.
const capturedIHP = [];
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: ({ resolveName }) => { capturedIHP.push(resolveName); return null; } }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));
vi.mock("../src/modules/inventory/PartsList", () => ({ formatAssignmentAge: () => "1d", default: () => null }));

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsManagerHome from "../src/modules/inventoryRole/PartsManagerHome.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const NOTICE = /Some part names are unavailable; Part IDs are shown/i;
const canonicalOK = [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }];

describe("PartsManagerHome (OD-3) -- canonical name resolution, fail-closed", () => {
  it("READY: canonical name shown; static name NOT shown; no unavailable notice", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalOK, invalid: [] });
    render(<PartsManagerHome />);
    await screen.findByText("CANONICAL-NAME-A");
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
    // the Inventory Health panel mount receives the same canonical (fail-closed) resolver
    expect(capturedIHP[capturedIHP.length - 1]("TST-9001")).toBe("CANONICAL-NAME-A");
    expect(capturedIHP[capturedIHP.length - 1]("TST-0000-ABSENT")).toBe("TST-0000-ABSENT");
  });

  it("invalid canonical documents: names degrade to raw partId, queue table still renders, notice shown, no raw invalid leak, no static name", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: canonicalOK, invalid: [{ partId: "TST-9001", secretField: "raw-invalid-value" }] });
    render(<PartsManagerHome />);
    await screen.findByText(NOTICE);
    // operational table preserved: the queue row + its Assign action still render
    expect(screen.getByText("TST-9001")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Assign TST-9001/i })).toBeTruthy();
    // fail-closed name behavior
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
    expect(document.body.textContent.includes("raw-invalid-value")).toBe(false);
    expect(document.body.textContent.includes("secretField")).toBe(false);
  });

  it("permission-denied canonical read: names degrade to raw partId, table renders, notice shown", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: false, code: "permission-denied" });
    render(<PartsManagerHome />);
    await screen.findByText(NOTICE);
    expect(screen.getByText("TST-9001")).toBeTruthy();
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
    expect(screen.queryByText("STATIC-CATALOG-NAME-A")).toBeNull();
  });
});
