// Inventory > Transfers -- REGRESSION LOCK for the hand-written surface.
//
// Why this exists instead of a metadata-runtime migration: S-INV-TRANSFERS (see
// docs/orchestration/metadata-program/LEDGER.md) cannot migrate honestly today. There is no
// merged Transfer Order EntityDefinition -- `transferOrder.js` was authored but deliberately
// held back on X-TRANSFER-ORDER-NO-REFERENCE ("Needs a business decision on whether transfer
// orders get a reference number"), and `src/metadata/definitions/` on main has no transferOrder
// entry at all. The ledger also classifies this surface as "lifecycle composite, not a list" --
// it owns four governed write actions (create/dispatch/receive/cancel), which the list runtime
// does not model. Migrating without a definition, or forcing a lifecycle composite onto a list
// contract, would both be dishonest. So this suite exists to lock the CURRENT surface's observable
// behaviour (loading/error/empty distinctness, row shape, per-status actions, filtering) so a
// future migration -- once a Transfer Order definition is merged and the composite question is
// resolved -- has a regression fence to migrate against.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UNRESOLVED_REFERENCE_LABEL } from "../src/metadata/referenceResolution.js";

const readState = { loading: true, error: null, transferOrderDocs: [], warehouses: [], transferOrdersTruncated: false, warehousesTruncated: false };
const actionsState = {
  status: null,
  busyId: null,
  createTransfer: vi.fn(),
  dispatchTransfer: vi.fn(),
  receiveTransfer: vi.fn(),
  cancelTransfer: vi.fn(),
};

vi.mock("../src/hooks/useTransferOrders", () => ({
  useTransferOrders: () => readState,
}));
vi.mock("../src/hooks/useTransferActions", () => ({
  useTransferActions: () => ({ ...actionsState, clearStatus: vi.fn() }),
}));
vi.mock("../src/services/truckRegistryQueries", () => ({
  fetchMobileLocationDocs: vi.fn(() => Promise.resolve([])),
}));

const { default: Transfers } = await import("../src/modules/inventory/Transfers.jsx");

function renderSurface() {
  return render(
    <MemoryRouter>
      <Transfers accessVersion={1} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  readState.loading = true;
  readState.error = null;
  readState.transferOrderDocs = [];
  readState.warehouses = [];
  readState.transferOrdersTruncated = false;
  readState.warehousesTruncated = false;
  actionsState.status = null;
  actionsState.busyId = null;
  actionsState.createTransfer.mockClear();
  actionsState.dispatchTransfer.mockClear();
  actionsState.receiveTransfer.mockClear();
  actionsState.cancelTransfer.mockClear();
});

// A minimal valid transfer_orders doc pair (docId separate from data), matching what
// operationsQueries.fetchTransferOrderDocs returns and toTransferRef expects.
function transferDoc(overrides = {}) {
  return {
    docId: overrides.docId ?? "to-1",
    data: {
      transferOrderId: overrides.transferOrderId ?? overrides.docId ?? "to-1",
      partId: overrides.partId ?? "PART-100",
      status: overrides.status ?? "REQUESTED",
      origin: overrides.origin ?? { type: "WAREHOUSE", locationId: "wh-1" },
      destination: overrides.destination ?? { type: "WAREHOUSE", locationId: "wh-2" },
    },
  };
}

