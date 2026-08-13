import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReceiveAgainstPurchaseOrder from "../src/modules/receiving/ReceiveAgainstPurchaseOrder";

const fetchLocations = vi.fn();
const submitReceipt = vi.fn();
vi.mock("../src/hooks/useReorderRequests", () => ({ useReorderRequestsByStatuses: () => ({ data: [{ id: "rr-1" }], loading: false }) }));
vi.mock("../src/hooks/usePurchaseOrdersByIds", () => ({ usePurchaseOrdersByIds: () => ({ data: [], loading: false }) }));
vi.mock("../src/domain/purchaseOrdersView", () => ({ PURCHASE_ORDERS_STATUS: { READY: "ready", LOADING: "loading" }, buildPurchaseOrdersView: () => ({ status: "ready", rows: [{ isReceiptCandidate: true, reorderRequestId: "rr-1", partId: "P-1", orderedQuantity: 2, receiptSource: { reorderRequestId: "rr-1", purchaseOrderId: "po-1" } }] }) }));
vi.mock("../src/services/receivingCallableClient", () => ({ fetchReceivingLocationOptions: (...a) => fetchLocations(...a), submitReceiveInventoryStock: (...a) => submitReceipt(...a) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ReceiveAgainstPurchaseOrder", () => {
  it("drives candidate, location, confirmation, receipt, and done", async () => {
    fetchLocations.mockResolvedValue({ status: "ready", options: [{ value: "loc-1", label: "Main bin" }] });
    submitReceipt.mockResolvedValue({ status: "received" });
    const done = vi.fn();
    render(<ReceiveAgainstPurchaseOrder onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: /P-1/i }));
    await screen.findByLabelText(/receiving location/i);
    fireEvent.change(screen.getByLabelText(/receiving location/i), { target: { value: "loc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(submitReceipt).toHaveBeenCalledOnce());
    await screen.findByRole("button", { name: "Done" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalledOnce();
  });
});
