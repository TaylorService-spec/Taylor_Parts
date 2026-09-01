// MULTI-SCAN RECEIVING — the canonical warehouse journey (vitest + jsdom).
//
// The queue's rules are proved in test/receivingScanQueue.test.mjs as pure functions. These cover
// what only the assembled screen shows: that the journey works end to end, that the four not-ready
// states stay distinct, that a blocked scan cannot be submitted past, and that nothing leaves the
// browser until Submit.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import MultiScanReceiving from "../src/modules/receiving/MultiScanReceiving.jsx";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";

afterEach(cleanup);

const progressLine = (over = {}) => ({
  lineId: "L1", partId: "P1", trackingMode: "NONE",
  orderedQuantity: 5, receivedQuantity: 0, remainingQuantity: 5, state: "NOT_RECEIVED", ...over,
});

const progress = (over = {}) => ({
  purchaseOrderId: "PO-1", supplierId: "SUP-1", supplierName: "Acme",
  storedStatus: "SENT", derivedState: "NOT_RECEIVED", receivable: true, version: 0,
  lines: [progressLine()], ...over,
});

function deps(over = {}) {
  return {
    fetchReceivablePurchaseOrders: vi.fn().mockResolvedValue({
      status: RECEIVING_OUTCOME.READY,
      purchaseOrders: [{ purchaseOrderId: "PO-1", supplierId: "SUP-1", storedStatus: "SENT", lineCount: 1 }],
    }),
    fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.READY, progress: progress() }),
    fetchReceivingLocationOptions: vi.fn().mockResolvedValue({
      status: RECEIVING_OUTCOME.READY, options: [{ locationId: "WH-1", label: "Main warehouse" }],
    }),
    submitCanonicalReceive: vi.fn().mockResolvedValue({
      status: RECEIVING_OUTCOME.APPLIED,
      receipt: {
        outcome: "applied", receivingId: "rcvc_1", purchaseOrderId: "PO-1", ledgerEventId: "led-1",
        derivedState: "PARTIALLY_RECEIVED", storedStatus: "SENT",
        lines: [{ lineId: "L1", partId: "P1", orderedQuantity: 5, previouslyReceived: 0, receivedNow: 2, remainingQuantity: 3, state: "PARTIALLY_RECEIVED" }],
      },
    }),
    ...over,
  };
}

async function openOrder(d) {
  render(<MultiScanReceiving deps={d} />);
  fireEvent.click(await screen.findByRole("button", { name: "PO-1" }));
  await screen.findByLabelText(/^part$/i);
}

