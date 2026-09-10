// SCAN · MOVE STOCK — the mounted multi-scan surface (vitest + jsdom). BIN-P6, Decision #170.
//
// The session rules are proved pure in test/stockMovementSession.test.mjs. These prove what only the
// screen can: that scanning moves nothing, that confirming sends ONE governed command per line with its
// own key, that a partial result is reported line by line with no headline success, that only a
// technical failure is offered for retry -- under the SAME key -- and that a failed line never silently
// disappears.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import MoveStockScan from "../src/modules/scan/MoveStockScan.jsx";

afterEach(cleanup);

let clock = 0;
const scanInputDeps = { now: () => { clock += 5000; return clock; } };

const WAREHOUSES = [{ id: "WH-1", name: "Phoenix" }];
const PARTS = [
  { partId: "PRT-1001", name: "Filter", controlType: "STANDARD", status: "ACTIVE" },
  { partId: "PRT-2002", name: "Compressor", controlType: "SERIALIZED", status: "ACTIVE" },
];

function makeDeps(over = {}) {
  const grants = new Set(over.grants ?? ["inventory.stock.relocate", "inventory.location.bin.read", "inventory.placement.record"]);
  return {
    hasCapability: (id) => grants.has(id),
    sessionId: "sess-test",
    scanInputDeps,
    fetchWarehouses: vi.fn().mockResolvedValue(WAREHOUSES),
    // The governed scanner read (lookupScannedPart): only the Part the scan names, in the shapes
    // buildPartLookup takes. The code is not a registered identifier here.
    lookupPart: vi.fn().mockImplementation(async (raw) => ({
      catalogResult: { ok: true, parts: PARTS.filter((p) => p.partId.toLowerCase() === String(raw).trim().toLowerCase()), invalid: [] },
      aliasOutcome: { result: { result: "NOT_FOUND" } },
    })),
    binClient: {
      resolveBinToken: vi.fn().mockImplementation(async ({ token }) => ({ result: "FOUND", binId: token, warehouseId: "WH-1", code: "A01-003" })),
      resolveBin: vi.fn().mockImplementation(async ({ code }) => (code === "A01-001"
        ? { result: "FOUND", binId: "bin_a01001", warehouseId: "WH-1", code: "A01-001" }
        : { result: "NOT_FOUND" })),
    },
    relocate: vi.fn().mockResolvedValue({ outcome: "relocated" }),
    transferClient: {
      createTransferOrder: vi.fn().mockResolvedValue({ outcome: "applied", transferOrderId: "to-1" }),
      dispatchTransferOrder: vi.fn().mockResolvedValue({ outcome: "applied" }),
    },
    fetchTrucks: vi.fn().mockResolvedValue([{ locationId: "truck-7", label: "Truck 7" }]),
    onPendingWorkChange: vi.fn(),
    ...over,
  };
}

const scan = async (label, value) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form"));
};

// A serialized part resolves asynchronously; only then does the field become "Scan serial number".
async function scanSerialized(serial, partCode = "PRT-2002") {
  await scan("Scan item", partCode);
  await screen.findByLabelText("Scan serial number");
  await scan("Scan serial number", serial);
  await screen.findByLabelText("Scan item");
}

async function setUp(deps) {
  render(<MoveStockScan deps={deps} />);
  await waitFor(() => expect(screen.getByRole("option", { name: "Phoenix" })).toBeTruthy());
  fireEvent.change(screen.getByRole("combobox", { name: "Warehouse" }), { target: { value: "WH-1" } });
}

async function unbinnedToScannedBin(deps) {
  await setUp(deps);
  const from = screen.getByRole("region", { name: "Moving from" });
  fireEvent.click(within(from).getByRole("button", { name: /not in a bin/ }));
  await scan("Scan destination bin", "EOS-LOC:bin_dest0001");
  await waitFor(() => expect(screen.getByText(/Move within this warehouse/)).toBeTruthy());
}

