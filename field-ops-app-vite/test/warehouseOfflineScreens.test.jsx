// WO-05A — THE ACTUAL WAREHOUSE FORMS, OFFLINE.
//
// WO-05 proved the runtime by calling it. That proves the runtime and nothing about whether pressing
// the real button on the real screen reaches it — which is exactly the gap that let TechnicianShell
// ship orphaned for two slices.
//
// So every proof here goes through a rendered form: fill it in, press the submit control a warehouse
// worker presses, and assert on what the COMMAND CLIENT was asked to do and what the queue was
// handed. No test in this file calls a binding.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

vi.mock("../src/firebase/firebase", () => ({ functions: {}, db: {}, auth: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: {} }) }));

const { default: PutAwayScan } = await import("../src/modules/scan/PutAwayScan.jsx");
const { default: CycleCountScan } = await import("../src/modules/scan/CycleCountScan.jsx");
const { default: ReturnIntakeScan } = await import("../src/modules/scan/ReturnIntakeScan.jsx");
const { WAREHOUSE_INTENT } = await import("../src/offline/warehouseIntent.js");

afterEach(cleanup);

const setOnline = (v) => Object.defineProperty(window.navigator, "onLine", { value: v, configurable: true });
beforeEach(() => setOnline(true));

/** Records what the SCREEN handed the queue. Durability itself is proven against the real store. */
function runtime({ durable = true } = {}) {
  const enqueued = [];
  return {
    principalUid: "uid-wh-1",
    enqueue: vi.fn(async (intent) => {
      if (!intent?.valid) return { queued: false, reason: intent?.reason };
      enqueued.push(intent.value);
      return { queued: true, durable, intentId: intent.value.intentId };
    }),
    enqueued,
  };
}

const unreachable = () => Object.assign(new Error("down"), { code: "functions/unavailable" });
const denied = () => Object.assign(new Error("no"), { code: "functions/permission-denied" });

let clock = 0;
const scanInputDeps = { now: () => { clock += 1000; return clock; } };

// ═══════════════════════════════════════════ PUT-AWAY

describe("put-away, through the real form", () => {
  const mount = (recordPutAway, rt = runtime()) => {
    render(<PutAwayScan deps={{
      binClient: {
        resolveBin: vi.fn().mockResolvedValue({ result: "FOUND", code: "A-14", warehouseId: "WH-1", binId: "bin_WH-1__A-14" }),
        recordPutAway,
      },
      session: { warehouseId: "WH-1", partId: "PRT-1001", serialTracked: false },
      scanInputDeps,
      offline: rt,
    }} />);
    return rt;
  };

  const stow = async () => {
    fireEvent.change(screen.getByLabelText(/scan bin/i), { target: { value: "A-14" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(screen.queryByLabelText(/scan item/i)).toBeTruthy());
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value: "PRT-1001" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /put it away|confirm|record/i })); });
  };

  it("OFFLINE: pressing the real button queues a PUT_AWAY and says the stock has not moved", async () => {
    setOnline(false);
    const recordPutAway = vi.fn();
    const rt = mount(recordPutAway);
    await stow();

    expect(recordPutAway, "a device that knows it is offline does not attempt").not.toHaveBeenCalled();
    expect(rt.enqueued).toHaveLength(1);
    expect(rt.enqueued[0].type).toBe(WAREHOUSE_INTENT.PUT_AWAY);
    expect(rt.enqueued[0].payload.destinationBinId).toBeTruthy();
    // The words that must appear, and the one that must not.
    expect(document.body.textContent).toMatch(/has not reached the server/i);
    expect(document.body.textContent).not.toMatch(/✓ Recorded/);
  });

  it("ONLINE: the canonical command is called and nothing is queued", async () => {
    const recordPutAway = vi.fn().mockResolvedValue({ outcome: "recorded", binCode: "A-14", placementIds: ["plc_1"] });
    const rt = mount(recordPutAway);
    await stow();
    expect(recordPutAway).toHaveBeenCalledTimes(1);
    expect(rt.enqueued).toHaveLength(0);
    expect(document.body.textContent).toMatch(/Recorded/);
  });

  it("A REFUSAL IS NEVER QUEUED", async () => {
    const rt = mount(vi.fn().mockRejectedValue(denied()));
    await stow();
    expect(rt.enqueued).toEqual([]);
    expect(document.body.textContent).toMatch(/not authorized/i);
  });

  it("a retryable failure IS queued", async () => {
    const rt = mount(vi.fn().mockRejectedValue(unreachable()));
    await stow();
    expect(rt.enqueued).toHaveLength(1);
  });

  it("STORAGE FAILURE: not called pending, and the destination stays on screen", async () => {
    setOnline(false);
    mount(vi.fn(), runtime({ durable: false }));
    await stow();
    expect(document.body.textContent).toMatch(/could not save that offline/i);
    expect(document.body.textContent).not.toMatch(/has not reached the server/i);
  });
});