const scanPart = (partId, serial = "") => {
  fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: partId } });
  if (serial) fireEvent.change(screen.getByLabelText(/^serial$/i), { target: { value: serial } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
};

// ────────────────────────────────────────────── the journey

describe("Multi-scan receiving (the journey)", () => {
  it("lists receivable orders and opens one — identity is the governed supplier, never the id", async () => {
    // This assertion used to pin the OPPOSITE: `heading { name: "PO-1" }` — the opaque document id
    // promoted to the journey title. North Star frame 1b corrected the surface (RCV-G5: no business
    // order number exists, so the supplier name is the human identity and the number's absence is
    // stated), and the test moved with it rather than restating the old claim.
    const d = deps();
    await openOrder(d);
    expect(d.fetchPurchaseOrderProgress).toHaveBeenCalledWith("PO-1");
    expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "PO-1" })).toBeNull();
  });

  it("shows the ordered lines with what was already received and what is outstanding", async () => {
    await openOrder(deps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.READY,
        progress: progress({ lines: [progressLine({ receivedQuantity: 2, remainingQuantity: 3, state: "PARTIALLY_RECEIVED" })] }),
      }),
    }));
    const table = screen.getByRole("table", { name: /expected versus observed/i });
    const row = within(table).getByText("P1").closest("tr");
    const cells = [...row.querySelectorAll("td")].map((c) => c.textContent.trim());
    expect(cells).toContain("5"); // ordered
    expect(cells).toContain("2"); // already received
    expect(cells).toContain("3"); // outstanding
  });

  it("counts repeated scans against the line, and remaining-after follows", async () => {
    await openOrder(deps());
    scanPart("P1"); scanPart("P1");
    const table = screen.getByRole("table", { name: /expected versus observed/i });
    const row = within(table).getByText("P1").closest("tr");
    expect(within(row).getByText("2")).toBeTruthy(); // scanned now
    expect(screen.getByText(/2 scans · 2 units queued/i)).toBeTruthy();
  });

  it("SCANNING SENDS NOTHING — the queue is local until Submit", async () => {
    const d = deps();
    await openOrder(d);
    scanPart("P1"); scanPart("P1"); scanPart("P1");
    expect(d.submitCanonicalReceive).not.toHaveBeenCalled();
  });

  it("undo removes the last scan", async () => {
    await openOrder(deps());
    scanPart("P1"); scanPart("P1");
    fireEvent.click(screen.getByRole("button", { name: /undo last scan/i }));
    expect(screen.getByText(/1 scan · 1 unit queued/i)).toBeTruthy();
  });

  it("an individual entry can be removed without rescanning the rest", async () => {
    await openOrder(deps());
    scanPart("P1"); scanPart("P1");
    const queued = screen.getByRole("region", { name: /queued scans/i });
    fireEvent.click(within(queued).getAllByRole("button", { name: /^remove$/i })[0]);
    expect(screen.getByText(/1 scan · 1 unit queued/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── blocked scans

describe("Multi-scan receiving (blocked scans are never submitted past)", () => {
  it("a part NOT on the order is surfaced and blocks submission", async () => {
    const d = deps();
    await openOrder(d);
    scanPart("GHOST");
    expect(await screen.findByText(/not on this purchase order/i)).toBeTruthy();
    const submit = screen.getByRole("button", { name: /submit receipt/i });
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(d.submitCanonicalReceive).not.toHaveBeenCalled();
  });

  it("OVER-RECEIPT is blocked, and names the scan that crossed the limit", async () => {
    await openOrder(deps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.READY,
        progress: progress({ lines: [progressLine({ orderedQuantity: 1, remainingQuantity: 1 })] }),
      }),
    }));
    scanPart("P1"); scanPart("P1");
    expect(await screen.findByText(/more than the outstanding quantity/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /submit receipt/i }).disabled).toBe(true);
  });

  it("removing the blocked scan re-enables submission", async () => {
    await openOrder(deps());
    scanPart("P1");
    scanPart("GHOST");
    const blockedRegion = await screen.findByRole("region", { name: /blocked scans/i });
    fireEvent.click(within(blockedRegion).getByRole("button", { name: /^remove$/i }));
    fireEvent.change(screen.getByLabelText(/receiving location/i), { target: { value: "WH-1" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /submit receipt/i }).disabled).toBe(false));
  });

  it("a duplicate serial is blocked and not counted", async () => {
    await openOrder(deps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.READY,
        progress: progress({ lines: [progressLine({ trackingMode: "SERIAL", orderedQuantity: 2, remainingQuantity: 2 })] }),
      }),
    }));
    scanPart("P1", "S1");
    scanPart("P1", "S1");
    expect(await screen.findByText(/already scanned/i)).toBeTruthy();
    expect(screen.getByText(/2 scans · 1 unit queued/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── submission

describe("Multi-scan receiving (submission and receipt)", () => {
  const readyToSubmit = async (d) => {
    await openOrder(d);
    scanPart("P1"); scanPart("P1");
    fireEvent.change(screen.getByLabelText(/receiving location/i), { target: { value: "WH-1" } });
  };

  it("submits ONE batch with per-line quantities, the destination, a key and the version", async () => {
    const d = deps();
    await readyToSubmit(d);
    fireEvent.click(screen.getByRole("button", { name: /submit receipt/i }));
    await waitFor(() => expect(d.submitCanonicalReceive).toHaveBeenCalledTimes(1));
    const payload = d.submitCanonicalReceive.mock.calls[0][0];
    expect(payload.source).toEqual({ type: "PURCHASE_ORDER", purchaseOrderId: "PO-1" });
    expect(payload.receivingLocation).toEqual({ type: "WAREHOUSE", locationId: "WH-1" });
    expect(payload.lines).toEqual([{ lineId: "L1", partId: "P1", receivedQuantity: 2 }]);
    expect(payload.idempotencyKey).toBeTruthy();
    // Optimistic concurrency against the order the operator actually looked at.
    expect(payload.expectedVersion).toBe(0);
  });

  it("shows the PER-LINE receipt and the updated progress", async () => {
    const d = deps();
    await readyToSubmit(d);
    fireEvent.click(screen.getByRole("button", { name: /submit receipt/i }));
    // Found by its role="status" rather than as a region: the receipt is announced to assistive
    // technology when it arrives, which is the whole point of it being a live region.
    const receipt = await screen.findByRole("status");
    expect(within(receipt).getByText(/received 2, 3 still outstanding/i)).toBeTruthy();
    // "partially received" appears twice on purpose — once as the LINE state and once as the
    // order's derived progress. They are different facts about different scopes, so both are shown.
    expect(within(receipt).getAllByText(/partially received/i).length).toBeGreaterThanOrEqual(2);
  });

  it("re-reads the order after a receipt rather than patching it locally", async () => {
    const d = deps();
    await readyToSubmit(d);
    expect(d.fetchPurchaseOrderProgress).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /submit receipt/i }));
    await waitFor(() => expect(d.fetchPurchaseOrderProgress).toHaveBeenCalledTimes(2));
  });

  it("the queue is emptied after a successful receipt", async () => {
    const d = deps();
    await readyToSubmit(d);
    fireEvent.click(screen.getByRole("button", { name: /submit receipt/i }));
    await waitFor(() => expect(screen.getByText(/nothing scanned yet/i)).toBeTruthy());
  });

  it("a REPLAY is reported as already recorded, not as a fresh receipt", async () => {
    const d = deps({
      submitCanonicalReceive: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.REPLAYED,
        receipt: {
          outcome: "replayed", receivingId: "rcvc_1", purchaseOrderId: "PO-1", ledgerEventId: "led-1",
          derivedState: "PARTIALLY_RECEIVED", storedStatus: "SENT",
          lines: [{ lineId: "L1", partId: "P1", orderedQuantity: 5, previouslyReceived: 0, receivedNow: 2, remainingQuantity: 3, state: "PARTIALLY_RECEIVED" }],
        },
      }),
    });
    await readyToSubmit(d);
    fireEvent.click(screen.getByRole("button", { name: /submit receipt/i }));
    expect(await screen.findByRole("heading", { name: /already recorded/i })).toBeTruthy();
  });

  it("a REFUSED receipt says nothing was received", async () => {
    const d = deps({ submitCanonicalReceive: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.CONFLICT, receipt: null }) });
    await readyToSubmit(d);
    fireEvent.click(screen.getByRole("button", { name: /submit receipt/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/nothing was received/i);
  });

  it("a destination is required before submitting", async () => {
    await openOrder(deps());
    scanPart("P1");
    const submit = screen.getByRole("button", { name: /submit receipt/i });
    expect(submit.disabled).toBe(true);
    expect(submit.title || submit.getAttribute("data-reason") || "").toBeDefined();
  });
});

