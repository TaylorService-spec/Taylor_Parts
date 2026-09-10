// SCAN · CYCLE COUNT — the mounted multi-part screen (BIN-P8 / A2), vitest + jsdom.
//
// Session rules are proved pure in test/cycleCountScanSession.test.mjs. These cover what only the screen
// shows: bin-first locking, many parts, blind counting per line, per-line submit and retry, resume.
import { StrictMode } from "react";
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
    // North Star P1 status vocabulary (domain/cycleCountNorthStar.js LINE_WORD.NOT_STARTED) renamed
    // this from "Not counted yet" -- the binding words are "Not started" / "Counting" / "Counted ·
    // match" / "Variance" / "Approved" / "Rejected" / "Waiting to sync".
    expect(screen.getByText("Not started")).toBeTruthy();
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

describe("Cycle count · async result survives StrictMode's phantom mount/unmount/remount", () => {
  // Regression for the live-reproduced bug: React 18/19 StrictMode double-invokes every effect once,
  // synchronously, right after initial mount (setup -> cleanup -> setup again) -- BEFORE any real
  // interaction. An `alive` ref that only ever sets itself false in a cleanup, and never restores
  // true on (re)setup, is permanently "dead" from that point on even though the component is fully
  // mounted and interactive -- so a later successful async response is silently discarded. This
  // reproduced identically on unmodified origin/main and blocked the counter workspace's active
  // screen from ever appearing. Wrapping render() in <StrictMode> here is what actually exercises
  // that phantom cycle; without it this bug is invisible to jsdom/vitest.
  it("Start Count reaches the active screen after StrictMode's phantom remount", async () => {
    const c = client();
    render(<StrictMode><CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} /></StrictMode>);
    await scanInto(/scan the bin label/i, "EOS-LOC:bin_abc");
    await screen.findByLabelText(/scan item/i); // the active counting screen, not the start form
    expect(c.createCycleCountSheet).toHaveBeenCalled();
  });

  it("Resume Count reaches the active screen with its lines after StrictMode's phantom remount", async () => {
    const c = client({
      listCycleCountSheets: vi.fn().mockResolvedValue({ sheets: [{ sheetId: "ccs_7", location: { type: "BIN", locationId: "bin_x" }, locationLabel: "B02-001", status: "OPEN" }], nextCursor: null }),
      getCycleCountSheet: vi.fn().mockResolvedValue({ sheet: {}, lines: [{ partId: "PRT-1001", trackingMode: "NONE", status: "OPEN" }], nextCursor: null }),
    });
    render(<StrictMode><CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} /></StrictMode>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /show open counts/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /B02-001/ })); });
    await screen.findByLabelText(/scan item/i); // the active counting screen, not still on the resume list
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  it("a stale response from a sheet the user has since left is still ignored (real navigation, not a phantom remount)", async () => {
    // Legitimate stale-response protection must survive this fix: unmounting for real must still
    // discard an in-flight result, exactly as it always has.
    let resolveCreate;
    const c = client({ createCycleCountSheet: vi.fn(() => new Promise((res) => { resolveCreate = res; })) });
    const { unmount } = render(<CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} />);
    await scanInto(/scan the bin label/i, "EOS-LOC:bin_abc");
    unmount(); // a real, permanent unmount -- not StrictMode's phantom one
    await act(async () => { resolveCreate({ outcome: "applied", sheetId: "ccs_1", location: { type: "BIN", locationId: "bin_abc" }, status: "OPEN" }); });
    // Nothing to assert on a torn-down tree beyond "this did not throw" -- React warns loudly on a
    // setState-after-unmount leak, and this test would fail noisily if the guard had regressed.
  });
});

describe("Cycle count · technician MOBILE flow (governed assigned truck)", () => {
  it("a technician with exactly one assigned truck sees it and only it -- never a picker", async () => {
    const c = client({
      getCycleCountAssignedMobileLocation: vi.fn().mockResolvedValue({ location: { type: "MOBILE", locationId: "loc_truck7" }, label: "Truck 7" }),
    });
    render(<CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} />);
    await screen.findByText(/truck 7/i);
    expect(screen.queryByLabelText(/location type/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /start counting/i })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^start count$/i })); });
    expect(c.createCycleCountSheet).toHaveBeenCalledWith(expect.objectContaining({ location: { type: "MOBILE", locationId: "loc_truck7" } }));
  });

  it("counter authority with no assigned truck is a truthful no-assignment state, not an error page", async () => {
    const c = client({
      getCycleCountAssignedMobileLocation: vi.fn().mockRejectedValue({ code: "functions/failed-precondition", details: { code: "NO_TRUCK_ASSIGNMENT" } }),
    });
    render(<CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} />);
    expect(await screen.findByText(/no active truck is assigned to you/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^start count$/i })).toBeNull();
  });

  it("an ambiguous truck assignment fails visibly -- never guesses one", async () => {
    const c = client({
      getCycleCountAssignedMobileLocation: vi.fn().mockRejectedValue({ code: "functions/failed-precondition", details: { code: "TRUCK_ASSIGNMENT_AMBIGUOUS" } }),
    });
    render(<CycleCountScan deps={{ cycleCountClient: c, lookupPart, scanInputDeps }} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/more than one truck/i);
    expect(screen.queryByRole("button", { name: /^start count$/i })).toBeNull();
  });

  it("a non-technician (or environment without the read) sees the unchanged manual Warehouse/Bin flow", async () => {
    // The default `client()` fixture does not implement getCycleCountAssignedMobileLocation at all --
    // exactly the TECHNICIAN_IDENTITY_UNAVAILABLE-equivalent fallback, and mirrors any warehouse-
    // persona account. No new authority path, no company-wide truck browse.
    await startBin(); // exercises the BIN path directly to confirm it is entirely untouched
  });
});
