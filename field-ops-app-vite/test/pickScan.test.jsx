// PICK AND STAGE — the mounted surface (vitest + jsdom).
//
// The pick rules are proved pure in test/pickSession.test.mjs. These cover what only the screen can
// show: that it says picking does not hold stock, that a shortage is staged deliberately rather than
// by accident, and that it stages through the placement command with the demand attached.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import PickScan from "../src/modules/scan/PickScan.jsx";

afterEach(cleanup);

let clock = 0;
const scanInputDeps = { now: () => { clock += 1000; return clock; } };

const workOrder = (over = {}) => ({
  id: "WO-1", woNumber: "WO-2026-0001",
  inventorySnapshot: [
    { partId: "PRT-1001", name: "Relay", qtyPlanned: 3 },
    { partId: "PRT-2002", name: "Compressor", qtyPlanned: 1, trackingMode: "SERIAL" },
  ],
  ...over,
});

const client = (over = {}) => ({
  resolveBin: vi.fn().mockResolvedValue({ result: "FOUND", code: "STAGE-1", warehouseId: "WH-1" }),
  recordPutAway: vi.fn().mockResolvedValue({ outcome: "recorded", binCode: "STAGE-1" }),
  ...over,
});

const mount = (binClient = client(), wo = workOrder()) => {
  render(<PickScan deps={{ binClient, workOrder: wo, warehouseId: "WH-1", scanInputDeps }} />);
  return binClient;
};

const scanInto = (label, value) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
};

async function stageTo(bin = "STAGE-1") {
  scanInto(/scan staging location/i, bin);
  await waitFor(() => expect(screen.queryByRole("list", { name: /lines to pick/i }) ?? screen.queryByRole("alert")).toBeTruthy());
}

const openLine = (name) => fireEvent.click(screen.getByRole("button", { name }));

// ────────────────────────────────────────────── it says what it does not do

