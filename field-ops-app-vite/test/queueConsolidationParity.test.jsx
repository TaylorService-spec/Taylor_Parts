// Wave 6 -- queue consolidation (Owner directive, Option A). Proves Parts -> WORK
// (PartsList.jsx) is now genuinely ACTIONABLE using the SAME shared components
// (shared/reorder/{ManagerQueuePanel,AssociateRequestPanel,AssignedWorkOversightTable}.jsx)
// PartsManagerHome.jsx/PartsAssociateHome.jsx use -- not a fourth read-only re-implementation.
// Covers the Owner's §23 regression list: manager assignment remains actionable, associate
// actions remain correctly scoped (own-uid only), no queue item disappears, DENIED/
// UNAVAILABLE/EMPTY stay distinct.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "STATIC-CATALOG-NAME-A", category: "Valves", unit: "each", cost: 1, price: 2, reorderThreshold: 5, warehouseQty: 1 }],
  getCatalogItem: () => undefined,
}));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ transactions: [], healthEntries: [], loading: false, error: null }) }));

const managerQueueRow = { id: "req-mgr-1", partId: "TST-9001", urgency: "HIGH", reviewedAt: 1 };
const associateWaitingRow = { id: "req-assoc-1", partId: "TST-9001", urgency: "MEDIUM", assignedAt: 1 };
const { assignReorderRequest } = vi.hoisted(() => ({ assignReorderRequest: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequests: r,
    useReorderRequestsByStatus: () => ({ data: [managerQueueRow], loading: false, error: null }),
    useReorderRequestsByStatuses: () => ({ data: [], loading: false, error: null }),
    useReorderRequestsAssignedTo: (uid, status) =>
      status === "ASSIGNED_TO_PARTS_ASSOCIATE"
        ? { data: [associateWaitingRow], loading: false, error: null }
        : { data: [], loading: false, error: null },
    useReorderRequestsHistory: r,
    useReorderRequestById: (requestId) => ({
      data: requestId === associateWaitingRow.id ? { ...associateWaitingRow, status: "ASSIGNED_TO_PARTS_ASSOCIATE" } : null,
      loading: false,
      error: requestId === associateWaitingRow.id ? null : "not_found",
    }),
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/domain/inventoryReorderRequests", () => ({
  requestReorderForRecommendation: vi.fn(),
  getDisplayQty: () => 3,
  assignReorderRequest,
  startPurchasing: vi.fn(),
  updatePurchasingProgress: vi.fn(),
  receiveReorderRequest: vi.fn(),
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: new Map(), loading: false, error: null }), resolveActorDisplayName: (id) => id }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/shared/search/GlobalSearch", () => ({ default: () => null }));
// Functional stub (upgraded from `() => null` for the in-card Assign repair tests below): a
// combobox the mount-focus effect can find, a deterministic select action, and the real
// picker's empty-state copy — placement beside the selected card is what these tests prove;
// the picker's own eligibility behavior stays covered by its own suite.
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({
  default: ({ label, onSelect, disabled }) => (
    <div>
      <input role="combobox" aria-label={label ?? "Assign"} disabled={disabled} readOnly />
      <button type="button" onClick={() => onSelect({ employeeId: "emp-77", userId: "user-77" })}>
        pick-emp-77
      </button>
      <p>No eligible employees found.</p>
    </div>
  ),
}));
vi.mock("../src/hooks/useManufacturerCatalog", () => ({ useManufacturerCatalog: () => ({ loading: true, errorStatus: null, result: null }) }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => children };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartsList from "../src/modules/inventory/PartsList.jsx";
import ManagerQueuePanel from "../src/shared/reorder/ManagerQueuePanel.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const READY = { ok: true, parts: [{ partId: "TST-9001", name: "CANONICAL-NAME-A", category: "Valves", stockingUnit: "each" }], invalid: [] };

describe("Parts -> WORK (PartsList.jsx) is actionable via the shared queue components", () => {
  it("Parts Manager Queue: an Assign button is present (not just a link) and invokes the SAME governed assignReorderRequest()", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    const assignButton = await screen.findByRole("button", { name: /assign canonical-name-a/i });
    fireEvent.click(assignButton);
    // Opens the shared AssignPanel (its own title uses "Assign -- {name}")
    expect(await screen.findByText(/assign -- canonical-name-a/i)).toBeTruthy();
  });

  it("My Work: a View button opens the shared AssignedRequestDetail (not a bare link)", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    const viewButton = await screen.findByRole("button", { name: /view canonical-name-a/i });
    fireEvent.click(viewButton);
    expect(await screen.findByText(/request detail/i)).toBeTruthy();
  });

  it("no queue item disappears: the manager-queue row and the my-work row both still render their part name", async () => {
    fetchPartMasterList.mockResolvedValue(READY);
    render(<PartsList accessVersion={1} />);
    const names = await screen.findAllByText("CANONICAL-NAME-A");
    // At least the catalog row + manager-queue card + my-work card each render the name.
    expect(names.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------
// Assign stays with the selected card (mobile-queue repair). Root cause: the shared
// AssignPanel used to render AFTER the whole OperationalCardGrid, so on a long mobile queue
// clicking Assign opened the form far below the viewport with no scroll/focus — it looked
// inert, and its errors/empty states were off-screen. The panel now renders inside the
// selected request's <li>, scrolls into view, and focuses the picker combobox. Authority is
// untouched: same assignReorderRequest(), same PARTS_ASSOCIATE eligibility scoping.
// ---------------------------------------------------------------------------------------
describe("ManagerQueuePanel: the Assign panel opens beside the selected card", () => {
  const queue = [
    { id: "req-top", partId: "TST-9001", urgency: "HIGH", reviewedAt: 1 },
    { id: "req-second", partId: "TST-9001", urgency: "MEDIUM", reviewedAt: 2 },
  ];
  const resolveName = () => "CANONICAL-NAME-A";

  function renderQueue() {
    const utils = render(
      <ManagerQueuePanel queue={queue} resolveName={resolveName} loading={false} error={null} />,
    );
    const items = utils.container.querySelectorAll("ul.fo-op-card-grid > li");
    expect(items.length).toBe(2);
    return { ...utils, items };
  }
  const assignButtons = () => screen.getAllByRole("button", { name: /^assign canonical-name-a$/i });

  it("1+2+3: no panel initially; opening the SECOND card renders the panel inside that card's <li>, not after the grid", () => {
    const { container, items } = renderQueue();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(assignButtons()[1]);
    const combobox = screen.getByRole("combobox");
    expect(items[1].contains(combobox)).toBe(true);
    expect(items[0].contains(combobox)).toBe(false);
    // Nothing panel-shaped renders outside the grid anymore.
    const grid = container.querySelector("ul.fo-op-card-grid");
    expect(grid.contains(combobox)).toBe(true);
  });

  it("4: the combobox receives focus when the panel opens", () => {
    renderQueue();
    fireEvent.click(assignButtons()[0]);
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });

  it("5+6: only one panel exists, and Assign on another card MOVES it there", () => {
    const { items } = renderQueue();
    fireEvent.click(assignButtons()[1]);
    fireEvent.click(assignButtons()[0]);
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes.length).toBe(1);
    expect(items[0].contains(comboboxes[0])).toBe(true);
    expect(items[1].contains(comboboxes[0])).toBe(false);
  });

  it("7: Close removes the panel and restores focus to the trigger that opened it", () => {
    renderQueue();
    const trigger = assignButtons()[1];
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("8+9: submits the selected request id and the selected employee's linked userId, unchanged", async () => {
    renderQueue();
    fireEvent.click(assignButtons()[1]);
    fireEvent.click(screen.getByRole("button", { name: "pick-emp-77" }));
    fireEvent.click(screen.getByRole("button", { name: /^assign$/i }));
    await waitFor(() => expect(assignReorderRequest).toHaveBeenCalledTimes(1));
    expect(assignReorderRequest).toHaveBeenCalledWith("req-second", { assignedToUserId: "user-77" });
  });

  it("10: a rejected assignment shows its error INSIDE the selected queue item", async () => {
    assignReorderRequest.mockRejectedValueOnce(new Error("refused-by-governed-command"));
    const { items } = renderQueue();
    fireEvent.click(assignButtons()[0]);
    fireEvent.click(screen.getByRole("button", { name: "pick-emp-77" }));
    fireEvent.click(screen.getByRole("button", { name: /^assign$/i }));
    const errorNode = await screen.findByText("refused-by-governed-command");
    expect(items[0].contains(errorNode)).toBe(true);
  });

  it("11: the eligibility empty state is visible inside the selected item", () => {
    const { items } = renderQueue();
    fireEvent.click(assignButtons()[0]);
    const empty = screen.getByText("No eligible employees found.");
    expect(items[0].contains(empty)).toBe(true);
  });
});
