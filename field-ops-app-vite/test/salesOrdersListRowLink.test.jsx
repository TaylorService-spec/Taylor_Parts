// SO-DETAIL-ROUTE-01 (UAT-R2.1): the Sales Order list exposed no link or id, so a reader (or a test driver) could not reach or cite a
// Sales Order's canonical address. A row is now a real link to /customers/opportunities/sales-order/:salesOrderId, keyed by the internal id,
// while the displayed text stays the governed order number. No capability, route or authority is added: the detail route still applies its own
// governed read, so an unauthorized principal who follows the link gets the governed denial.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import SalesOrdersList from "../src/modules/sales/SalesOrdersList.jsx";
import SalesOrderDetail from "../src/modules/sales/SalesOrderDetail.jsx";
import { useMetadataList } from "../src/hooks/useMetadataList.js";
import { useSalesOrder } from "../src/hooks/useSalesOrder.js";

vi.mock("../src/hooks/useMetadataList.js", () => ({ useMetadataList: vi.fn() }));
vi.mock("../src/hooks/useSalesOrder.js", () => ({ useSalesOrder: vi.fn() }));
vi.mock("../src/hooks/useListCriteria.js", () => ({ useListCriteria: () => ({ criteria: { filters: [], sort: [], dropped: [] }, apply: vi.fn() }) }));
vi.mock("../src/hooks/useListViewChrome.js", () => ({ useListViewChrome: () => ({ activeViewId: null, selectView: vi.fn(), total: 1 }) }));
vi.mock("../src/hooks/useAccountReferenceResolver.js", () => ({ useAccountReferenceResolver: () => ({ resolveReference: null, status: "READY" }) }));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  ACCOUNT_NAMES_STATUS: { IDLE: "IDLE", LOADING: "LOADING", READY: "READY", DENIED: "DENIED", ERROR: "ERROR" },
  useAccountNamesWithStatus: () => ({ names: new Map(), status: "READY" }),
  useAccountNames: () => new Map(),
}));
vi.mock("../src/metadata/ListViewHeader.jsx", () => ({ default: () => null, CollectionResultContext: () => null }));

const presentation = {
  listId: "salesOrder.index", surface: "INDEX", state: "READY",
  columns: [{ fieldId: "salesOrderNumber", label: "Order" }, { fieldId: "state", label: "State" }],
  rows: [{ key: "so-doc-6", cells: [{ fieldId: "salesOrderNumber", value: "SO-2026-000006" }, { fieldId: "state", value: "Confirmed" }] }],
  hasMore: false, viewAllListId: null, truncated: false, emptyMessage: null,
};

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

function renderFlow(detail = { loading: true, errorStatus: null, result: null }) {
  useSalesOrder.mockReturnValue(detail);
  useMetadataList.mockReturnValue({ presentation, rows: [], loadMore: vi.fn(), retry: vi.fn(), descriptorErrors: [] });
  return render(
    <MemoryRouter initialEntries={["/customers/sales-orders"]}>
      <Where />
      <Routes>
        <Route path="/customers/sales-orders" element={<SalesOrdersList />} />
        <Route path="/customers/opportunities/sales-order/:salesOrderId" element={<SalesOrderDetail hasCapability={() => false} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Sales Order list rows open the canonical Sales Order detail", () => {
  it("the order number is a real link to the id route, and the id is never shown as content", () => {
    renderFlow();
    const link = screen.getByRole("link", { name: "SO-2026-000006" });
    expect(link.getAttribute("href")).toBe("/customers/opportunities/sales-order/so-doc-6");
    expect(screen.queryByText("so-doc-6")).toBeNull();
  });

  it("following the link navigates once to the detail route by id; clicking elsewhere on the row does the same", () => {
    renderFlow();
    fireEvent.click(screen.getByRole("link", { name: "SO-2026-000006" }));
    expect(screen.getByTestId("where").textContent).toBe("/customers/opportunities/sales-order/so-doc-6");
  });

  it("a row click away from the link still navigates by id (existing behaviour preserved)", () => {
    renderFlow();
    fireEvent.click(screen.getByText("Confirmed"));
    expect(screen.getByTestId("where").textContent).toBe("/customers/opportunities/sales-order/so-doc-6");
  });

  it("an unauthorized principal who follows the link gets the governed denial, with no actions and no widened access", () => {
    renderFlow({ loading: false, errorStatus: "denied", result: null });
    fireEvent.click(screen.getByRole("link", { name: "SO-2026-000006" }));
    expect(screen.getByText(/not authorized to view this Sales Order/)).toBeTruthy();
    expect(useSalesOrder).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Cancel order|Allocate|Move to In Fulfillment/i })).toBeNull();
  });
});