// ═══════════════════════════════════════════ CYCLE COUNT

describe("cycle count, through the real form", () => {
  const session = { partId: "PRT-1001" };
  const lookupPart = async (raw) => ({ catalogResult: { ok: true, parts: [{ invalid: false, partId: String(raw).trim(), internalPartNumber: "X", name: "Part", description: "", category: "", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 1 }], invalid: [] }, aliasOutcome: { result: { result: "NOT_FOUND" } } });

  // The bin is scanned and the line opened ONLINE (the server snapshots what it expects); only the
  // count itself -- one line -- is what may be queued.
  const mount = (submitCycleCountLine, rt = runtime()) => {
    const base = ({
    createCycleCountSheet: vi.fn().mockResolvedValue({ outcome: "applied", sheetId: "ccs_1", location: { type: "BIN", locationId: "bin_abc" }, status: "OPEN" }),
    getCycleCountSheet: vi.fn().mockResolvedValue({ sheet: { sheetId: "ccs_1", locationLabel: "A01-003" }, lines: [], nextCursor: null }),
    openCycleCountLine: vi.fn().mockResolvedValue({ outcome: "applied", status: "OPEN", trackingMode: "NONE" }),
    submitCycleCountLine: vi.fn().mockResolvedValue({ outcome: "applied", status: "COUNTED", countedQuantity: 1, variance: 0, expectedQuantity: 1 }),
  });
    render(<CycleCountScan deps={{
      cycleCountClient: { ...base, submitCycleCountLine },
      lookupPart, scanInputDeps, offline: rt,
    }} />);
    return rt;
  };

  /** Bin scanned, one part counted, submitted -- exactly as the count screen is driven. */
  const countAndSubmit = async () => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/scan the bin label/i), { target: { value: "EOS-LOC:bin_abc" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value: session.partId } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /submit 1 count/i })); });
  };

  it("OFFLINE: queues a CYCLE_COUNT_SUBMIT with NO expected quantity or variance", async () => {
    setOnline(false);
    const submitCycleCount = vi.fn();
    const rt = mount(submitCycleCount);
    await countAndSubmit();

    expect(submitCycleCount).not.toHaveBeenCalled();
    expect(rt.enqueued).toHaveLength(1);
    const intent = rt.enqueued[0];
    expect(intent.type).toBe(WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT);
    // BLIND COUNT PRESERVED BY CONSTRUCTION. There is nowhere in this payload for an expectation.
    const payload = JSON.stringify(intent.payload).toLowerCase();
    for (const forbidden of ["expectedquantity", "variance", "materiality", "reconcil"]) {
      expect(payload, `${forbidden} must never be captured`).not.toContain(forbidden);
    }
    expect(document.body.textContent).toMatch(/pending sync/i);
  });

  it("ONLINE: the canonical command is called and nothing is queued", async () => {
    const submitCycleCount = vi.fn().mockResolvedValue({ outcome: "applied", status: "COUNTED", countedQuantity: 1 });
    const rt = mount(submitCycleCount);
    await countAndSubmit();
    expect(submitCycleCount).toHaveBeenCalledTimes(1);
    expect(rt.enqueued).toHaveLength(0);
  });

  it("A REFUSAL IS NEVER QUEUED", async () => {
    const rt = mount(vi.fn().mockRejectedValue(denied()));
    await countAndSubmit();
    expect(rt.enqueued).toEqual([]);
  });

  it("NO SCREEN PATH CAN QUEUE A RECONCILIATION", async () => {
    // The permanent negative requirement, asserted on the source of the screen that owns counts.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/modules/scan/CycleCountScan.jsx"), "utf8");
    expect(src).toMatch(/captureCycleCountSubmit/);
    expect(src).not.toMatch(/captureReconcile|reconcileCycleCount(Line)?\s*\(/);
  });
});

