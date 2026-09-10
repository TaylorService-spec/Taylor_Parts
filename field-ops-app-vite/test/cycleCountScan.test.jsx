// SCAN · CYCLE COUNT — the mounted multi-part screen (BIN-P8 / A2), vitest + jsdom.
//
// Session rules are proved pure in test/cycleCountScanSession.test.mjs. These cover what only the screen
// shows: bin-first locking, many parts, blind counting per line, per-line submit and retry, resume.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import CycleCountScan from "../src/modules/scan/CycleCountScan.jsx";

afterEach(cleanup);

// Identical scans in one millisecond are suppressed as wedge stutter; drive an advancing clock.
let clock = 0;
const scanInputDeps = { now: () => { clock += 1000; return clock; } };

const PARTS = {
  "PRT-1001": { invalid: false, partId: "PRT-1001", internalPartNumber: "TS-1001", name: "Relay", description: "", category: "", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 1 },
  "PRT-1002": { invalid: false, partId: "PRT-1002", internalPartNumber: "TS-1002", name: "Fuse", description: "", category: "", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 1 },
  "PRT-2001": { invalid: false, partId: "PRT-2001", internalPartNumber: "TS-2001", name: "Compressor", description: "", category: "", status: "ACTIVE", stockingUnit: "EACH", controlType: "SERIALIZED", stockingClass: "STOCKED", version: 1 },
};
const lookupPart = vi.fn(async (raw) => {
  const p = PARTS[String(raw).trim().toUpperCase()];
  return { catalogResult: { ok: true, parts: p ? [p] : [], invalid: [] }, aliasOutcome: { result: { result: "NOT_FOUND" } } };
});

function client(over = {}) {
  const tracking = (id) => (PARTS[id]?.controlType === "SERIALIZED" ? "SERIAL" : "NONE");
  return {
    createCycleCountSheet: vi.fn().mockResolvedValue({ outcome: "applied", sheetId: "ccs_1", location: { type: "BIN", locationId: "bin_abc" }, status: "OPEN" }),
    getCycleCountSheet: vi.fn().mockResolvedValue({ sheet: { sheetId: "ccs_1", location: { type: "BIN", locationId: "bin_abc" }, locationLabel: "A01-003", status: "OPEN" }, lines: [], nextCursor: null }),
    // The open response deliberately carries NO expected value -- even if a server bug added one, the screen must not show it.
    openCycleCountLine: vi.fn(async ({ partId }) => ({ outcome: "applied", sheetId: "ccs_1", partId, trackingMode: tracking(partId), status: "OPEN", expectedQuantity: 77 })),
    submitCycleCountLine: vi.fn(async (req) => ({
      outcome: "applied", status: "COUNTED", partId: req.partId,
      ...(req.countedSerialNumbers ? { countedSerialNumbers: req.countedSerialNumbers, serialVariance: { missing: [], unexpected: [] }, expectedQuantity: req.countedSerialNumbers.length }
        : { countedQuantity: req.countedQuantity, variance: req.countedQuantity - 5, expectedQuantity: 5 }),
    })),
    cancelCycleCountLine: vi.fn().mockResolvedValue({ outcome: "applied", status: "CANCELLED" }),
    listCycleCountSheets: vi.fn().mockResolvedValue({ sheets: [], nextCursor: null }),
    ...over,
  };
}

async function scanInto(label, value) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  });
}
async function startBin(c = client(), deps = {}) {
  render(<CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps, ...deps }} />);
  await scanInto(/scan the bin label/i, "EOS-LOC:bin_abc");
  await screen.findByLabelText(/scan item/i);
  return c;
}
const item = (v) => scanInto(/scan item|scan the serial number/i, v);