describe("Pick (it does not hold the stock)", () => {
  it("says so, before anything is picked", () => {
    // An operator who assumes picking holds stock for the job will be surprised at exactly the wrong
    // moment — reservation happens at DISPATCH, not here.
    mount();
    expect(screen.getByText(/does not hold the stock/i)).toBeTruthy();
    expect(screen.getByText(/available to other jobs until this one is dispatched/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── staging destination first

describe("Pick (the staging location comes first)", () => {
  it("asks where you are staging before showing any line", () => {
    mount();
    expect(screen.getByLabelText(/scan staging location/i)).toBeTruthy();
    expect(screen.queryByRole("list", { name: /lines to pick/i })).toBeNull();
  });

  it("a bad staging location keeps its own words and blocks", async () => {
    mount(client({ resolveBin: vi.fn().mockResolvedValue({ result: "WRONG_WAREHOUSE", warehouseId: "WH-2" }) }));
    await stageTo();
    expect((await screen.findByRole("alert")).textContent).toMatch(/different warehouse|building/i);
    expect(screen.queryByRole("list", { name: /lines to pick/i })).toBeNull();
  });
});

// ────────────────────────────────────────────── the job's lines

describe("Pick (the demand is the job's)", () => {
  it("lists the planned lines with what each asked for", async () => {
    mount();
    await stageTo();
    expect(screen.getByRole("button", { name: /Relay/ })).toBeTruthy();
    expect(screen.getByText(/3 planned/)).toBeTruthy();
    expect(screen.getByText(/1 planned.*by serial/i)).toBeTruthy();
  });

  it("a job with no planned parts says so rather than showing an empty picker", () => {
    render(<PickScan deps={{ binClient: client(), workOrder: workOrder({ inventorySnapshot: [] }), warehouseId: "WH-1", scanInputDeps }} />);
    expect(screen.getByText(/no planned parts to pick/i)).toBeTruthy();
  });

  it("without a job it explains what it needs", () => {
    render(<PickScan deps={{ binClient: client(), workOrder: null, warehouseId: "WH-1", scanInputDeps }} />);
    expect(screen.getByText(/picking starts from a job/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── picking a line

describe("Pick (gathering against a line)", () => {
  it("a complete line stages through the PLACEMENT command, with the demand attached", async () => {
    const c = mount();
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-1001");
    scanInto(/scan item/i, "PRT-1001");
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /stage this line/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalled());
    expect(c.recordPutAway).toHaveBeenCalledWith(expect.objectContaining({
      warehouseId: "WH-1", binCode: "STAGE-1", partId: "PRT-1001", quantity: 3, pickedForWorkOrderId: "WO-1",
    }));
  });

  it("a SHORT line is staged DELIBERATELY — the button says what it is doing", async () => {
    // Staging four of five should be a deliberate act, not something that happened by accident.
    const c = mount();
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-1001");
    const button = screen.getByRole("button", { name: /stage 1 — short by 2/i });
    expect(button).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 })));
  });

  it("a staged shortage stays VISIBLE on the job list", async () => {
    // The shortfall must not disappear the moment the picker moves on.
    mount();
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /stage 1 — short by 2/i }));
    expect(await screen.findByText(/staged 1 of 3 — short by 2/i)).toBeTruthy();
  });

  it("OVER-PICKING blocks and says so", async () => {
    mount();
    await stageTo();
    openLine(/Relay/);
    for (let i = 0; i < 4; i += 1) scanInto(/scan item/i, "PRT-1001");
    expect(screen.getAllByText(/more than this job planned for/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /stage this line/i }).disabled).toBe(true);
  });

  it("the WRONG part blocks", async () => {
    mount();
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-9999");
    expect(screen.getAllByText(/not the part this job asked for/i).length).toBeGreaterThan(0);
  });

  it("a serialized line stages the SERIALS", async () => {
    const c = mount();
    await stageTo();
    openLine(/Compressor/);
    scanInto(/scan item/i, "SN-7");
    fireEvent.click(screen.getByRole("button", { name: /stage this line/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalled());
    const payload = c.recordPutAway.mock.calls[0][0];
    expect(payload.serialNumbers).toEqual(["SN-7"]);
    expect(payload.quantity).toBeUndefined();
  });

  it("a mis-scan can be undone", async () => {
    mount();
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-9999");
    expect(screen.getByRole("button", { name: /stage this line/i }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /undo last scan/i }));
    expect(screen.getByText(/scan what you have gathered/i)).toBeTruthy();
  });

  it("nothing gathered cannot be staged", async () => {
    mount();
    await stageTo();
    openLine(/Relay/);
    expect(screen.getByRole("button", { name: /stage this line/i }).disabled).toBe(true);
    expect(screen.getByText(/scan what you have gathered/i)).toBeTruthy();
  });

  it("each line gets its OWN idempotency key, so two lines are two placements", async () => {
    const c = mount();
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /stage 1 — short by 2/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalledTimes(1));
    openLine(/Compressor/);
    scanInto(/scan item/i, "SN-7");
    fireEvent.click(screen.getByRole("button", { name: /stage this line/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalledTimes(2));
    const [first, second] = c.recordPutAway.mock.calls.map((call) => call[0].idempotencyKey);
    expect(first).not.toBe(second);
  });
});

// ────────────────────────────────────────────── refusals

describe("Pick (refusals are told truthfully)", () => {
  it("a DENIED stage says so, and does not look like a failed scan", async () => {
    const err = Object.assign(new Error("denied"), { code: "functions/permission-denied" });
    mount(client({ recordPutAway: vi.fn().mockRejectedValue(err) }));
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /stage 1 — short by 2/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not authorized to stage picked stock/i);
    expect(alert.textContent).toMatch(/not been granted or switched on/i);
  });

  it("any other failure says nothing was changed", async () => {
    const err = Object.assign(new Error("boom"), { code: "functions/internal" });
    mount(client({ recordPutAway: vi.fn().mockRejectedValue(err) }));
    await stageTo();
    openLine(/Relay/);
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /stage 1 — short by 2/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was changed/i);
  });
});