describe("Transfers surface -- loading/error/empty are three distinct renderings", () => {
  it("shows a polite loading region while the read is in flight", () => {
    readState.loading = true;
    renderSurface();
    expect(screen.getByRole("status").textContent).toMatch(/loading transfers/i);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an alert-role failure state on a denied/unavailable read, never a raw error", () => {
    readState.loading = false;
    readState.error = "permission-denied";
    renderSurface();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/transfers unavailable/i);
    // The message must be the mapped, categorized copy -- never the raw Firebase code.
    expect(alert.textContent).not.toMatch(/permission-denied/);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the database-empty state when the read succeeds with zero rows", () => {
    readState.loading = false;
    readState.error = null;
    readState.transferOrderDocs = [];
    renderSurface();
    expect(screen.getByText(/no transfers yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the filtered-empty state when rows exist but none match the active filter", () => {
    readState.loading = false;
    readState.error = null;
    // Only a COMPLETED row exists; default filter is "active" (REQUESTED + IN_TRANSIT).
    readState.transferOrderDocs = [transferDoc({ docId: "to-1", status: "COMPLETED" })];
    readState.warehouses = [];
    renderSurface();
    expect(screen.getByText(/no matching transfers/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("Transfers surface -- row rendering and identity display", () => {
  beforeEach(() => {
    readState.loading = false;
    readState.error = null;
    readState.warehouses = [
      { id: "wh-1", name: "North DC" },
      { id: "wh-2", name: "South DC" },
    ];
  });

  it("renders Part / From / To / Status / Actions columns with resolved warehouse names", () => {
    readState.transferOrderDocs = [transferDoc({ docId: "to-1", status: "REQUESTED" })];
    renderSurface();
    const table = screen.getByRole("table", { name: /transfers/i });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Part", "From", "To", "Status", "Actions"]));
    // THIS ASSERTION USED TO REQUIRE THE DOCUMENT ID ON SCREEN, and it is the reason R3 survived
    // this long: `partId` is `type: "REFERENCE" → part`, a routing key, and the fixture value
    // "PART-100" LOOKS like a catalogue number. A test written against a fixture that flatters the
    // defect will pin the defect in place — the id was rendered as the link's own visible text, a
    // test asserted it, and both looked right.
    //
    // The transfer document carries no part number and no part name, and every way to resolve one
    // required adding a read. So the cell states the absence in the platform's shared vocabulary.
    expect(within(table).queryByText("PART-100")).toBeNull();
    expect(within(table).getByText(UNRESOLVED_REFERENCE_LABEL)).toBeTruthy();
    // The id survives ONLY in the href, where it is governed: the row still opens the part record,
    // which is where the name this cell cannot supply is written down.
    expect(within(table).getByRole("link", { name: UNRESOLVED_REFERENCE_LABEL }).getAttribute("href"))
      .toBe("/inventory/PART-100");
    expect(within(table).getByText("North DC")).toBeTruthy();
    expect(within(table).getByText("South DC")).toBeTruthy();
    expect(within(table).getByText("Requested")).toBeTruthy();
  });

  it("never renders the Firestore document id (transferOrderId) as visible cell content", () => {
    readState.transferOrderDocs = [transferDoc({ docId: "raw-doc-id-abc123", status: "REQUESTED" })];
    renderSurface();
    const table = screen.getByRole("table", { name: /transfers/i });
    expect(within(table).queryByText("raw-doc-id-abc123")).toBeNull();
  });

  it("falls back to a raw locationId label (not a blank) for a non-warehouse endpoint with no name authority", () => {
    readState.transferOrderDocs = [
      transferDoc({
        docId: "to-2",
        status: "REQUESTED",
        origin: { type: "MOBILE", locationId: "truck-9" },
      }),
    ];
    renderSurface();
    expect(screen.getByText("truck-9")).toBeTruthy();
  });

  it("surfaces the hiddenInvalidCount banner when a record fails closed, without fabricating a row for it", () => {
    // A stored `id` that disagrees with the authoritative docId is a stored_id_conflict --
    // toTransferRef never trusts it, so the adapter fails closed and the record is counted,
    // never rendered (see domain/transferOrderView.js toTransferRef).
    readState.transferOrderDocs = [
      { docId: "to-3", data: { id: "different-id", partId: "PART-1", status: "REQUESTED", origin: { type: "WAREHOUSE", locationId: "wh-1" }, destination: { type: "WAREHOUSE", locationId: "wh-2" } } },
    ];
    renderSurface();
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't be displayed due to a data issue/i);
  });
});

describe("Transfers surface -- status-scoped actions (fail-closed backend, honest UI)", () => {
  beforeEach(() => {
    readState.loading = false;
    readState.error = null;
    readState.warehouses = [];
  });

  it("REQUESTED rows offer Dispatch and Cancel, and wire them to the action hook", () => {
    readState.transferOrderDocs = [transferDoc({ docId: "to-1", status: "REQUESTED" })];
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: /^dispatch$/i }));
    expect(actionsState.dispatchTransfer).toHaveBeenCalledWith("to-1");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(actionsState.cancelTransfer).toHaveBeenCalledWith("to-1");
  });

  it("IN_TRANSIT rows offer only Receive", () => {
    readState.transferOrderDocs = [transferDoc({ docId: "to-1", status: "IN_TRANSIT" })];
    renderSurface();
    expect(screen.queryByRole("button", { name: /^dispatch$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^receive$/i }));
    expect(actionsState.receiveTransfer).toHaveBeenCalledWith("to-1");
  });

  it("terminal-status rows (COMPLETED/CANCELLED) offer no action buttons", () => {
    readState.transferOrderDocs = [transferDoc({ docId: "to-1", status: "COMPLETED" })];
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: /^all\b/i })); // reveal terminal rows past the default "Active" filter
    expect(screen.queryByRole("button", { name: /^dispatch$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^receive$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
  });

  it("opens the New Transfer form and hands the draft to createTransfer on submit", async () => {
    readState.transferOrderDocs = [];
    actionsState.createTransfer.mockResolvedValue({ ok: true });
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: /new transfer/i }));
    expect(screen.getByRole("form", { name: /new transfer/i })).toBeTruthy();
  });
});

describe("Transfers surface -- filtering", () => {
  beforeEach(() => {
    readState.loading = false;
    readState.error = null;
    readState.warehouses = [];
    readState.transferOrderDocs = [
      transferDoc({ docId: "to-1", status: "REQUESTED" }),
      transferDoc({ docId: "to-2", status: "IN_TRANSIT" }),
      transferDoc({ docId: "to-3", status: "COMPLETED" }),
      transferDoc({ docId: "to-4", status: "CANCELLED" }),
    ];
  });

  it("defaults to the Active filter (REQUESTED + IN_TRANSIT only)", () => {
    renderSurface();
    const table = screen.getByRole("table", { name: /transfers/i });
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2 active rows
  });

  it("switching to All reveals every row regardless of status", () => {
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: /^all/i }));
    const table = screen.getByRole("table", { name: /transfers/i });
    expect(within(table).getAllByRole("row")).toHaveLength(5); // header + 4 rows
  });
});

describe("Transfers truncation disclosure", () => {
  it("discloses a capped transfer read instead of presenting the cap as the whole set", () => {
    // The read was fully unbounded before it was capped. A cap nobody discloses is the defect
    // this program keeps removing -- and a hook computing the flag is only half the fix if the
    // surface never reads it.
    readState.loading = false;
    readState.error = null;
    readState.transferOrdersTruncated = true;
    renderSurface();
    expect(screen.getByText(/some are not listed/i)).toBeTruthy();
  });

  it("says nothing about truncation when the read was complete", () => {
    readState.loading = false;
    readState.error = null;
    readState.transferOrdersTruncated = false;
    renderSurface();
    expect(screen.queryByText(/some are not listed/i)).toBeNull();
  });
});