describe("Cycle count · bin first, many parts", () => {
  it("scanning a bin label locks the sheet to that Bin, shown by its code", async () => {
    const c = await startBin();
    expect(c.createCycleCountSheet).toHaveBeenCalledWith(expect.objectContaining({ location: { type: "BIN", locationId: "bin_abc" } }));
    expect(screen.getByText("A01-003")).toBeTruthy();
  });

  it("a bin the server refuses (not converted) says why and starts nothing", async () => {
    const c = client({ createCycleCountSheet: vi.fn().mockRejectedValue({ code: "functions/failed-precondition", details: { code: "LOCATION_INVALID" } }) });
    render(<CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} />);
    await scanInto(/scan the bin label/i, "EOS-LOC:bin_abc");
    expect((await screen.findByRole("alert")).textContent).toMatch(/bin conversion/i);
    expect(screen.queryByLabelText(/scan item/i)).toBeNull();
  });

  it("repeat scans aggregate; each new part opens its own line; nothing expected is shown", async () => {
    const c = await startBin();
    await item("PRT-1001"); await item("PRT-1001"); await item("PRT-1002");
    expect(c.openCycleCountLine).toHaveBeenCalledTimes(2);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/\b77\b/);
    expect(document.body.textContent).not.toMatch(/expected \d/i);
    expect(screen.getByRole("button", { name: /submit 2 counts/i })).toBeTruthy();
  });

  it("serials stay individual and a duplicate is refused", async () => {
    await startBin();
    await item("PRT-2001"); await item("S-1");
    await item("PRT-2001"); await item("S-1");
    expect(screen.getByText(/already counted/i)).toBeTruthy();
    expect(screen.getByText("S-1")).toBeTruthy();
  });

  it("an unknown code is listed, never dropped, and opens nothing", async () => {
    const c = await startBin();
    await item("NOPE-1");
    expect(screen.getByLabelText(/scans that did not match/i).textContent).toMatch(/NOPE-1/);
    expect(c.openCycleCountLine).not.toHaveBeenCalled();
  });

  it("correction before submit: −1 and 'None here' (a real zero)", async () => {
    const c = await startBin();
    await item("PRT-1001"); await item("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: "−1" }));
    fireEvent.click(screen.getByRole("button", { name: /none here/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /submit 1 count/i })); });
    expect(c.submitCycleCountLine).toHaveBeenCalledWith({ sheetId: "ccs_1", partId: "PRT-1001", countedQuantity: 0 });
  });
});

describe("Cycle count · submit per line", () => {
  it("each line submits on its own and ONLY then shows its own expected value", async () => {
    const c = await startBin();
    await item("PRT-1001"); await item("PRT-1002");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /submit 2 counts/i })); });
    await waitFor(() => expect(c.submitCycleCountLine).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText(/expected 5/i)).toHaveLength(2);
  });

  it("a technical failure is retried alone; a business refusal is not offered a retry", async () => {
    let first = true;
    const c = await startBin(client({
      submitCycleCountLine: vi.fn(async (req) => {
        if (req.partId === "PRT-1001" && first) { first = false; throw { code: "functions/unavailable" }; }
        if (req.partId === "PRT-1002") throw { code: "functions/failed-precondition", details: { code: "STATUS_INVALID" } };
        return { outcome: "applied", status: "COUNTED", countedQuantity: req.countedQuantity, variance: 0, expectedQuantity: req.countedQuantity };
      }),
    }));
    await item("PRT-1001"); await item("PRT-1002");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /submit 2 counts/i })); });
    const retry = await screen.findByRole("button", { name: /try again \(1\)/i });
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(c.submitCycleCountLine.mock.calls.filter(([r]) => r.partId === "PRT-1001")).toHaveLength(2));
    expect(c.submitCycleCountLine.mock.calls.filter(([r]) => r.partId === "PRT-1002")).toHaveLength(1);
    expect(screen.getByText(/no longer allows/i)).toBeTruthy();
  });

  it("submitting moves no stock -- the screen has no reconcile path", async () => {
    const c = await startBin();
    expect(c.reconcileCycleCountLine).toBeUndefined();
    expect(screen.queryByRole("button", { name: /approve|reconcile/i })).toBeNull();
  });
});

describe("Cycle count · resume", () => {
  it("an open sheet resumes with its lines; counted lines keep their own figures", async () => {
    const c = client({
      listCycleCountSheets: vi.fn().mockResolvedValue({ sheets: [{ sheetId: "ccs_7", location: { type: "BIN", locationId: "bin_x" }, locationLabel: "B02-001", status: "OPEN" }], nextCursor: null }),
      getCycleCountSheet: vi.fn()
        .mockResolvedValueOnce({ sheet: {}, lines: [{ partId: "PRT-1001", trackingMode: "NONE", status: "COUNTED", countedQuantity: 4, variance: -1, expectedQuantity: 5 }], nextCursor: "c1" })
        .mockResolvedValueOnce({ sheet: {}, lines: [{ partId: "PRT-1002", trackingMode: "NONE", status: "OPEN" }], nextCursor: null }),
    });
    render(<CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /show open counts/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /B02-001/ })); });
    await screen.findByLabelText(/scan item/i);
    expect(c.getCycleCountSheet).toHaveBeenCalledTimes(2); // every page, never just the first
    expect(screen.getByText(/expected 5/i)).toBeTruthy();
    expect(screen.getByText(/not counted yet/i)).toBeTruthy();
  });

  it("pending work is reported in scans, and leaving reports zero", async () => {
    const onPendingWorkChange = vi.fn();
    await startBin(client(), { onPendingWorkChange });
    await item("PRT-1001"); await item("PRT-1001"); await item("PRT-1001");
    expect(onPendingWorkChange.mock.calls.at(-1)[0]).toBe(3);
    cleanup();
    expect(onPendingWorkChange.mock.calls.at(-1)[0]).toBe(0);
  });
});
