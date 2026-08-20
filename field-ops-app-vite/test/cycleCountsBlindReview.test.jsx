// M23 blind-count remediation -- REGRESSION LOCK for the Cycle Counts workspace's UI-level guarantees:
// (1) the expected quantity/serial count is never rendered while a count is OPEN (the counter is
//     blind), and (2) once a count is COUNTED, the manager review step offers BOTH Approve and Reject,
//     passing the chosen decision through to reconcileCount.
//
// This does not re-prove server-side separation of duties (functions/test/cycleCountCommand.test.mjs
// covers that against the real emulator) -- it proves the UI never had the anchor to show in the first
// place, and that the review step is a genuinely separate action from counting, not a relabeled button.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const actionsState = {
  status: null,
  busyId: null,
  counts: [],
  createCount: vi.fn(),
  submitCount: vi.fn(),
  reconcileCount: vi.fn(),
  cancelCount: vi.fn(),
};

vi.mock("../src/hooks/useCycleCountActions", () => ({
  useCycleCountActions: () => ({ ...actionsState, clearStatus: vi.fn() }),
}));
vi.mock("../src/services/operationsQueries", () => ({
  fetchWarehouses: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../src/services/truckRegistryQueries", () => ({
  fetchMobileLocationDocs: vi.fn(() => Promise.resolve([])),
}));

const { default: CycleCounts } = await import("../src/modules/inventory/CycleCounts.jsx");

const OPEN_NONE_COUNT = {
  cycleCountId: "cyc-1",
  partId: "part-1",
  trackingMode: "NONE",
  location: { type: "WAREHOUSE", locationId: "wh-1" },
  status: "OPEN",
  // A pre-M23 regression would have shipped expectedQuantity here too -- included deliberately so this
  // test proves the UI does not render it even if it were present in state, not merely that the field is
  // absent from the fixture.
  expectedQuantity: 42,
};

const OPEN_SERIAL_COUNT = {
  cycleCountId: "cyc-2",
  partId: "part-2",
  trackingMode: "SERIAL",
  location: { type: "WAREHOUSE", locationId: "wh-1" },
  status: "OPEN",
  expectedSerialNumbers: ["SN-1", "SN-2", "SN-3"],
};

const COUNTED_COUNT = {
  cycleCountId: "cyc-3",
  partId: "part-3",
  trackingMode: "NONE",
  location: { type: "WAREHOUSE", locationId: "wh-1" },
  status: "COUNTED",
  countedQuantity: 8,
  expectedQuantity: 10,
  variance: -2,
};

describe("CycleCounts -- blind counting (OPEN)", () => {
  beforeEach(() => {
    actionsState.counts = [];
    vi.clearAllMocks();
  });

  it("never renders the expected quantity for a NONE-mode OPEN count", () => {
    actionsState.counts = [OPEN_NONE_COUNT];
    render(<CycleCounts />);
    expect(screen.queryByText(/Expected/i)).toBeNull();
    expect(screen.queryByText(/42/)).toBeNull();
  });

  it("never renders the expected serial count for a SERIAL-mode OPEN count", () => {
    actionsState.counts = [OPEN_SERIAL_COUNT];
    render(<CycleCounts />);
    expect(screen.queryByText(/Expected/i)).toBeNull();
    expect(screen.queryByText(/3/)).toBeNull(); // expected.length would have rendered as "3"
  });
});

describe("CycleCounts -- manager review (COUNTED)", () => {
  beforeEach(() => {
    actionsState.counts = [COUNTED_COUNT];
    vi.clearAllMocks();
  });

  it("shows expected vs counted vs variance once a count is submitted", () => {
    render(<CycleCounts />);
    expect(screen.getByText(/Variance: -2/)).toBeTruthy();
    expect(screen.getByText(/8 counted vs 10 expected/)).toBeTruthy();
  });

  it("offers BOTH Approve and Reject, and passes the chosen decision through to reconcileCount", () => {
    render(<CycleCounts />);
    const reasonBox = screen.getByRole("textbox");
    fireEvent.change(reasonBox, { target: { value: "shelf recount" } });

    const approveBtn = screen.getByRole("button", { name: /approve/i });
    const rejectBtn = screen.getByRole("button", { name: /reject/i });
    expect(approveBtn).toBeTruthy();
    expect(rejectBtn).toBeTruthy();

    fireEvent.click(rejectBtn);
    expect(actionsState.reconcileCount).toHaveBeenCalledWith("cyc-3", "shelf recount", "REJECT");

    fireEvent.click(approveBtn);
    expect(actionsState.reconcileCount).toHaveBeenCalledWith("cyc-3", "shelf recount", "APPROVE");
  });

  it("disables both Approve and Reject until a reason is supplied for a non-zero variance", () => {
    render(<CycleCounts />);
    const approveBtn = screen.getByRole("button", { name: /approve/i });
    const rejectBtn = screen.getByRole("button", { name: /reject/i });
    expect(approveBtn.disabled).toBe(true);
    expect(rejectBtn.disabled).toBe(true);
  });
});
