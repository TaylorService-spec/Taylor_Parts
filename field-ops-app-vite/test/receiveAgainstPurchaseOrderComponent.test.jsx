import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReceiveAgainstPurchaseOrder from "../src/modules/receiving/ReceiveAgainstPurchaseOrder";

const fetchLocations = vi.fn();
const submitReceipt = vi.fn();
const fetchParts = vi.fn();

// Mutable per-test candidate rows -- the mocked buildPurchaseOrdersView reads this closure
// variable, so each test can point the component at a different receipt candidate / part.
let candidateRows = [];
function candidateRow({ partId, orderedQuantity = 2, reorderRequestId = "rr-1" }) {
  return {
    isReceiptCandidate: true,
    reorderRequestId,
    partId,
    orderedQuantity,
    receiptSource: { reorderRequestId, purchaseOrderId: "po-1" },
  };
}

vi.mock("../src/hooks/useReorderRequests", () => ({ useReorderRequestsByStatuses: () => ({ data: [{ id: "rr-1" }], loading: false }) }));
vi.mock("../src/hooks/usePurchaseOrdersByIds", () => ({ usePurchaseOrdersByIds: () => ({ data: [], loading: false }) }));
vi.mock("../src/domain/purchaseOrdersView", () => ({
  PURCHASE_ORDERS_STATUS: { READY: "ready", LOADING: "loading" },
  buildPurchaseOrdersView: () => ({ status: "ready", rows: candidateRows }),
}));
vi.mock("../src/services/receivingCallableClient", () => ({ fetchReceivingLocationOptions: (...a) => fetchLocations(...a), submitReceiveInventoryStock: (...a) => submitReceipt(...a) }));
vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: (...a) => fetchParts(...a) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); candidateRows = []; });

// Common happy-path location fixture used by every test.
function readyLocation() {
  fetchLocations.mockResolvedValue({ status: "ready", options: [{ value: "loc-1", label: "Main bin" }] });
}

async function chooseAndSelectLocation(partIdPattern) {
  fireEvent.click(screen.getByRole("button", { name: partIdPattern }));
  await screen.findByLabelText(/receiving location/i);
  fireEvent.change(screen.getByLabelText(/receiving location/i), { target: { value: "loc-1" } });
}