describe("scanning is observation; only confirming moves stock", () => {
  it("scans build lines and send NOTHING until confirm", async () => {
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "PRT-1001");
    await scan("Scan item", "PRT-1001");
    await waitFor(() => expect(screen.getByText("Move 1 line")).toBeTruthy());
    expect(screen.getByRole("cell", { name: "2" })).toBeTruthy();
    expect(deps.relocate).not.toHaveBeenCalled();
  });

  it("a printed label resolves through the TOKEN path, a typed code through the code path", async () => {
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    expect(deps.binClient.resolveBinToken).toHaveBeenCalledWith({ warehouseId: "WH-1", token: "bin_dest0001" });
    cleanup();
    const deps2 = makeDeps();
    await setUp(deps2);
    await scan("Scan source bin", "A01-001");
    await waitFor(() => expect(deps2.binClient.resolveBin).toHaveBeenCalledWith({ warehouseId: "WH-1", code: "A01-001" }));
  });

  it("a serialized part asks for its serial, and the serial becomes its own line", async () => {
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "PRT-2002");
    await waitFor(() => expect(screen.getByText(/Scan the serial number for/)).toBeTruthy());
    await scan("Scan serial number", "SN-77");
    await waitFor(() => expect(screen.getByText("Serial SN-77")).toBeTruthy());
  });

  it("a wedge scanner's back-to-back part + serial is handled in order, not raced", async () => {
    // No waiting between the two scans -- exactly what a hardware scanner does. Handled concurrently,
    // the serial would be looked up as an unknown PART before the part's lookup had finished.
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "PRT-2002");
    fireEvent.change(screen.getByLabelText("Scan item"), { target: { value: "SN-FAST" } });
    fireEvent.submit(screen.getByLabelText("Scan item").closest("form"));
    await waitFor(() => expect(screen.getByText("Serial SN-FAST")).toBeTruthy());
    expect(screen.queryByRole("list", { name: "Scans that did not match" })).toBeNull();
  });

  it("an unmatched scan stays visible instead of vanishing", async () => {
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "NO-SUCH-PART");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Scans that did not match" })).getByText(/NO-SUCH-PART/)).toBeTruthy());
  });

  it("pending work is reported so leaving the screen can be protected", async () => {
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "PRT-1001");
    await waitFor(() => expect(deps.onPendingWorkChange).toHaveBeenLastCalledWith(1));
  });
});

describe("confirming sends one governed command per line", () => {
  it("each line is its own relocateStock call with its own key", async () => {
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "PRT-1001");
    await scanSerialized("SN-1");
    await waitFor(() => expect(screen.getByText("Move 2 lines")).toBeTruthy());
    fireEvent.click(screen.getByText("Move 2 lines"));
    await waitFor(() => expect(deps.relocate).toHaveBeenCalledTimes(2));
    const keys = deps.relocate.mock.calls.map(([req]) => req.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.startsWith("move:sess-test:b1:"))).toBe(true);
    // Put-away onto a bin records the placement too (both capabilities are held here).
    expect(deps.relocate.mock.calls[0][0].recordPlacement).toBe(true);
    await waitFor(() => expect(screen.getByText(/2 moved · 0 already moved · 0 not moved/)).toBeTruthy());
  });

  it("the endpoints on the wire carry no client-derived custody", async () => {
    const deps = makeDeps();
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "PRT-1001");
    fireEvent.click(await screen.findByText("Move 1 line"));
    await waitFor(() => expect(deps.relocate).toHaveBeenCalled());
    const req = deps.relocate.mock.calls[0][0];
    expect(req.source).toEqual({ type: "WAREHOUSE", locationId: "WH-1" });
    expect(req.destination).toEqual({ type: "BIN", locationId: "bin_dest0001" });
  });
});

