// Purchasing > Purchase Orders -- REGRESSION LOCK for the hand-written surface.
//
// Why this exists instead of a metadata-runtime migration: S-COM-PURCHASE-ORDERS (see
// docs/orchestration/metadata-program/ledger.json) was evaluated and declined. purchaseOrder.js
// (purchaseOrderEntity/purchaseOrderIndexList) describes the SAME collection this surface reads
// (reorder_purchase_orders) -- there is no dataset swap. But this surface's read is driven by
// `reorder_requests` filtered to ORDERED/RECEIVED/VOIDED, then joined by id to
// reorder_purchase_orders (domain/purchaseOrdersView.js's buildPurchaseOrdersView()), not by a
// direct scan of reorder_purchase_orders alone. That join is where the VOIDED/RECEIVED
// distinction lives (a reorder_purchase_orders DOCUMENT's own `status` field has exactly one
// legal value, "ORDERED", per purchaseOrder.js's own header) and where the ORPHAN integrity
// exception comes from (an ORDERED request with no readable PO doc -- a row the metadata list
// runtime, driven off reorder_purchase_orders alone, could never produce). Migrating onto
// purchaseOrderIndexList would flatten this lifecycle composite onto a document-list contract
// and silently lose both. See PurchaseOrders.jsx's header for the full reasoning.
//
// This suite locks the CURRENT surface's observable behaviour -- loading/error/empty
// distinctness, the four-way status ladder (Open/Received/Voided/Needs attention), the ORPHAN
// integrity note, receipt-candidate disclosure, and filtering -- so a future migration (once the
// metadata contract can express a request-driven join, or a Product decision accepts the
// semantic loss) has a regression fence to migrate against.
//
// KNOWN, PRE-EXISTING GAP PINNED (NOT INTRODUCED HERE): the Part cell renders the raw partId
// (a `part` document id) as its own visible link text -- there is no part-name resolution hook
// in this app today (no usePartNamesByIds/usePartDirectory equivalent found in src/hooks), and
// adding one is out of this lane's writeScope (src/hooks/** is owned elsewhere). Recorded as
// REGISTRATION_PENDING against a future lane, and pinned below so it is visible rather than
// silently accepted.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const requestsState = { data: [], loading: true, error: null };
const purchaseOrdersState = { purchaseOrdersById: {}, loading: true, error: null };
const employeeDirectoryState = { byUserId: new Map() };

vi.mock("../src/hooks/useReorderRequests", () => ({
  useReorderRequestsByStatuses: () => requestsState,
}));
vi.mock("../src/hooks/usePurchaseOrdersByIds", () => ({
  usePurchaseOrdersByIds: () => purchaseOrdersState,
}));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => employeeDirectoryState,
}));

const { default: PurchaseOrders } = await import("../src/modules/purchasing/PurchaseOrders.jsx");

function renderSurface() {
  return render(
    <MemoryRouter>
      <PurchaseOrders />
    </MemoryRouter>,
  );
}

function request(overrides = {}) {
  return {
    id: overrides.id ?? "rr-1",
    status: overrides.status ?? "ORDERED",
    partId: overrides.partId ?? "PART-100",
    orderedBy: overrides.orderedBy ?? null,
    orderedAt: overrides.orderedAt ?? 1000,
  };
}

function po(overrides = {}) {
  return {
    id: overrides.id ?? "rr-1",
    partId: overrides.partId ?? "PART-100",
    supplierName: overrides.supplierName ?? "Acme Supply",
    externalPoNumber: overrides.externalPoNumber ?? "PO-EXT-1",
    orderedQuantity: overrides.orderedQuantity ?? 5,
    orderedDate: overrides.orderedDate ?? "2026-08-01",
    expectedArrivalDate: overrides.expectedArrivalDate ?? "2026-08-10",
    status: overrides.status ?? "ORDERED",
    createdBy: overrides.createdBy ?? "user-1",
    createdAt: overrides.createdAt ?? 1000,
  };
}

beforeEach(() => {
  requestsState.data = [];
  requestsState.loading = true;
  requestsState.error = null;
  purchaseOrdersState.purchaseOrdersById = {};
  purchaseOrdersState.loading = true;
  purchaseOrdersState.error = null;
  employeeDirectoryState.byUserId = new Map();
});