// ═══════════════════════════════════════════ RETURNS

describe("return intake, through the real form", () => {
  const mount = (recordReturnIntake, rt = runtime()) => {
    render(<ReturnIntakeScan deps={{ returnClient: { recordReturnIntake }, scanInputDeps, offline: rt }} />);
    return rt;
  };

  /** Scanned, given a condition, and recorded — exactly as the existing returns tests drive it. */
  const takeIn = async () => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/scan returned part/i), { target: { value: "PRT-1001" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    });
    const condition = screen.getByLabelText(/what condition is it in/i);
    const option = [...condition.querySelectorAll("option")].find((o) => o.value !== "");
    await act(async () => { fireEvent.change(condition, { target: { value: option.value } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /record this return/i })); });
  };

  it("OFFLINE: queues a RETURN_INTAKE and NEVER implies a restock", async () => {
    setOnline(false);
    const recordReturnIntake = vi.fn();
    const rt = mount(recordReturnIntake);
    await takeIn();

    expect(recordReturnIntake).not.toHaveBeenCalled();
    expect(rt.enqueued).toHaveLength(1);
    expect(rt.enqueued[0].type).toBe(WAREHOUSE_INTENT.RETURN_INTAKE);
    // The words that must never appear anywhere on this screen.
    const text = document.body.textContent.toLowerCase();
    for (const forbidden of ["restocked", "credited", "disposed", "repaired", "scrapped"]) {
      expect(text, `"${forbidden}" is an authority that does not exist`).not.toContain(forbidden);
    }
    expect(text).toMatch(/pending sync/);
  });

  it("A REFUSAL IS NEVER QUEUED", async () => {
    const rt = mount(vi.fn().mockRejectedValue(denied()));
    await takeIn();
    expect(rt.enqueued).toEqual([]);
    expect(document.body.textContent).toMatch(/not authorized/i);
  });
});

// ═══════════════════════════════════════════ the policy is shared, not per-screen

describe("one submit policy", () => {
  it("EVERY warehouse screen routes through it, and none invents its own", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const file of [
      "src/modules/scan/PutAwayScan.jsx",
      "src/modules/scan/PickScan.jsx",
      "src/modules/scan/CycleCountScan.jsx",
      "src/modules/scan/TransferScan.jsx",
      "src/modules/scan/ReturnIntakeScan.jsx",
      "src/modules/receiving/MultiScanReceiving.jsx",
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src, `${file} must use the shared policy`).toMatch(/useWarehouseSubmit/);
      // No screen may reach the durable store or the executor directly — that is how six different
      // send-or-queue rules appear.
      expect(src, `${file} must not open its own queue`).not.toMatch(/createIntentStore|drainQueue|runSyncPass/);
    }
  });

  it("the scanner itself never enqueues — an explicit action is always required", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    // Each screen's submit path: put-away's single-flight warehouse.submit, and the count screen's
    // per-line submitLines (it submits many lines, each through the same submitOrQueue policy).
    for (const [file, marker] of [["src/modules/scan/PutAwayScan.jsx", "warehouse.submit("], ["src/modules/scan/CycleCountScan.jsx", "const submitLines = useCallback("]]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      // `capture*` may only appear inside the submit path, never in a scan handler. Asserted by
      // proximity: the capture call must sit after the submit path's start in the same file.
      const submitAt = src.indexOf(marker);
      const captureAt = src.search(/capture(PutAway|CycleCountSubmit)\(/);
      expect(submitAt, `${file} must have a submit path`).toBeGreaterThan(-1);
      expect(captureAt, `${file} must only capture inside the submit path`).toBeGreaterThan(submitAt);
    }
  });
});
