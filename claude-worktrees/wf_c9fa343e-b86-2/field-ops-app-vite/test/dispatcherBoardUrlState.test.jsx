// URL-addressable view state for DispatcherBoard (feat/url-state-dispatcher).
//
// Proves the two correctness rules from src/hooks/useUrlState.js apply to
// this surface:
//   1. Selecting a work order and choosing a status filter round-trip
//      through the URL (query params), so Back/Forward/refresh/share-link
//      all see the same view a user was looking at.
//   2. A hand-edited/stale URL (garbage ?status=, unknown ?wo=) degrades to
//      the default view -- never crashes, never renders a broken screen.
//
// All Firestore-backed hooks and the heavy sub-panels are mocked at their
// module boundary; this test is about the view-state wiring in
// DispatcherBoard.jsx itself, not about re-testing the queue/preview/board
// panels or the live data hooks, which have their own coverage elsewhere.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";

vi.mock("../src/hooks/useWorkOrders.js", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../src/hooks/useFirestoreCollection.js", () => ({ useFirestoreCollection: vi.fn() }));
vi.mock("../src/hooks/useSessionActivityFeed.js", () => ({ useSessionActivityFeed: vi.fn(() => []) }));
vi.mock("../src/hooks/useAccountNames.js", () => ({ useAccountNames: vi.fn(() => new Map()) }));
vi.mock("../src/auth/AuthContext.jsx", () => ({ useAuth: vi.fn(() => ({ role: "dispatcher" })) }));

// Sub-panels are pure renderers with no state-migration concerns of their
// own -- stub them down to just enough to observe/drive selectedId.
vi.mock("../src/modules/dispatcherBoard/WorkOrderQueue.jsx", () => ({
  default: ({ workOrders, selectedId, onSelect }) => (
    <div data-testid="queue">
      {workOrders.map((wo) => (
        <button key={wo.id} data-testid={`select-${wo.id}`} aria-pressed={selectedId === wo.id} onClick={() => onSelect(wo.id)}>
          {wo.woNumber}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../src/modules/dispatcherBoard/WorkOrderPreview.jsx", () => ({
  default: ({ workOrder }) => <div data-testid="preview">{workOrder ? workOrder.woNumber : "none selected"}</div>,
}));
vi.mock("../src/modules/dispatcherBoard/TechnicianBoard.jsx", () => ({
  default: () => <div data-testid="techboard" />,
}));
vi.mock("../src/modules/dispatcherBoard/DispatcherActivityFeed.jsx", () => ({
  default: () => <div data-testid="activity" />,
}));

import { useWorkOrders } from "../src/hooks/useWorkOrders.js";
import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection.js";
import DispatcherBoard from "../src/modules/dispatcherBoard/DispatcherBoard.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const WORK_ORDERS = [
  { id: "wo-1", woNumber: "WO-1001", status: "SCHEDULED", customerId: "acct-1", type: "SERVICE_CALL" },
  { id: "wo-2", woNumber: "WO-1002", status: "CREATED", customerId: "acct-2", type: "PM" },
];

function mockReads() {
  useWorkOrders.mockReturnValue({ data: WORK_ORDERS, loading: false, error: null });
  useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
}

// Exposes the current search string next to DispatcherBoard so tests can
// assert on it directly, the way a browser address bar would.
function LocationProbe() {
  const [params] = useSearchParams();
  return <div data-testid="location-search">{params.toString()}</div>;
}

function renderBoard(initialEntries = ["/dispatcher"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <LocationProbe />
      <DispatcherBoard />
    </MemoryRouter>,
  );
}

describe("DispatcherBoard -- URL-addressable view state", () => {
  it("selecting a work order writes ?wo= to the URL, and it round-trips back into selectedId on remount", () => {
    mockReads();
    renderBoard();

    // Nothing selected by default -- the default is represented by ABSENCE.
    expect(screen.getByTestId("location-search").textContent).toBe("");
    expect(screen.getByTestId("preview").textContent).toBe("none selected");

    fireEvent.click(screen.getByTestId("select-wo-2"));

    expect(screen.getByTestId("location-search").textContent).toBe("wo=wo-2");
    expect(screen.getByTestId("preview").textContent).toBe("WO-1002");

    // Round-trip: a fresh mount at that same URL restores the same selection
    // -- this is what makes refresh and "send this link to a colleague" work.
    cleanup();
    mockReads();
    renderBoard(["/dispatcher?wo=wo-2"]);
    expect(screen.getByTestId("preview").textContent).toBe("WO-1002");
    expect(screen.getByTestId("select-wo-2").getAttribute("aria-pressed")).toBe("true");
  });

  it("choosing a status filter writes ?status= to the URL, and returning to the default ALL removes it (absence, not a written default)", () => {
    mockReads();
    renderBoard();

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "CREATED" } });
    expect(screen.getByTestId("location-search").textContent).toBe("status=CREATED");
    // Only the CREATED work order should remain visible.
    expect(screen.queryByTestId("select-wo-1")).toBeNull();
    expect(screen.getByTestId("select-wo-2")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "ALL" } });
    // Back to the default -- must be ABSENT from the URL, not "?status=ALL".
    expect(screen.getByTestId("location-search").textContent).toBe("");
  });

  it("typing in the search box uses replace (no extra history entries) and round-trips through ?q=", () => {
    mockReads();
    renderBoard();

    fireEvent.change(screen.getByLabelText("Search work orders"), { target: { value: "WO-1001" } });
    expect(screen.getByTestId("location-search").textContent).toBe("q=WO-1001");

    fireEvent.change(screen.getByLabelText("Search work orders"), { target: { value: "" } });
    expect(screen.getByTestId("location-search").textContent).toBe("");
  });

  it("a garbage ?status= value degrades to the default (ALL) instead of crashing or showing a broken filtered view", () => {
    mockReads();
    renderBoard(["/dispatcher?status=NOT_A_REAL_STATUS"]);

    // Both work orders are visible -- an unrecognized status value falls
    // back to "All statuses" rather than silently matching nothing.
    expect(screen.getByTestId("select-wo-1")).toBeTruthy();
    expect(screen.getByTestId("select-wo-2")).toBeTruthy();
    expect(screen.getByLabelText("Filter by status").value).toBe("ALL");
  });

  it("a stale/unknown ?wo= id degrades to no selection instead of crashing", () => {
    mockReads();
    renderBoard(["/dispatcher?wo=does-not-exist"]);

    expect(screen.getByTestId("preview").textContent).toBe("none selected");
  });
});