describe("per-line truth and replay-safe retry", () => {
  const failFor = (serial, code) => Object.assign(new Error("x"), { code: "functions/failed-precondition", details: { code } });

  async function mixedBatch(deps) {
    await unbinnedToScannedBin(deps);
    for (const sn of ["A", "B", "C"]) await scanSerialized(sn);
    fireEvent.click(await screen.findByText("Move 3 lines"));
  }

  it("a partial result is counted line by line; no headline success", async () => {
    const deps = makeDeps({
      relocate: vi.fn().mockImplementation(async (req) => {
        if (req.serialNumbers[0] === "B") throw failFor("B", "SERIAL_NOT_AT_SOURCE");
        if (req.serialNumbers[0] === "C") throw Object.assign(new Error("x"), { code: "functions/unavailable", details: { code: "RETRYABLE_TECHNICAL_FAILURE" } });
        return { outcome: "relocated" };
      }),
    });
    await mixedBatch(deps);
    await waitFor(() => expect(screen.getByText(/1 moved · 0 already moved · 2 not moved/)).toBeTruthy());
    expect(screen.getByText(/That serial is not available at the source location/)).toBeTruthy();
    expect(screen.getByText(/This did not go through. It is safe to try again/)).toBeTruthy();
    expect(screen.queryByText(/^Success/i)).toBeNull();
  });

  it("only the technical failure is retried, under its ORIGINAL key", async () => {
    let cCalls = 0;
    const deps = makeDeps({
      relocate: vi.fn().mockImplementation(async (req) => {
        if (req.serialNumbers[0] === "B") throw failFor("B", "SERIAL_NOT_AT_SOURCE");
        if (req.serialNumbers[0] === "C" && (cCalls += 1) === 1) {
          throw Object.assign(new Error("x"), { code: "functions/unavailable", details: { code: "RETRYABLE_TECHNICAL_FAILURE" } });
        }
        return { outcome: "relocated" };
      }),
    });
    await mixedBatch(deps);
    fireEvent.click(await screen.findByText("Try again (1)"));
    await waitFor(() => expect(screen.getByText(/2 moved · 0 already moved · 1 not moved/)).toBeTruthy());
    const cKeys = deps.relocate.mock.calls.filter(([r]) => r.serialNumbers[0] === "C").map(([r]) => r.idempotencyKey);
    expect(cKeys).toHaveLength(2);
    expect(cKeys[0]).toBe(cKeys[1]);
    expect(deps.relocate.mock.calls.filter(([r]) => r.serialNumbers[0] === "B")).toHaveLength(1);
  });

  it("a failed line never silently disappears behind the next batch", async () => {
    const deps = makeDeps({ relocate: vi.fn().mockRejectedValue(failFor("x", "INSUFFICIENT_STOCK")) });
    await unbinnedToScannedBin(deps);
    await scan("Scan item", "PRT-1001");
    fireEvent.click(await screen.findByText("Move 1 line"));
    await waitFor(() => expect(screen.getByText(/not enough of this at the source/)).toBeTruthy());
    await scan("Scan item", "PRT-1001");
    await waitFor(() => expect(screen.getByText(/Deal with the lines that did not move/)).toBeTruthy());
    expect(screen.getByText("Move 1 line").closest("button").disabled).toBe(true);
    fireEvent.click(screen.getByText(/I have dealt with the lines that did not move/));
    await waitFor(() => expect(screen.getByText("Move 1 line").closest("button").disabled).toBe(false));
  });
});

describe("routing and capability", () => {
  it("a truck is offered only with the transfer capabilities, and becomes a Transfer", async () => {
    const without = makeDeps();
    await setUp(without);
    expect(screen.queryByText("Choose a truck")).toBeNull();
    cleanup();

    const deps = makeDeps({ grants: ["inventory.stock.relocate", "inventory.location.bin.read", "inventory.transfer.create", "inventory.transfer.dispatch"] });
    await setUp(deps);
    await waitFor(() => expect(screen.getByRole("option", { name: "Truck 7" })).toBeTruthy());
    await scan("Scan source bin", "EOS-LOC:bin_src0001");
    await waitFor(() => expect(screen.getByText("A01-003")).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue("Choose a truck"), { target: { value: "truck-7" } });
    await waitFor(() => expect(screen.getByText(/Transfer — the stock leaves this warehouse/)).toBeTruthy());
    await scan("Scan item", "PRT-1001");
    fireEvent.click(await screen.findByText("Move 1 line"));
    await waitFor(() => expect(deps.transferClient.dispatchTransferOrder).toHaveBeenCalledWith({ transferOrderId: "to-1" }));
    expect(deps.relocate).not.toHaveBeenCalled();
    expect(deps.transferClient.createTransferOrder.mock.calls[0][0].destination).toEqual({ type: "MOBILE", locationId: "truck-7" });
  });

  it("a refused warehouse read is shown as a refusal, not an empty list", async () => {
    const deps = makeDeps({ fetchWarehouses: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "permission-denied" })) });
    render(<MoveStockScan deps={deps} />);
    await waitFor(() => expect(screen.getByText(/not authorized to see warehouses/)).toBeTruthy());
  });

  it("the same place twice is refused before anything is scanned", async () => {
    const deps = makeDeps();
    await setUp(deps);
    const from = screen.getByRole("region", { name: "Moving from" });
    fireEvent.click(within(from).getByRole("button", { name: /not in a bin/ }));
    const to = screen.getByRole("region", { name: "Moving to" });
    fireEvent.click(within(to).getByRole("button", { name: /not in a bin/ }));
    await waitFor(() => expect(screen.getByText(/same place/)).toBeTruthy());
    expect(screen.getByLabelText("Scan item").disabled).toBe(true);
  });
});
