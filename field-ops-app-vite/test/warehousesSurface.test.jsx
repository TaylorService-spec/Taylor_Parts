// Warehouses -- S-INV-WAREHOUSES, migrated onto the metadata list runtime.
//
// REGISTRATION_PENDING: this file is new and is not yet named in any
// .github/workflows/*.yml vitest invocation -- the metadata program's CI runs vitest
// files by explicit name, not by glob, so this suite will not run in CI until the
// integration lane adds it to a workflow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const listState = { presentation: null };
const retrySpy = vi.fn();
const loadMoreSpy = vi.fn();

vi.mock("../src/hooks/useMetadataList", () => ({
  useMetadataList: () => ({ presentation: listState.presentation, loadMore: loadMoreSpy, retry: retrySpy }),
}));
// Tripwire: if this surface ever reacquires the old hand-written hook (a second,
// independent live read of the same collection), this mock makes that regression fail
// loudly instead of silently passing.
const useWarehousesSpy = vi.fn();
vi.mock("../src/hooks/useWarehouses", () => ({ useWarehouses: useWarehousesSpy }));

const { default: Warehouses } = await import("../src/modules/inventory/Warehouses.jsx");

function listOf(rows, { hasMore = false } = {}) {
  return {
    listId: "warehouse.index",
    surface: "INDEX",
    state: rows.length ? "READY" : "EMPTY",
    columns: [
      { fieldId: "name", label: "Warehouse" },
      { fieldId: "location", label: "Location" },
      { fieldId: "status", label: "Status" },
    ],
    rows: rows.map((r) => ({
      key: r.id,
      cells: [
        { fieldId: "name", value: r.name ?? null },
        { fieldId: "location", value: r.location ?? null },
        { fieldId: "status", value: r.status ?? null },
      ],
    })),
    hasMore,
    viewAllListId: null,
    truncated: false,
    emptyMessage: "No warehouses yet.",
  };
}

function failure(state, emptyMessage) {
  return {
    listId: "warehouse.index",
    surface: "INDEX",
    state,
    columns: [
      { fieldId: "name", label: "Warehouse" },
      { fieldId: "location", label: "Location" },
      { fieldId: "status", label: "Status" },
    ],
    rows: [],
    hasMore: false,
    viewAllListId: null,
    truncated: false,
    emptyMessage,
  };
}

const renderPage = (props = {}) => render(<MemoryRouter><Warehouses {...props} /></MemoryRouter>);

beforeEach(() => {
  retrySpy.mockClear();
  loadMoreSpy.mockClear();
  useWarehousesSpy.mockClear();
  listState.presentation = listOf([{ id: "w1", name: "Main Warehouse", location: "123 Main St", status: "Active" }]);
});

describe("Warehouses surface", () => {
  it("renders rows through the metadata list runtime, not the old hand-written hook", () => {
    renderPage();
    expect(screen.getByText("Main Warehouse")).toBeTruthy();
    expect(screen.getByText("123 Main St")).toBeTruthy();
    expect(useWarehousesSpy).not.toHaveBeenCalled();
  });

  it("never renders a document id as visible cell content", () => {
    renderPage();
    expect(screen.queryByText("w1")).toBeNull();
  });

  it("an absent name renders blank, never the document id -- the fallback the old domain helper used to apply", () => {
    listState.presentation = listOf([{ id: "w2", name: null, location: "Bldg B", status: "ACTIVE_UNRECOGNIZED" }]);
    renderPage();
    expect(screen.queryByText("w2")).toBeNull();
  });

  it("EMPTY, DENIED and UNAVAILABLE are three distinct renderings", () => {
    listState.presentation = listOf([]);
    const { unmount: unmount1 } = renderPage();
    expect(screen.getByText(/nothing here yet/i)).toBeTruthy();
    unmount1();

    listState.presentation = failure("DENIED", "You do not have access to warehouses.");
    const { unmount: unmount2 } = renderPage();
    expect(screen.getByText(/not available to you/i)).toBeTruthy();
    expect(screen.queryByText(/nothing here yet/i)).toBeNull();
    unmount2();

    listState.presentation = failure("UNAVAILABLE", "Warehouses could not be loaded. Try again.");
    renderPage();
    expect(screen.getByText(/could not load/i)).toBeTruthy();
    expect(screen.queryByText(/not available to you/i)).toBeNull();
  });

  it("a client-side status filter with no matches renders FILTERED, distinct from EMPTY", () => {
    listState.presentation = listOf([{ id: "w1", name: "Main Warehouse", status: "Active" }]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /inactive/i }));
    expect(screen.getByText("No warehouses match this filter.")).toBeTruthy();
  });

  it("the ungoverned bucket is counted and disclosed, without a fabricated third status", () => {
    listState.presentation = listOf([
      { id: "w1", name: "Main Warehouse", status: "Active" },
      { id: "w2", name: "Old Depot", status: null },
    ]);
    renderPage();
    expect(screen.getByText(/1 warehouse has no governed status/i)).toBeTruthy();
  });

  it("hasMore qualifies the summary as loaded-so-far rather than asserting a hard total", () => {
    listState.presentation = listOf([{ id: "w1", name: "Main Warehouse", status: "Active" }], { hasMore: true });
    renderPage();
    expect(screen.getByText(/loaded so far/i)).toBeTruthy();
  });

  it("offers Load more when more rows exist, rather than silently truncating", () => {
    listState.presentation = listOf([{ id: "w1", name: "Main Warehouse", status: "Active" }], { hasMore: true });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(loadMoreSpy).toHaveBeenCalled();
  });

  it("re-runs the read when accessVersion changes, the inventory convention", () => {
    const { rerender } = render(
      <MemoryRouter>
        <Warehouses accessVersion={1} />
      </MemoryRouter>
    );
    expect(retrySpy).not.toHaveBeenCalled();
    rerender(
      <MemoryRouter>
        <Warehouses accessVersion={2} />
      </MemoryRouter>
    );
    expect(retrySpy).toHaveBeenCalledTimes(1);
  });
});
