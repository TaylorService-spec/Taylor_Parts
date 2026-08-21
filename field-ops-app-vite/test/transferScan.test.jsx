// TRANSFERS BY SCAN — the mounted surface (vitest + jsdom).
//
// The verification rules are proved pure in test/transferScanVerification.test.mjs. These cover what
// only the screen can show: that it sends an ID and nothing derived from scans, that every blocker
// reaches the operator in words, and that a refusal is rendered as a refusal.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import TransferScan from "../src/modules/scan/TransferScan.jsx";

// The live hook reaches Firestore; every test injects orders through `deps` instead.
vi.mock("../src/hooks/useTransferOrders", () => ({
  useTransferOrders: () => ({ loading: false, error: null, transferOrderDocs: [], warehouses: [] }),
}));

afterEach(cleanup);

// Tests fire identical scans within the same millisecond, which no real scanner can do. The shared
// input suppresses that as a wedge stutter, so every test drives an advancing clock through the
// documented seam — otherwise these would be measuring the anti-stutter guard, not the workflow.
let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };
const scanInputDeps = { now: advancingClock };


const WH1 = { type: "WAREHOUSE", locationId: "WH-1" };
const WH2 = { type: "WAREHOUSE", locationId: "WH-2" };

const order = (over = {}) => ({
  transferOrderId: "TO-1", partId: "PRT-1001", quantity: 2, trackingMode: "NONE",
  serialNumbers: [], status: "REQUESTED", origin: WH1, destination: WH2, ...over,
});

const client = (over = {}) => ({
  dispatchTransferOrder: vi.fn().mockResolvedValue({ status: "IN_TRANSIT" }),
  receiveTransferOrder: vi.fn().mockResolvedValue({ status: "COMPLETED" }),
  ...over,
});

const open = (orders, transferClient = client()) => {
  render(<TransferScan deps={{ orders, transferClient, scanInputDeps }} />);
  fireEvent.click(screen.getByRole("button", { name: "TO-1" }));
  return transferClient;
};

const scan = (value) => {
  fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
};

const confirmHere = () => fireEvent.click(screen.getByRole("button", { name: /yes, i am here/i }));

// ────────────────────────────────────────────── picking a transfer