// ────────────────────────────────────────────── not-ready states

describe("Multi-scan receiving (an unread list is never an empty one)", () => {
  it("transport switched off reads as UNAVAILABLE, not as 'no orders'", async () => {
    render(<MultiScanReceiving deps={deps({
      fetchReceivablePurchaseOrders: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] }),
    })} />);
    const msg = await screen.findByText(/not switched on in this environment/i);
    expect(msg.textContent).toMatch(/not an empty list/i);
    expect(screen.queryByText(/no purchase orders are awaiting receipt/i)).toBeNull();
  });

  it("a DENIAL reads as a denial", async () => {
    render(<MultiScanReceiving deps={deps({
      fetchReceivablePurchaseOrders: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.DENIED, purchaseOrders: [] }),
    })} />);
    expect(await screen.findByText(/not authorized to receive stock/i)).toBeTruthy();
  });

  it("a genuinely empty list is the ONE case that says so", async () => {
    render(<MultiScanReceiving deps={deps({
      fetchReceivablePurchaseOrders: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.READY, purchaseOrders: [] }),
    })} />);
    expect(await screen.findByText(/no purchase orders are awaiting receipt/i)).toBeTruthy();
  });

  it("an order that is not receivable says so", async () => {
    await openOrder(deps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.READY, progress: progress({ receivable: false, storedStatus: "DRAFT" }),
      }),
    }));
    expect(screen.getByText(/not in a state that accepts a receipt/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── scope

describe("Multi-scan receiving (out-of-scope operations are absent, not disabled)", () => {
  it("offers no put-away, bin, transfer, return, close-short or amendment control", async () => {
    // These are absent because no governed command exists for them. A disabled control would imply
    // one does and that the operator merely lacks permission.
    await openOrder(deps());
    for (const forbidden of [/put.?away/i, /\bbin\b/i, /transfer/i, /return/i, /close short/i, /amend/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
  });

  it("states that a short line stays open", async () => {
    await openOrder(deps());
    expect(screen.getByText(/still short stays open/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── North Star frame 1b — identity & id truth

describe("Frame 1b — journey identity and RCV-G5/G7 truth rules", () => {
  it("renders ONE journey title and states the missing order number instead of substituting anything", async () => {
    await openOrder(deps());
    const session = document.querySelector(".fo-receiving-session");
    expect(session.querySelectorAll("h2")).toHaveLength(1);
    expect(session.querySelector("h2").textContent).toBe("Acme");
    expect(screen.getByText(/No order number recorded/)).toBeTruthy();
  });

  it("MUTATION PROOF: the opaque purchaseOrderId never renders inside the session", async () => {
    // The id is the navigation argument, not a label. If any element prints it — title, facts
    // line, loading copy, receipt — this fails.
    await openOrder(deps());
    expect(document.querySelector(".fo-receiving-session").textContent).not.toContain("PO-1");
  });

  it("MUTATION PROOF: no PO-number is synthesized anywhere on the surface", async () => {
    await openOrder(deps());
    expect(document.body.textContent).not.toMatch(/PO-\d{4}/);
  });

  it("falls back to a truthful generic title when the read carries no supplier name", async () => {
    await openOrder(deps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.READY,
        progress: progress({ supplierName: null }),
      }),
    }));
    expect(screen.getByRole("heading", { name: "Supplier purchase order" })).toBeTruthy();
  });

  it("MUTATION PROOF: no claimed purchase-order scan identifier returns (RCV-G7)", async () => {
    // Scanning a PART is existing governed behaviour and stays; a field claiming the ORDER itself
    // is scannable would assert a scan-label authority that does not exist.
    await openOrder(deps());
    expect(document.body.textContent).not.toMatch(/scan (the|a|an) (purchase )?order/i);
    expect(screen.getByLabelText(/^part$/i)).toBeTruthy();
  });

  it("stored order status renders in words only when the read carries one", async () => {
    await openOrder(deps());
    expect(screen.getByText(/order status/).textContent).toMatch(/Sent to supplier/);
    cleanup();
    await openOrder(deps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({
        status: RECEIVING_OUTCOME.READY,
        progress: progress({ storedStatus: null }),
      }),
    }));
    expect(screen.queryByText(/order status/)).toBeNull();
  });

  it("MUTATION PROOF: an unreadable order never becomes a table of zeros", async () => {
    // Missing progress must stay an explicit failure — recomposing it as lines with "0 received"
    // would fabricate progress the read never returned.
    render(<MultiScanReceiving deps={deps({
      fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({ status: "failed", progress: null }),
    })} initialPurchaseOrderId="PO-1" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/The order could not be loaded/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).not.toContain("PO-1");
  });

  it("opened from the workspace (onExit), the session renders no duplicate internal back link", async () => {
    const onExit = vi.fn();
    render(<MultiScanReceiving deps={deps()} initialPurchaseOrderId="PO-1" onExit={onExit} />);
    await screen.findByLabelText(/^part$/i);
    // The workspace owns the single "Back to the receipt queue" affordance (frame 1a); a second
    // stacked back link here is the duplicate-affordance clutter the recomposition removed.
    expect(screen.queryByRole("button", { name: /choose a different purchase order/i })).toBeNull();
  });

  it("every reconciliation cell carries the data-label the handheld stacked layout keys on", async () => {
    await openOrder(deps());
    const table = screen.getByRole("table", { name: /expected versus observed/i });
    expect(table.closest(".fo-table-scroll")).toBeTruthy();
    const cells = table.querySelectorAll("tbody td");
    expect(cells.length).toBeGreaterThan(0);
    for (const td of cells) expect(td.getAttribute("data-label")).toBeTruthy();
  });

  it("MUTATION PROOF (frame 1e): a failed location read is never an innocently empty destination picker", async () => {
    // This select used to receive only `res.options ?? []`, so DENIED / UNAVAILABLE / a failure all
    // rendered as a pickable-looking empty list. Each is now its own sentence, the picker is
    // disabled, and the protected submit repeats that state instead of advising "choose one".
    const cases = [
      [RECEIVING_OUTCOME.DENIED, /not authorized to read receiving locations/i],
      [RECEIVING_OUTCOME.UNAVAILABLE, /cannot be read right now/i],
      ["failed", /could not be loaded/i],
    ];
    for (const [status, sentence] of cases) {
      cleanup();
      await openOrder(deps({
        fetchReceivingLocationOptions: vi.fn().mockResolvedValue({ status, options: [] }),
      }));
      const picker = await screen.findByLabelText(/receiving location/i);
      expect(picker.disabled).toBe(true);
      expect(picker.querySelectorAll("option")).toHaveLength(1); // placeholder only, nothing fabricated
      expect(screen.getByText(sentence)).toBeTruthy();
      // And the failure is never the EMPTY claim.
      expect(screen.queryByText(/No eligible receiving location is available/)).toBeNull();
    }
  });

  it("location EMPTY is its own truthful claim, distinct from every failure", async () => {
    await openOrder(deps({
      fetchReceivingLocationOptions: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.READY, options: [] }),
    }));
    expect(await screen.findByText("No eligible receiving location is available.")).toBeTruthy();
    expect(screen.queryByText(/could not be loaded|not authorized|cannot be read/i)).toBeNull();
  });

  it("a READY location option renders its governed label and never the raw locationId", async () => {
    await openOrder(deps());
    const picker = screen.getByLabelText(/receiving location/i);
    expect(picker.textContent).toContain("Main warehouse");
    expect(picker.textContent).not.toContain("WH-1");
  });

  it("the legacy standalone picker presents the id as an internal reference, never a scan target", async () => {
    render(<MultiScanReceiving deps={deps()} />);
    expect(await screen.findByLabelText(/order id/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/internal order id/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/scan the order/i);
    // The raw supplierId from the list read does not render.
    expect(document.body.textContent).not.toContain("SUP-1");
  });
});