describe("ReceiveAgainstPurchaseOrder — NONE part (legacy flow, unchanged)", () => {
  it("drives candidate, location, confirmation, receipt, and done, sending NO serialNumbers key", async () => {
    candidateRows = [candidateRow({ partId: "P-1", orderedQuantity: 2 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "P-1", controlType: "STANDARD" }], invalid: [] });
    submitReceipt.mockResolvedValue({ status: "applied" });
    const done = vi.fn();
    render(<ReceiveAgainstPurchaseOrder onDone={done} />);
    await chooseAndSelectLocation(/P-1/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // NONE parts skip straight to Confirm -- no serial step is shown.
    fireEvent.click(await screen.findByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(submitReceipt).toHaveBeenCalledOnce());
    const sentInput = submitReceipt.mock.calls[0][0];
    expect(sentInput.lines).toHaveLength(1);
    expect(sentInput.lines[0]).toEqual({ lineId: "rr-1:1", partId: "P-1", expectedQuantity: 2, receivedQuantity: 2 });
    expect(Object.prototype.hasOwnProperty.call(sentInput.lines[0], "serialNumbers")).toBe(false);
    expect(sentInput.idempotencyKey).toBe("receive:rr-1");
    await screen.findByRole("button", { name: "Done" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalledOnce();
  });

  it("retry after a non-terminal outcome resubmits with the SAME idempotency key", async () => {
    candidateRows = [candidateRow({ partId: "P-1", orderedQuantity: 1 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "P-1", controlType: "STANDARD" }], invalid: [] });
    submitReceipt.mockResolvedValueOnce({ status: "conflict" });
    submitReceipt.mockResolvedValueOnce({ status: "applied" });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    await chooseAndSelectLocation(/P-1/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(submitReceipt).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await chooseAndSelectLocation(/P-1/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(submitReceipt).toHaveBeenCalledTimes(2));
    expect(submitReceipt.mock.calls[0][0].idempotencyKey).toBe("receive:rr-1");
    expect(submitReceipt.mock.calls[1][0].idempotencyKey).toBe("receive:rr-1");
  });
});

describe("ReceiveAgainstPurchaseOrder — SERIAL part", () => {
  it("requires exactly orderedQuantity serials, rejects blanks/duplicates, trims but preserves case, and submits them", async () => {
    candidateRows = [candidateRow({ partId: "P-2", orderedQuantity: 2 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "P-2", controlType: "SERIALIZED" }], invalid: [] });
    submitReceipt.mockResolvedValue({ status: "applied" });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    await chooseAndSelectLocation(/P-2/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Landed on the SERIAL capture step -- exactly 2 fields for orderedQuantity 2.
    const serial1 = await screen.findByLabelText("Serial 1");
    const serial2 = screen.getByLabelText("Serial 2");
    expect(screen.getByRole("button", { name: "Continue" }).disabled).toBe(true); // blank -> rejected

    // Duplicate rejected.
    fireEvent.change(serial1, { target: { value: "SN-1" } });
    fireEvent.change(serial2, { target: { value: "SN-1" } });
    expect(screen.getByRole("button", { name: "Continue" }).disabled).toBe(true);
    // Must carry a real, styled error class -- "fo-error" is never defined in index.css,
    // so it renders as unstyled plain text with no visual error treatment.
    expect(screen.getByText(/duplicate serial numbers/i).className).toBe("fo-form-error");

    // Trim whitespace but preserve case; distinct values -> enabled.
    fireEvent.change(serial1, { target: { value: "  AbC-1  " } });
    fireEvent.change(serial2, { target: { value: " xyz-2 " } });
    expect(screen.getByRole("button", { name: "Continue" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(await screen.findByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(submitReceipt).toHaveBeenCalledOnce());
    const sentInput = submitReceipt.mock.calls[0][0];
    expect(sentInput.lines[0]).toEqual({
      lineId: "rr-1:1",
      partId: "P-2",
      expectedQuantity: 2,
      receivedQuantity: 2,
      serialNumbers: ["AbC-1", "xyz-2"],
    });
  });

  it("Enter advances focus to the next serial field (scanner-friendly)", async () => {
    candidateRows = [candidateRow({ partId: "P-2", orderedQuantity: 2 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "P-2", controlType: "SERIALIZED" }], invalid: [] });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    await chooseAndSelectLocation(/P-2/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const serial1 = await screen.findByLabelText("Serial 1");
    const serial2 = screen.getByLabelText("Serial 2");
    fireEvent.change(serial1, { target: { value: "SN-1" } });
    fireEvent.keyDown(serial1, { key: "Enter" });
    expect(document.activeElement).toBe(serial2);
  });
});

describe("ReceiveAgainstPurchaseOrder — LOT part (deliberately not supported)", () => {
  it("blocks with an honest not-supported message and never reaches location selection or Confirm", async () => {
    candidateRows = [candidateRow({ partId: "P-3", orderedQuantity: 1 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "P-3", controlType: "LOT" }], invalid: [] });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /P-3/i }));
    await screen.findByText(/not supported/i);
    expect(screen.queryByLabelText(/receiving location/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(submitReceipt).not.toHaveBeenCalled();
  });
});

describe("ReceiveAgainstPurchaseOrder — Part read failure fails CLOSED", () => {
  it("permission-denied blocks honestly instead of proceeding as NONE", async () => {
    candidateRows = [candidateRow({ partId: "P-4", orderedQuantity: 1 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: false, code: "permission-denied" });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /P-4/i }));
    await screen.findByText(/can't verify this part/i);
    expect(screen.queryByLabelText(/receiving location/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(submitReceipt).not.toHaveBeenCalled();
  });

  it("an unavailable Part read also blocks honestly (never assumes NONE)", async () => {
    candidateRows = [candidateRow({ partId: "P-5", orderedQuantity: 1 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: false, code: "unavailable" });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /P-5/i }));
    await screen.findByText(/can't verify this part/i);
    expect(submitReceipt).not.toHaveBeenCalled();
  });

  it("a partId absent from the Part Master list (not found) also blocks honestly", async () => {
    candidateRows = [candidateRow({ partId: "P-6", orderedQuantity: 1 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "some-other-part", controlType: "STANDARD" }], invalid: [] });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /P-6/i }));
    await screen.findByText(/part not found/i);
    expect(submitReceipt).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────── North Star frame 1d — linear journey truth rules

describe("Frame 1d — journey identity, numbering truth, and the linear stages", () => {
  async function reachConfirm({ row = candidateRow({ partId: "P-1", orderedQuantity: 2 }) } = {}) {
    candidateRows = [row];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: row.partId, controlType: "STANDARD" }], invalid: [] });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    await chooseAndSelectLocation(new RegExp(row.partId, "i"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Confirm receipt" });
  }

  it("renders ONE subordinate journey heading (h2), and never a page H1", async () => {
    await reachConfirm();
    const session = document.querySelector(".fo-reorder-journey");
    expect(session.querySelectorAll("h2")).toHaveLength(1);
    expect(document.querySelector("h1")).toBeNull();
    expect(screen.getByText("Reorder purchase order · full-quantity receipt")).toBeTruthy();
  });

  it("MUTATION PROOF: the opaque reorderRequestId never becomes the journey identity or any visible text", async () => {
    await reachConfirm();
    // "rr-1" is the command's argument, not a fact an operator is shown — anywhere.
    expect(document.body.textContent).not.toContain("rr-1");
  });

  it("MUTATION PROOF: no RR-number is synthesized while the lane is unwired (RCV-G4)", async () => {
    await reachConfirm();
    expect(document.body.textContent).not.toMatch(/RR-\d/);
  });

  it("the governed external PO number is the journey title when present, with the supplier beside it", async () => {
    await reachConfirm({
      row: { ...candidateRow({ partId: "P-1", orderedQuantity: 2 }), externalPoNumber: "TP-88112", supplierName: "Taylor Distribution" },
    });
    const title = document.querySelector(".fo-receiving-session__title");
    expect(title.textContent).toBe("TP-88112");
    expect(screen.getAllByText(/Taylor Distribution/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("No PO number recorded");
  });

  it("its absence is STATED — on the facts line and in the review — never substituted", async () => {
    await reachConfirm();
    expect(screen.getAllByText(/No PO number recorded/).length).toBeGreaterThanOrEqual(2);
  });

  it("MUTATION PROOF: no editable quantity control exists — this lane is full-quantity by contract", async () => {
    await reachConfirm();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect(screen.getAllByText(/2 \(full order\)/).length).toBeGreaterThanOrEqual(2);
    // And no supplier-journey partial vocabulary is imported.
    expect(document.body.textContent).not.toMatch(/partial receipt|partially received|scanned now|remaining after/i);
  });

  it("MUTATION PROOF: Review performs no write — only Confirm reaches the governed submit", async () => {
    submitReceipt.mockResolvedValue({ status: "applied" });
    await reachConfirm();
    expect(submitReceipt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(submitReceipt).toHaveBeenCalledOnce());
  });

  it("MUTATION PROOF: the result never prints a receiving id or a manufactured RO number", async () => {
    submitReceipt.mockResolvedValue({ status: "applied" });
    await reachConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    await screen.findByText("Receipt recorded");
    expect(screen.getByText("The receiving order number is not yet readable here.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/RO-\d/);
  });

  it("a denied location read blocks with its own words and renders NO picker and NO stale selection", async () => {
    candidateRows = [candidateRow({ partId: "P-7", orderedQuantity: 1 })];
    fetchLocations.mockResolvedValue({ status: "denied", options: [] });
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "P-7", controlType: "STANDARD" }], invalid: [] });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /P-7/i }));
    await screen.findByText(/not permitted/i);
    expect(screen.queryByLabelText(/receiving location/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm receipt" })).toBeNull();
  });

  it("the hosted journey itself offers no queue-back control — the workspace owns the single one", async () => {
    await reachConfirm();
    expect(screen.queryByText(/Back to the receipt queue/)).toBeNull();
    // The internal step-back is exactly one control and is a step-back, not a second queue exit.
    expect(screen.getAllByRole("button", { name: "← Back" })).toHaveLength(1);
  });

  it("the step line labels the existing stages without inventing one (2→Destination, 3→Confirm for a NONE part)", async () => {
    candidateRows = [candidateRow({ partId: "P-1", orderedQuantity: 2 })];
    readyLocation();
    fetchParts.mockResolvedValue({ ok: true, parts: [{ partId: "P-1", controlType: "STANDARD" }], invalid: [] });
    render(<ReceiveAgainstPurchaseOrder onDone={vi.fn()} />);
    expect(await screen.findByText(/Step 1 · Choose the purchase order/)).toBeTruthy();
    await chooseAndSelectLocation(/P-1/i);
    expect(screen.getByText(/Step 2 of 3 · Destination/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Step 3 of 3 · Confirm/)).toBeTruthy();
  });

  it("responsive structural contract: the review is label/value rows, and the journey contains no wide table", async () => {
    await reachConfirm();
    expect(document.querySelector(".fo-receive-confirm")).toBeTruthy();
    expect(document.querySelector(".fo-reorder-journey table")).toBeNull();
  });
});
