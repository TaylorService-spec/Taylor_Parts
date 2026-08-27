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

const useMetadataListSpy = vi.fn(() => ({ presentation: listState.presentation, loadMore: loadMoreSpy, retry: retrySpy }));
vi.mock("../src/hooks/useMetadataList", () => ({ useMetadataList: (...args) => useMetadataListSpy(...args) }));
// The old hand-written useWarehouses hook was DELETED once this surface stopped calling it
// (it had no other importer). This test used to mock that module and assert it was never
// called; with the file gone that assertion is trivially true, so the invariant it actually
// protected -- this surface issues exactly ONE read, never a second independent one -- is
// asserted directly instead. Deleting the module is itself the stronger tripwire: an import
// of it now fails to resolve rather than quietly adding a second live read.

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
  useMetadataListSpy.mockClear();
  listState.presentation = listOf([{ id: "w1", name: "Main Warehouse", location: "123 Main St", status: "Active" }]);
});

describe("Warehouses surface", () => {
  it("renders rows through the metadata list runtime, with exactly one read", () => {
    renderPage();
    expect(screen.getByText("Main Warehouse")).toBeTruthy();
    expect(screen.getByText("123 Main St")).toBeTruthy();
    expect(useMetadataListSpy).toHaveBeenCalledTimes(1);
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

  it("A PARTIAL READ ASSERTS NOTHING — the counts are withheld, not hedged", () => {
    listState.presentation = listOf([{ id: "w1", name: "Main Warehouse", status: "Active" }], { hasMore: true });
    renderPage();
    // THIS ASSERTION USED TO REQUIRE THE HEDGE "loaded so far", and Lists P2 removed the hedge by
    // removing the numbers it was apologising for. A sentence that has to explain that its own
    // figures might be partial is a sentence carrying figures it should not have -- so on a partial
    // read there is now no summary line and no per-bucket count at all.
    //
    // The property is unchanged and held more strongly: a partial read must never assert a total.
    expect(screen.queryByText(/loaded so far/i)).toBeNull();
    // No summary line at all. On a complete read it renders "N active · M inactive".
    expect(screen.queryByText(/^\s*\d+ active/i)).toBeNull();
    // ...and the tab counts are gone with it, rather than showing a tally of one page.
    for (const tab of screen.getAllByRole("button")) {
      expect(tab.textContent).not.toMatch(/^(All|Active|Inactive|Ungoverned)\s*\d/);
    }
    // Load more is what states the truth instead -- asserted in the next test.
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