describe("Purchase Orders surface -- loading/error/empty are distinct renderings", () => {
  it("shows a loading state while either read is in flight", () => {
    requestsState.loading = true;
    purchaseOrdersState.loading = false;
    renderSurface();
    expect(screen.getByText(/loading purchase orders/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a fail-closed failure state on a denied read, never a raw error code", () => {
    requestsState.loading = false;
    requestsState.error = "permission-denied";
    purchaseOrdersState.loading = false;
    renderSurface();
    expect(screen.getByText(/purchase orders unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/permission-denied/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a fail-closed failure state on an unavailable PO read", () => {
    requestsState.loading = false;
    requestsState.error = null;
    purchaseOrdersState.loading = false;
    purchaseOrdersState.error = "unavailable";
    renderSurface();
    expect(screen.getByText(/purchase orders unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the database-empty state when both reads succeed with zero rows", () => {
    requestsState.loading = false;
    requestsState.error = null;
    requestsState.data = [];
    purchaseOrdersState.loading = false;
    purchaseOrdersState.purchaseOrdersById = {};
    renderSurface();
    expect(screen.getByText(/no purchase orders yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the filtered-empty state when rows exist but none match the default (Open) filter", () => {
    requestsState.loading = false;
    requestsState.error = null;
    requestsState.data = [request({ id: "rr-1", status: "VOIDED" })];
    purchaseOrdersState.loading = false;
    purchaseOrdersState.purchaseOrdersById = {};
    renderSurface();
    expect(screen.getByText(/no matching purchase orders/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("Purchase Orders surface -- the four-way status ladder", () => {
  beforeEach(() => {
    requestsState.loading = false;
    requestsState.error = null;
    purchaseOrdersState.loading = false;
  });

  it("renders an OPEN row for an ORDERED request backed by an ORDERED PO doc", () => {
    requestsState.data = [request({ id: "rr-open" })];
    purchaseOrdersState.purchaseOrdersById = { "rr-open": po({ id: "rr-open" }) };
    renderSurface();
    const table = screen.getByRole("table");
    expect(table).toBeTruthy();
    expect(within(table).getByText("Open")).toBeTruthy();
  });

  it("renders a VOIDED row for a VOIDED request even though the PO doc's own status field would say ORDERED", () => {
    // This is the exact case a plain metadata-list read of reorder_purchase_orders alone
    // could never produce -- the PO document's status field is immutably "ORDERED" per
    // purchaseOrder.js's header; VOIDED is only knowable from the linked request.
    requestsState.data = [request({ id: "rr-voided", status: "VOIDED" })];
    purchaseOrdersState.purchaseOrdersById = { "rr-voided": po({ id: "rr-voided", status: "ORDERED" }) };
    renderSurface();
    // default filter is Open; switch to All via the filter bar to see it.
    fireEvent.click(screen.getByRole("button", { name: /^all/i }));
    expect(within(screen.getByRole("table")).getByText("Voided")).toBeTruthy();
  });

  it("renders a RECEIVED row for a RECEIVED request", () => {
    requestsState.data = [request({ id: "rr-received", status: "RECEIVED" })];
    purchaseOrdersState.purchaseOrdersById = { "rr-received": po({ id: "rr-received" }) };
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: /^all/i }));
    expect(within(screen.getByRole("table")).getByText("Received")).toBeTruthy();
  });

  it("renders an ORPHAN row -- with its integrity note -- for an ORDERED request with no readable PO doc", () => {
    requestsState.data = [request({ id: "rr-orphan" })];
    purchaseOrdersState.purchaseOrdersById = {}; // no matching PO doc
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: /^all/i }));
    expect(within(screen.getByRole("table")).getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText(/blank fields are unknown, not empty/i)).toBeTruthy();
  });

  it("discloses a receipt source only for OPEN (receipt-candidate) rows", () => {
    requestsState.data = [request({ id: "rr-open" })];
    purchaseOrdersState.purchaseOrdersById = { "rr-open": po({ id: "rr-open" }) };
    renderSurface();
    expect(within(screen.getByRole("table")).getByText(/eligible for receiving/i)).toBeTruthy();
  });
});

describe("Purchase Orders surface -- known, pinned gap: partId as visible link text", () => {
  it("renders the raw partId as its own link text (pre-existing gap, not introduced by this evaluation)", () => {
    requestsState.loading = false;
    requestsState.error = null;
    requestsState.data = [request({ id: "rr-open", partId: "PART-999" })];
    purchaseOrdersState.loading = false;
    purchaseOrdersState.purchaseOrdersById = { "rr-open": po({ id: "rr-open", partId: "PART-999" }) };
    renderSurface();
    const link = screen.getByRole("link", { name: "PART-999" });
    expect(link.getAttribute("href")).toContain("PART-999");
  });
});
