// Suppliers -- S-INV-SUPPLIERS, migrated onto the metadata list runtime.
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
const useSuppliersSpy = vi.fn();
vi.mock("../src/hooks/useSuppliers", () => ({ useSuppliers: useSuppliersSpy }));

const { default: Suppliers } = await import("../src/modules/purchasing/Suppliers.jsx");

function listOf(rows, { hasMore = false } = {}) {
  return {
    listId: "supplier.index",
    surface: "INDEX",
    state: rows.length ? "READY" : "EMPTY",
    columns: [
      { fieldId: "name", label: "Name" },
      { fieldId: "vendorNumber", label: "Vendor #" },
      { fieldId: "status", label: "Status" },
      { fieldId: "phone", label: "Phone" },
      { fieldId: "email", label: "Email" },
    ],
    rows: rows.map((r) => ({
      key: r.id,
      cells: [
        { fieldId: "name", value: r.name ?? null },
        { fieldId: "vendorNumber", value: r.vendorNumber ?? null },
        { fieldId: "status", value: r.status ?? null },
        { fieldId: "phone", value: r.phone ?? null },
        { fieldId: "email", value: r.email ?? null },
      ],
    })),
    hasMore,
    viewAllListId: null,
    truncated: false,
    emptyMessage: "No suppliers yet.",
  };
}

function failure(state, emptyMessage) {
  return {
    listId: "supplier.index",
    surface: "INDEX",
    state,
    columns: [
      { fieldId: "name", label: "Name" },
      { fieldId: "vendorNumber", label: "Vendor #" },
      { fieldId: "status", label: "Status" },
      { fieldId: "phone", label: "Phone" },
      { fieldId: "email", label: "Email" },
    ],
    rows: [],
    hasMore: false,
    viewAllListId: null,
    truncated: false,
    emptyMessage,
  };
}

const renderPage = (props = {}) => render(<MemoryRouter><Suppliers {...props} /></MemoryRouter>);

beforeEach(() => {
  retrySpy.mockClear();
  loadMoreSpy.mockClear();
  useSuppliersSpy.mockClear();
  listState.presentation = listOf([{ id: "s1", name: "Acme Parts Co", vendorNumber: "V-100", status: "Active", phone: "555-1000" }]);
});

describe("Suppliers surface", () => {
  it("renders rows through the metadata list runtime, not the old hand-written hook", () => {
    renderPage();
    expect(screen.getByText("Acme Parts Co")).toBeTruthy();
    expect(screen.getByText("V-100")).toBeTruthy();
    expect(useSuppliersSpy).not.toHaveBeenCalled();
  });

  it("never renders a document id as visible cell content", () => {
    renderPage();
    expect(screen.queryByText("s1")).toBeNull();
  });

  it("an absent name renders blank, never the document id -- the fallback the old domain helper used to apply", () => {
    listState.presentation = listOf([{ id: "s2", name: null, status: "ACTIVE_UNRECOGNIZED" }]);
    renderPage();
    expect(screen.queryByText("s2")).toBeNull();
  });

  it("EMPTY, DENIED and UNAVAILABLE are three distinct renderings", () => {
    listState.presentation = listOf([]);
    const { unmount: unmount1 } = renderPage();
    expect(screen.getByText(/nothing here yet/i)).toBeTruthy();
    unmount1();

    listState.presentation = failure("DENIED", "You do not have access to suppliers.");
    const { unmount: unmount2 } = renderPage();
    expect(screen.getByText(/not available to you/i)).toBeTruthy();
    expect(screen.queryByText(/nothing here yet/i)).toBeNull();
    unmount2();

    listState.presentation = failure("UNAVAILABLE", "Suppliers could not be loaded. Try again.");
    renderPage();
    expect(screen.getByText(/could not load/i)).toBeTruthy();
    expect(screen.queryByText(/not available to you/i)).toBeNull();
  });

  it("a client-side status filter with no matches renders FILTERED, distinct from EMPTY", () => {
    listState.presentation = listOf([{ id: "s1", name: "Acme Parts Co", status: "Active" }]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^inactive/i }));
    expect(screen.getByText("No suppliers match this filter.")).toBeTruthy();
  });

  it("the ungoverned bucket is counted, filterable, and disclosed without a fabricated third status", () => {
    listState.presentation = listOf([
      { id: "s1", name: "Acme Parts Co", status: "Active" },
      { id: "s2", name: "Old Vendor Inc", status: null },
    ]);
    renderPage();
    expect(screen.getByText(/1 supplier has no governed status/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^ungoverned/i }));
    expect(screen.getByText("Old Vendor Inc")).toBeTruthy();
    expect(screen.queryByText("Acme Parts Co")).toBeNull();
  });

  it("A PARTIAL READ ASSERTS NOTHING — the counts are withheld, not hedged", () => {
    listState.presentation = listOf([{ id: "s1", name: "Acme Parts Co", status: "Active" }], { hasMore: true });
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
    // ...and the tab counts go with it, rather than showing a tally of one page.
    for (const tab of screen.getAllByRole("button")) {
      expect(tab.textContent).not.toMatch(/^(All|Active|Inactive|Ungoverned)\s*\d/);
    }
    // Load more is what states the truth instead -- asserted in the next test.
  });

  it("offers Load more when more rows exist, rather than silently truncating", () => {
    listState.presentation = listOf([{ id: "s1", name: "Acme Parts Co", status: "Active" }], { hasMore: true });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(loadMoreSpy).toHaveBeenCalled();
  });

  it("the footnote links to the actual mounted Purchase Orders route, not a nonexistent /dashboard/purchasing", () => {
    renderPage();
    const link = screen.getByRole("link", { name: "Purchase Orders" });
    expect(link.getAttribute("href")).toBe("/purchasing");
  });

  it("re-runs the read when accessVersion changes, the inventory/purchasing convention", () => {
    const { rerender } = render(
      <MemoryRouter>
        <Suppliers accessVersion={1} />
      </MemoryRouter>
    );
    expect(retrySpy).not.toHaveBeenCalled();
    rerender(
      <MemoryRouter>
        <Suppliers accessVersion={2} />
      </MemoryRouter>
    );
    expect(retrySpy).toHaveBeenCalledTimes(1);
  });
});