describe("Transfer scan (which transfer are you standing in front of)", () => {
  it("lists only transfers waiting to be sent or received", () => {
    render(<TransferScan deps={{ orders: [
      order(),
      order({ transferOrderId: "TO-DONE", status: "COMPLETED" }),
      order({ transferOrderId: "TO-DEAD", status: "CANCELLED" }),
    ] }} />);
    expect(screen.getByRole("button", { name: "TO-1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "TO-DONE" })).toBeNull();
    expect(screen.queryByRole("button", { name: "TO-DEAD" })).toBeNull();
  });

  it("an empty list says there is nothing waiting — not that something failed", () => {
    render(<TransferScan deps={{ orders: [] }} />);
    expect(screen.getByText(/no transfers are waiting/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows each transfer's part and both ends, so the right one can be picked", () => {
    render(<TransferScan deps={{ orders: [order()] }} />);
    expect(screen.getByText(/PRT-1001.*WH-1.*WH-2/)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── where you are

describe("Transfer scan (being at the right end is a precondition)", () => {
  it("blocks submission until the location is confirmed, however much is scanned", () => {
    open([order()]);
    scan("PRT-1001");
    scan("PRT-1001");
    expect(screen.getByRole("button", { name: /send this transfer/i }).disabled).toBe(true);
    expect(screen.getByText(/confirm you are at the right location/i)).toBeTruthy();
  });

  it("asks about the ORIGIN when sending and the DESTINATION when receiving", () => {
    // Scoped to the location prompt: the transfer header names both ends, so an unscoped text match
    // would find WH-1 there and pass whichever end the prompt actually asked about.
    const promptText = () => screen.getByText(/are you at/i).closest("p").textContent;
    open([order()]);
    expect(promptText()).toMatch(/WH-1/);
    expect(promptText()).not.toMatch(/WH-2/);
    cleanup();
    open([order({ status: "IN_TRANSIT" })]);
    expect(promptText()).toMatch(/WH-2/);
    expect(promptText()).not.toMatch(/WH-1/);
  });

  it("the confirmation can be taken back", () => {
    open([order()]);
    confirmHere();
    expect(screen.getByText(/at WH-1/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /not here/i }));
    expect(screen.getByRole("button", { name: /yes, i am here/i })).toBeTruthy();
  });
});

// ────────────────────────────────────────────── scanning

describe("Transfer scan (what you are holding)", () => {
  it("a complete, correctly located transfer can be sent", async () => {
    const c = open([order()]);
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    const submit = screen.getByRole("button", { name: /send this transfer/i });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(c.dispatchTransferOrder).toHaveBeenCalledTimes(1));
  });

  it("sends ONLY the transfer id — nothing derived from the scans", async () => {
    // The command re-reads the order and re-derives every quantity, serial and location itself.
    const c = open([order()]);
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /send this transfer/i }));
    await waitFor(() => expect(c.dispatchTransferOrder).toHaveBeenCalled());
    expect(c.dispatchTransferOrder).toHaveBeenCalledWith({ transferOrderId: "TO-1" });
  });

  it("an incomplete transfer cannot be sent, and says why", () => {
    open([order()]);
    confirmHere();
    scan("PRT-1001");
    expect(screen.getByRole("button", { name: /send this transfer/i }).disabled).toBe(true);
    expect(screen.getByText(/not everything on this transfer has been scanned/i)).toBeTruthy();
  });

  it("the WRONG part is shown as refused and blocks submission", () => {
    open([order()]);
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    scan("PRT-9999");
    expect(screen.getAllByText(/different part from the one this transfer moves/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /send this transfer/i }).disabled).toBe(true);
  });

  it("one unit too many blocks — it is never silently dropped", () => {
    open([order()]);
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    scan("PRT-1001");
    expect(screen.getAllByText(/more than this transfer moves/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /send this transfer/i }).disabled).toBe(true);
  });

  it("a mis-scan can be undone", () => {
    open([order()]);
    confirmHere();
    scan("PRT-1001");
    scan("PRT-9999");
    expect(screen.getAllByText(/different part/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /undo last scan/i }));
    // The scanned LIST loses the entry. The shared input's announcement is a record of what was
    // scanned, not of what is in the list, so it deliberately stays.
    expect(screen.getByRole("list", { name: /scanned/i }).textContent).not.toMatch(/different part/i);
  });

  it("a serialized transfer NAMES the units still to scan", () => {
    open([order({ trackingMode: "SERIAL", quantity: 2, serialNumbers: ["SN-1", "SN-2"] })]);
    confirmHere();
    scan("SN-1");
    // "1 of 2" would not tell the operator which box to go and find.
    expect(screen.getByText(/still to scan.*SN-2/i)).toBeTruthy();
  });

  it("a serialized transfer refuses a serial that is not on it", () => {
    open([order({ trackingMode: "SERIAL", quantity: 1, serialNumbers: ["SN-1"] })]);
    confirmHere();
    scan("SN-9");
    expect(screen.getAllByText(/not one of the units on this transfer/i).length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────── outcomes

describe("Transfer scan (outcomes are told truthfully)", () => {
  it("a REFUSED command is rendered as a refusal, not as a failed scan", async () => {
    // Every inventory.transfer.* capability is inert today, so this is the expected answer.
    const err = Object.assign(new Error("denied"), { code: "functions/permission-denied" });
    const c = open([order()], client({ dispatchTransferOrder: vi.fn().mockRejectedValue(err) }));
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /send this transfer/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not authorized to move this transfer/i);
    expect(alert.textContent).toMatch(/not been granted or switched on/i);
    expect(c.dispatchTransferOrder).toHaveBeenCalled();
  });

  it("a STALE transfer says the order changed, and that nothing moved", async () => {
    const err = Object.assign(new Error("stale"), { code: "functions/failed-precondition" });
    open([order()], client({ dispatchTransferOrder: vi.fn().mockRejectedValue(err) }));
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /send this transfer/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/changed while you were scanning/i);
  });

  it("any other failure states that nothing was moved", async () => {
    const err = Object.assign(new Error("boom"), { code: "functions/internal" });
    open([order()], client({ dispatchTransferOrder: vi.fn().mockRejectedValue(err) }));
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /send this transfer/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/nothing was moved/i);
  });

  it("success reports the resulting status", async () => {
    open([order()]);
    confirmHere();
    scan("PRT-1001");
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /send this transfer/i }));
    expect((await screen.findByText(/IN_TRANSIT/)).textContent).toMatch(/IN_TRANSIT/);
  });

  it("an IN_TRANSIT transfer calls RECEIVE, not dispatch", async () => {
    const c = open([order({ status: "IN_TRANSIT" })]);
    fireEvent.click(screen.getByRole("button", { name: /yes, i am here/i }));
    scan("PRT-1001");
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /receive this transfer/i }));
    await waitFor(() => expect(c.receiveTransferOrder).toHaveBeenCalledWith({ transferOrderId: "TO-1" }));
    expect(c.dispatchTransferOrder).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────── read failures

describe("Transfer scan (a read failure is not an empty warehouse)", () => {
  it("a DENIED transfer read says so rather than showing no transfers", async () => {
    vi.resetModules();
    vi.doMock("../src/hooks/useTransferOrders", () => ({
      useTransferOrders: () => ({ loading: false, error: "permission-denied", transferOrderDocs: [] }),
    }));
    const { default: Fresh } = await import("../src/modules/scan/TransferScan.jsx?denied");
    render(<Fresh />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not authorized to see transfer orders/i);
    expect(alert.textContent).not.toMatch(/no transfers are waiting/i);
    vi.doUnmock("../src/hooks/useTransferOrders");
  });
});
