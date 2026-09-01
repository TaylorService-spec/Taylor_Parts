// Receiving North Star P1 frame 1a — the assembled workspace (vitest + jsdom).
//
// The queue's truth rules are proved in test/receivingWorkspaceQueue.test.mjs as pure functions.
// These cover what only the assembled screen shows: the singular page identity, the queue rendering
// from governed input, the distinct empty/denied/error presentations, that no document id is
// promoted to a visible label, that a row opens its own EXISTING governed journey, and the
// responsive structural contract (labelled cells) the stacked phone composition keys on.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Receiving from "../src/modules/inventory/Receiving.jsx";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";

// ── mocks: the reads, the capability, and the two journey components ────────────────────
// The journeys are the EXISTING components with their own suites; here they are stubs that record
// the navigation contract — what frame 1a is responsible for is handing them the right argument.

let reorderRequests = { data: [], loading: false };
let purchaseOrdersById = { purchaseOrdersById: {}, loading: false };
let suppliers = { loading: false, error: null, suppliers: [], truncated: false };
let canAcquire = false;
const fetchReceivable = vi.fn();
const journeyProps = { supplier: [], reorder: [] };

vi.mock("../src/hooks/useReorderRequests", () => ({ useReorderRequestsByStatuses: () => reorderRequests }));
vi.mock("../src/hooks/usePurchaseOrdersByIds", () => ({ usePurchaseOrdersByIds: () => purchaseOrdersById }));
vi.mock("../src/hooks/useSuppliers", () => ({ useSuppliers: () => suppliers }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/access/useSerializedAssetAcquireCapability", () => ({
  useSerializedAssetAcquireCapability: () => ({ canAcquire }),
}));
vi.mock("../src/modules/receiving/MultiScanReceiving", () => ({
  default: (props) => { journeyProps.supplier.push(props); return <div data-testid="multi-scan-journey" />; },
}));
vi.mock("../src/modules/receiving/ReceiveAgainstPurchaseOrder", () => ({
  default: (props) => { journeyProps.reorder.push(props); return <div data-testid="reorder-journey" />; },
}));
vi.mock("../src/modules/receiving/AcquireExistingUnit", () => ({
  default: () => <div data-testid="acquire-dialog" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  reorderRequests = { data: [], loading: false };
  purchaseOrdersById = { purchaseOrdersById: {}, loading: false };
  suppliers = { loading: false, error: null, suppliers: [], truncated: false };
  canAcquire = false;
  journeyProps.supplier.length = 0;
  journeyProps.reorder.length = 0;
});

function supplierListReady(purchaseOrders = []) {
  fetchReceivable.mockResolvedValue({ status: RECEIVING_OUTCOME.READY, purchaseOrders });
}

function reorderCandidateReady() {
  reorderRequests = { data: [{ id: "reorder-doc-1", status: "ORDERED" }], loading: false };
  purchaseOrdersById = {
    purchaseOrdersById: {
      "reorder-doc-1": {
        status: "ORDERED",
        partId: "X49463-3",
        supplierName: "Taylor Distribution",
        externalPoNumber: "TP-88112",
        orderedQuantity: 12,
      },
    },
    loading: false,
  };
}

const deps = () => ({ fetchReceivablePurchaseOrders: fetchReceivable });

async function renderReady(pos = []) {
  supplierListReady(pos);
  render(<Receiving deps={deps()} />);
  await waitFor(() => expect(fetchReceivable).toHaveBeenCalled());
}

// ── page identity ───────────────────────────────────────────────────────────────────────

describe("page identity", () => {
  it("renders ONE visible page title, 'Receiving', and no nested duplicate heading", async () => {
    await renderReady();
    const titles = document.querySelectorAll(".fo-page-header__title");
    expect(titles).toHaveLength(1);
    expect(titles[0].textContent).toBe("Receiving");
    // The old composition's duplicate identity — a second 'Receiving' heading — must not return.
    const headings = [...document.querySelectorAll("h1, h2, h3")].filter((h) => h.textContent.trim() === "Receiving");
    expect(headings).toHaveLength(1);
  });
});

// ── the queue, from governed input ──────────────────────────────────────────────────────

describe("awaiting-receipt queue", () => {
  it("renders one union table from the two governed reads, each row naming its journey", async () => {
    reorderCandidateReady();
    suppliers = { loading: false, error: null, suppliers: [{ id: "sup-1", name: "Ventana Supply" }], truncated: false };
    await renderReady([{ purchaseOrderId: "fs-auto-9pQ7xW", supplierId: "sup-1", storedStatus: "SENT", lineCount: 6 }]);
    const table = await screen.findByRole("table", { name: /orders awaiting receipt/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Supplier PO · multi-scan");
    expect(rows[1].textContent).toContain("Reorder PO · full quantity");
    expect(rows[1].textContent).toContain("TP-88112");
    expect(screen.getByText(/Awaiting receipt · 2 orders/)).toBeTruthy();
  });

  it("MUTATION PROOF: no document id is promoted to a visible label", async () => {
    reorderCandidateReady();
    // Reorder candidate WITHOUT its governed external number: absence must be stated.
    purchaseOrdersById.purchaseOrdersById["reorder-doc-1"].externalPoNumber = null;
    await renderReady([{ purchaseOrderId: "fs-auto-9pQ7xW", supplierId: "sup-1", storedStatus: "SENT", lineCount: 6 }]);
    const table = await screen.findByRole("table", { name: /orders awaiting receipt/i });
    expect(table.textContent).not.toContain("fs-auto-9pQ7xW");
    expect(table.textContent).not.toContain("reorder-doc-1");
    // Each journey states ITS OWN absence (frame 1e): the supplier row has no order-number
    // authority at all; the reorder row's governed external PO number is absent on that record —
    // the same words its opened journey (frame 1d) uses.
    expect(within(table).getByText("No order number recorded")).toBeTruthy();
    expect(within(table).getByText("No PO number recorded")).toBeTruthy();
    // And no RR-number is claimed while the RR lane is unwired.
    expect(table.textContent).not.toMatch(/RR-\d{4}/);
  });

  it("a supplier row's supplierId never renders when the name cannot be resolved", async () => {
    await renderReady([{ purchaseOrderId: "po-x", supplierId: "sup-raw-id", storedStatus: "SENT", lineCount: 2 }]);
    const table = await screen.findByRole("table", { name: /orders awaiting receipt/i });
    expect(table.textContent).not.toContain("sup-raw-id");
    expect(within(table).getByText("Supplier not resolved")).toBeTruthy();
  });
});

// ── truth states ────────────────────────────────────────────────────────────────────────

describe("truth states", () => {
  it("EMPTY: both reads succeed with nothing awaiting", async () => {
    await renderReady([]);
    expect(await screen.findByText("Nothing awaiting receipt")).toBeTruthy();
  });

  it("MUTATION PROOF: a failed read is NOT presented as an empty queue", async () => {
    fetchReceivable.mockResolvedValue({ status: "failed", purchaseOrders: [] });
    reorderRequests = { data: [], loading: false, error: "unavailable" };
    render(<Receiving deps={deps()} />);
    await waitFor(() => expect(fetchReceivable).toHaveBeenCalled());
    expect(await screen.findByText("The receipt queue could not be loaded")).toBeTruthy();
    expect(screen.queryByText("Nothing awaiting receipt")).toBeNull();
  });

  it("DENIED is authorization-specific, not a generic failure", async () => {
    fetchReceivable.mockResolvedValue({ status: RECEIVING_OUTCOME.DENIED, purchaseOrders: [] });
    reorderRequests = { data: [], loading: false, error: "permission-denied" };
    render(<Receiving deps={deps()} />);
    expect(await screen.findByText(/not authorized to read the orders awaiting receipt/i)).toBeTruthy();
    expect(screen.queryByText("Nothing awaiting receipt")).toBeNull();
    expect(screen.queryByText("The receipt queue could not be loaded")).toBeNull();
  });

  it("PARTIAL: one readable source renders rows plus an explicit incompleteness disclosure", async () => {
    reorderCandidateReady();
    fetchReceivable.mockResolvedValue({ status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] });
    render(<Receiving deps={deps()} />);
    expect(await screen.findByText(/Awaiting receipt · 1 shown · incomplete/)).toBeTruthy();
    expect(screen.getByText(/not an empty list; it is an unread one/i)).toBeTruthy();
    expect(screen.getByText(/TP-88112/)).toBeTruthy();
  });

  it("LOADING renders neither rows nor claims", () => {
    fetchReceivable.mockReturnValue(new Promise(() => {}));
    reorderRequests = { data: [], loading: true };
    render(<Receiving deps={deps()} />);
    expect(screen.getByText(/Loading orders awaiting receipt/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Nothing awaiting receipt")).toBeNull();
  });
});

// ── navigation into the existing governed journeys ──────────────────────────────────────

describe("row navigation", () => {
  it("a supplier row opens the EXISTING multi-scan journey with that purchase order as its argument", async () => {
    await renderReady([{ purchaseOrderId: "fs-auto-9pQ7xW", supplierId: "sup-1", storedStatus: "SENT", lineCount: 6 }]);
    fireEvent.click(await screen.findByRole("button", { name: /^Receive/ }));
    expect(await screen.findByTestId("multi-scan-journey")).toBeTruthy();
    expect(journeyProps.supplier.at(-1).initialPurchaseOrderId).toBe("fs-auto-9pQ7xW");
    // and back returns to the queue
    fireEvent.click(screen.getByRole("button", { name: /Back to the receipt queue/ }));
    expect(await screen.findByRole("table", { name: /orders awaiting receipt/i })).toBeTruthy();
  });

  it("a reorder row opens the EXISTING reorder journey with its reorderRequestId as its argument", async () => {
    reorderCandidateReady();
    await renderReady([]);
    fireEvent.click(await screen.findByRole("button", { name: /Receive TP-88112/ }));
    expect(await screen.findByTestId("reorder-journey")).toBeTruthy();
    expect(journeyProps.reorder.at(-1).initialReorderRequestId).toBe("reorder-doc-1");
  });

  it("REGRESSION (RCV-G5/RCV-G7): the surface never claims canonical supplier POs have a typable order number", async () => {
    // Canonical purchase_orders have no governed business number and no governed scan-identifier
    // contract. A scan/type-an-order-number entry field would assert an identifier authority that
    // does not exist — queue rows are the entry path. This pins its absence.
    reorderCandidateReady();
    await renderReady([{ purchaseOrderId: "po-x", supplierId: "sup-1", storedStatus: "SENT", lineCount: 2 }]);
    await screen.findByRole("table", { name: /orders awaiting receipt/i });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.body.textContent).not.toMatch(/type its number/i);
    expect(document.body.textContent).not.toMatch(/scan a purchase order/i);
  });
});

// ── the exceptional path and the held slot ──────────────────────────────────────────────

describe("beside the queue", () => {
  it("Add existing unit is ABSENT without the acquire capability, present with it", async () => {
    await renderReady([]);
    expect(screen.queryByRole("button", { name: "Add existing unit" })).toBeNull();
    cleanup();
    canAcquire = true;
    await renderReady([]);
    expect(screen.getByRole("button", { name: "Add existing unit" })).toBeTruthy();
  });

  it("the Recent-receipts slot is held honestly (RCV-G1) — a reserved place, not a list and not an error", async () => {
    await renderReady([]);
    expect(screen.getByText("Recent receipts")).toBeTruthy();
    expect(screen.getByText("Not connected yet.")).toBeTruthy();
    // MUTATION PROOF: the unavailable slot must never become a false empty list — "no receipts"
    // is a claim about the data, and no governed read exists to make it.
    expect(document.body.textContent).not.toMatch(/no receipts|no recent receipts/i);
  });
});

// ── responsive structural contract ──────────────────────────────────────────────────────

describe("responsive structure", () => {
  it("every queue cell carries the data-label the stacked phone composition keys on", async () => {
    reorderCandidateReady();
    await renderReady([{ purchaseOrderId: "po-x", supplierId: "sup-1", storedStatus: "SENT", lineCount: 2 }]);
    const table = await screen.findByRole("table", { name: /orders awaiting receipt/i });
    // jsdom cannot measure layout; the contract is structural — labelled cells inside the
    // horizontal-overflow guard, which the 640px stylesheet recomposes into stacked blocks.
    expect(table.closest(".fo-table-scroll")).toBeTruthy();
    const cells = table.querySelectorAll("tbody td");
    expect(cells.length).toBeGreaterThan(0);
    for (const td of cells) expect(td.getAttribute("data-label")).toBeTruthy();
  });
});
